# Methodology

All formulas below are taken from the code in `backend/app/engine/`. Parameters named `ECON[...]` are defined in `backend/app/engine/catalogue.py`.

## Research Objective

Given a location and a facility, recommend a clean backup-power system that keeps the critical load (theatres, ICU, burns) powered through realistic grid outages at the lowest reasonable cost, show the evidence hour by hour, and, when the facility must move, plan a system that moves with it.

## Inputs

| Input | Source |
|---|---|
| Location (lat, lng) | User pin |
| Solar irradiance, temperature, wind at 10 and 50 m, rainfall | NASA POWER climatology; hourly profiles from Open-Meteo (ERA5); cross-checked with PVGIS, PVWatts, Global Solar Atlas |
| River discharge, terrain head | Open-Meteo GloFAS and elevation |
| Grid: substations and lines within 50 and 100 km, supply hours, reliability class | OpenStreetMap; distribution-company class by state; the facility's reported supply hours override the default |
| Grid tariff, diesel price, exchange rate | Published tariffs (`tariffs.json`), NBS price watch, central bank rate |
| Facility | Type, beds or load, backup hours, roof and land area, existing generator, priority |

## Data Preparation

Open-data responses are cached. When offline, services return bundled snapshots or modelled climatology and mark the value as "model". Solar sizing uses design sun hours `design_PSH = min(annual_PSH, 1.15 × worst_month_PSH)` (`scoring.py`), so the system holds through the cloudiest month.

## Features

The engine uses the inputs directly. The ML classifier derives 21 features from them (see [MODEL_CARD.md](../MODEL_CARD.md)).

## Model / Algorithm

1. **Load model** (`profiles.py`): the facility type and size give an hourly load split into critical, essential and non-essential tiers. The protected load is critical plus essential.
2. **Site scores** (`scoring.py`): solar, wind, water, micro-hydro, pumped hydro, hydrogen water and grid reliability, each 0–100.
3. **Sizing** (`sizing.py`) of each architecture:
   - UPS: `kVA = standard size ≥ critical_peak_kW / pf × margin`, 15 minutes of autonomy.
   - Storage energy: `E_needed = (protected_daily_kWh / 24) × backup_hours × w`, with `w = 1.08` for outages up to 12 h (evening peak); for outages longer than 14 h a daylight PV credit of 50 % of one day's yield per daylight day is subtracted, floored at 45 % of the need. Nameplate `= E_needed / (DoD × η)`, η = 0.95 for Li-ion and 0.85 otherwise; power `≥ 1.1 × protected peak` and `≥ C/8` (C/12 for flow).
   - PV: `kWp_needed = protected_daily_kWh × 1.25 / (design_PSH × PR)`, capped by roof (6 m²/kWp) plus land (12 m²/kWp).
   - Wind, hydrogen, generator and pumped hydro have analogous sizing functions in `sizing.py`.
4. **Generation** (`simulation.py`): PV `P = kWp × G/1000 × PR × (1 + γ × max(0, T_cell − 25))` with `T_cell = T + 20 × G/800`; wind uses a cubic curve from 3 m/s cut-in to 11 m/s rated, 25 m/s cut-out.
5. **Dispatch** over 24 hours. When the grid is down: PV → wind → storage → generator → shedding (non-essential first, then essential, critical last). Storage feeds only the protected bus it was sized for. When the grid is up: PV → wind → grid, with surplus renewables (and the grid, if allowed) charging the storage.
6. **Grid schedule**: the design outage window is always off; if the reported supply is shorter, the remaining hours are removed in a typical load-shedding order (12–16 h, 20–24 h, 4–8 h, …).
7. **Scoring**: nine criteria weighted by priority. For "balanced": response 0.12, duration fit 0.16, site 0.14, CAPEX 0.16, lifecycle cost 0.10, simplicity 0.08, healthcare suitability 0.14, clean share 0.06, expansion 0.04.
8. **Stress tests**: the 12-hour evening outage (design case), a 24-hour national grid collapse, the worst solar month and an 18-hour longer outage. A design passes only if the critical load is fully served in all four.
9. **Outage survival**: the outage is started at each of the 24 hours, for 4, 8, 12, 18 and 24 hours; survival is the share of starts in which the critical load is fully served (the approach of NREL's REopt outage simulator, on the design day).
10. **Investment case** (`investment.py`): CAPEX and OPEX from cost libraries, diesel and grid savings, simple payback, 15-year net cost, financing options.
11. **Relocation case** (`relocatable.py`): phases, movable share, move plan and cost, ownership, 5- and 10-year costs of diesel, grid and solar, funders.

## Mathematical Formulation

**Emissions avoided per year** (`investment.py`):

- Scope 1: `CO2_S1 = (D_baseline − D_system) × 2.68 kg/L`, where `D` is diesel in litres a year.
- Scope 2: `CO2_S2 = Σ_{h: grid on} (L_h − G_h) × EF_grid × 365`, where `L_h` is the load and `G_h` the grid import in hour `h` of the design day, and `EF_grid` the national grid emission factor in kg CO₂/kWh. It is negative when storage charges from the grid.
- Total: `CO2 = CO2_S1 + CO2_S2`. Solar used during an outage counts once, as diesel not burnt.

**Objective.** The engine does not solve an optimisation problem. It sizes each architecture with the rules above, simulates it, and ranks the candidates by the weighted score subject to the stress-test constraint.

## Training / Optimization

Only the classifier is trained: 10,000 engine-labelled synthetic sites, 80/20 split, seed 2026. See [MODEL_CARD.md](../MODEL_CARD.md).

## Inference / Execution

`POST /api/assess` runs the whole pipeline in a few seconds on a laptop. The classifier's pick is computed first and compared with the simulated recommendation in the agent trace.

## Outputs

Recommended design and sizes, ranking of all candidates with scores, hourly simulation, stress tests, survival curve, investment case, relocation case, Three A's, ESG figures and reports.

## Evaluation

- **Engine**: unit and regression tests on energy balance, sizing, costs, stress tests and the worked example's headline figures (`backend/tests/`).
- **Classifier**: held-out accuracy against the engine's labels, with a single tree and a majority baseline for comparison ([benchmarks/README.md](../benchmarks/README.md)).
- **Application**: Playwright GUI tests of every page and of the ESG report for several sites.

## Baselines

Today's diesel-only operation is the baseline for savings and emissions. Grid-only and solar-service costs are compared over 5 and 10 years. For the classifier: one CART tree and the most-common-family guess.

## Metrics

Critical load served (%), stress tests passed, outage survival (%), diesel avoided (L/yr), CO₂ avoided (t/yr), CAPEX, payback, 10-year cost, share of the investment reused after a move, classifier accuracy and top-2 accuracy.

## Experimental Configuration

Worked example: National Orthopaedic Hospital, Enugu (6.4684, 7.5256), 350 beds, 6 hours of grid a day, 12-hour outage from 18:00, 20,000 m² of land assumed, 1,000 kVA generator assumed, design month August, diesel ₦3,277/L, grid ₦160/kWh, ₦1,330/US$. Reproduce with `python examples/quickstart.py`.

## Assumptions

- Pre-feasibility accuracy of about ±30 % on costs.
- Bed-based benchmark loads until the facility's metered profile is available.
- 2.68 kg CO₂ per litre of diesel (IPCC default) and a national grid emission factor.
- One typical design day represents the year.

## Threats to Validity

- **Internal**: sizing rules and cost libraries are simplifications; errors in them propagate to every result and to the classifier's labels.
- **Construct**: one design day cannot represent seasonal variation or multi-day outages exactly; the worst-month and 24-hour tests only partly cover this.
- **External**: the worked example's land area, generator size and diesel bill are assumed until the hospital confirms them; results elsewhere depend on open-data coverage.
- **Classifier**: accuracy is measured against the engine on synthetic sites, not against real installations.
