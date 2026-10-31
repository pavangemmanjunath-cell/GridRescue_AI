# Roadmap

This roadmap lists what exists, what is planned, and what is proposed. Items marked **Proposed** are ideas, not commitments.

## Current Stable Capabilities (v1.0.0)

- Read any site from open data: solar, wind, water, the grid within 50 and 100 km, and the published tariff.
- Size nine candidate architectures and check each with a 24-hour dispatch simulation through an outage, four stress tests and an outage survival curve.
- Rank the designs on nine weighted criteria and build an investment case.
- Plan the move of a facility that must relocate: phases, movable design, move plan, ownership, 5- and 10-year costs, funders.
- Produce an ESG report for the selected site and lens, with Scope 1 and Scope 2 emissions.
- Give a fast first pick from a Random Forest classifier, verified by the simulation.
- Answer questions with cited passages from an internal knowledge base.
- Run offline from bundled snapshots.

## Near-Term Improvements

- **Size from measured data**: feed an uploaded meter or generator log (hourly CSV) into the assessment. The case's consumption endpoint already reads one.
- **Full-year simulation**: 8,760 hours with multi-day outages, in place of the 24-hour design day.
- **More tariff tables**: more countries and time-of-use structures, each with its published source.
- **GUI tests in CI**: run the Playwright suite against the servers on each pull request.
- **Verified start on Linux and macOS**: `start.sh` is smoke-tested in CI; a manual check on macOS is still needed.

## Research Extensions

- **Proposed** — More outage types as stress scenarios: feeder or substation trips, frequency collapse, location-wide outages (a feeder, district or state market out together), storms, floods, heat waves and cyber-security incidents that cut power or controls.
- **Proposed** — Classifier: more training sites in windy and deep-cycling conditions, probability calibration, and comparison with gradient-boosted trees.
- **Proposed** — A language model behind Ask GridRescue, keeping the same retrieval, sources and citations, evaluated on answer faithfulness.
- **Proposed** — Uncertainty ranges on costs and emissions in place of the single ±30 % band.
- **Proposed** — Utility feeder planning on the same map: where grid-first options or feeder upgrades help most.

## Community Contributions Welcome

- Tariff tables for a new country, with sources (good first contribution).
- Health-facility registry adapters for `backend/app/data/external/`.
- Independent checks of emission factors, cost references and load benchmarks.
- Translations of the interface.
- Tests for edge cases: polar latitudes, sites with no grid, very small clinics.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [README › Call for contributions](README.md#call-for-contributions).

## Long-Term Research Direction

Decision support for clean, relocatable backup power at critical facilities on weak grids, validated against measured data from installed systems. The aim is a planner whose estimates are checked against what was actually built and measured, so that the uncertainty band can be narrowed from evidence rather than assumed.
