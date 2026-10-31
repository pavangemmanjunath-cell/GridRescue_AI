# Technical Positioning

This document describes how GridRescue AI relates to existing approaches. It makes no claim of superiority; the distinctions below are technical differences that can be checked in the code, not measured advantages.

## Existing Approaches

1. **Techno-economic optimisation tools** for hybrid systems, such as HOMER Pro or NREL REopt, size and dispatch systems over a full year for a given site and load.
2. **Expert pre-feasibility studies**: an engineer builds a load profile and simulates options, often in a spreadsheet or MATLAB, over days or weeks.
3. **Resource and grid maps**, such as the Global Solar Atlas or OpenStreetMap power layers, show the resource or the lines but not a design.
4. **Supplier quotes**, which size one supplier's product for the site.

## Limitations Addressed

- A hospital board or sales team often needs a first, comparable answer the same day, before data is collected for a full study.
- Most tools assume the system stays where it is built; a facility that must move in a few years risks stranded assets.
- Supplier quotes are hard to compare because each covers one product family.
- Emissions are rarely estimated before purchase in a form that maps to Scope 1 and Scope 2 reporting.

## Approach Implemented in This Repository

- The site is read from open data without keys, so any map pin gives a first assessment within seconds.
- Nine architectures across storage families are sized and simulated hour by hour through an outage, and checked by four stress tests and an outage survival curve.
- A relocation case plans movable equipment, the move, ownership and costs over 5 and 10 years.
- An ESG report gives Scope 1 and Scope 2 estimates per selected site and lens.
- A Random Forest trained on engine-labelled synthetic sites gives a first pick that the simulation verifies.
- A retrieval-based assistant answers questions with citations to the internal knowledge base.

## Technical Differences

| Existing approach | Limitation | Approach here | Resulting technical difference |
|---|---|---|---|
| Full-year optimisation for a fixed site | Needs a load profile and setup per site; system assumed fixed | Rule-based sizing plus a 24-hour dispatch, run from a map pin; relocation case | First answer in seconds from open data; movable design and move cost included; less temporal detail (one design day) |
| Expert study | Days to weeks per site | Automated pipeline with an evidence trace | Same-day comparison; must still be confirmed by a study |
| Resource or grid map | No design | Map lenses feed the engine directly | Site reading and design in one flow |
| Supplier quote | One product family | Technology families, vendor-neutral | Options on one basis; no product-level detail |

## Research Hypothesis

A planner that combines open site data, rule-based sizing and an hourly outage simulation can give a pre-feasibility recommendation for critical-facility backup power that agrees with a full engineering study within the stated ±30 % band, in seconds rather than days.

## Evidence Currently Available

- Deterministic tests of energy balance, sizing, costs and stress tests (`backend/tests/`).
- The worked example's results, reproducible with `python examples/quickstart.py`.
- The classifier's held-out agreement with the engine (80.4 % on synthetic sites).
- GUI tests showing the flow works for several Nigerian sites (Enugu, Kano, Jos, Lokoja).

## Evidence Still Required

- Comparison with a full-year tool (for example REopt or HOMER) on the same sites and loads.
- Comparison with measured data from an installed system, including the worked example once the hospital's load and generator logs are available.
- Independent review of cost libraries and emission factors.
- Evaluation of the classifier against decisions made by engineers on real sites.

## Limitations

See [limitations.md](limitations.md). The main ones: one design day, benchmark loads, pre-feasibility costs, and a classifier validated only against the engine.
