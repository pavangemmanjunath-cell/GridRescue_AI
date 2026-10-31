# Use Cases

Each use case is marked **Implemented**, **Conceptual** (the engine supports it but there is no dedicated flow) or **Proposed** (future work).

## Hospital that must relocate — Implemented

### Problem
A hospital on a weak grid runs on diesel during long daily outages and must move to a new building in a few years, so equipment fixed to today's roofs would be stranded.

### User / Stakeholder
Hospital board, chief engineer, funders.

### Inputs
Today's site and the new site, the hospital's reported grid hours, beds or load, required backup hours, land, existing generator, diesel bill.

### Workflow
Explorer (pin, lenses, grid scan) → new-site lens and lock → relocation plan → Simulate → ESG report.

### Outputs
Theatres-first critical-load list, movable design, move plan, ownership, 5- and 10-year costs, funders, Three A's, ESG report.

### Expected Value
A same-day, evidence-backed starting point for the board and funders.

### Assumptions
Benchmark loads until metered data arrives; assumed land and generator size are flagged in the plan.

### Limitations
Pre-feasibility only; the new site in the worked example is an illustrative pin.

## Any critical facility at any location — Implemented

### Problem
A clinic, telecom tower, data room, cold-chain store, water works or school needs backup power and a comparison of options.

### User / Stakeholder
Facility owners, utilities, installers, NGOs.

### Inputs
A map pin and the facility type and size.

### Workflow
Explorer → Facility → Advisor (ranking, ML pick, survival curve) → Compare / Costs → Report.

### Outputs
Ranked architectures with sizes, costs, simulation, stress tests and reports.

### Expected Value
Options on one basis before asking suppliers for quotes.

### Assumptions
Load archetypes per facility type.

### Limitations
Load archetypes are generic; telecom and data loads in particular vary widely.

## Night maintenance crew off diesel — Implemented (Build 3D)

### Problem
A rail maintenance crew powers night work with a diesel generator next to homes.

### User / Stakeholder
Infrastructure maintenance operators.

### Inputs
Shift pattern and load.

### Workflow
Build 3D → maintenance work scenario.

### Outputs
Battery trailer charged at the depot; three night shifts or three cloudy shifts simulated; noise comparison (45 dBA vs 68 dBA).

### Expected Value
Quieter, cleaner night work.

### Assumptions
Depot charging between shifts.

### Limitations
Illustrative scenario with modelled loads.

## ESG overview before purchase — Implemented

### Problem
Boards must report Scope 1 and Scope 2 emissions and want the effect of an investment before buying.

### User / Stakeholder
Boards, sustainability officers, funders.

### Inputs
The assessment for the selected site and lens; a carbon price.

### Workflow
Download ESG report from the plan, Simulate or Report page.

### Outputs
Scope 1 and Scope 2 estimates, E · S · G lines, potential carbon value.

### Expected Value
A consistent pre-purchase estimate per site.

### Assumptions
IPCC diesel factor; national grid factor.

### Limitations
Not an audited statement; carbon credits are potential until verified and issued.

## Utility feeder planning — Conceptual

The grid lens and feeder check show where grid-first options are viable. A dedicated utility flow is not built.

## Clinic cold storage, surplus solar sharing, car-park charging — Proposed

Extensions on the same supply: vaccine cold storage, sharing surplus solar with the grid or neighbours where tariffs allow, and EV charging points.

## More outage types — Proposed

Feeder or substation trips, frequency collapse, location-wide outages, storms, floods, heat waves and cyber-security incidents as further stress scenarios.
