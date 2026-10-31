# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [1.0.0] - 2026-10-31

First public release: the proof of concept for Global Energy Hackathon 2026, Brief 12 "Relocatable solar for a hospital on the move", with the National Orthopaedic Hospital, Enugu as the worked example.

### Added

- **Planning engine** (`backend/app/engine/`): site scoring from open data, a hospital load model (critical, essential and non-essential), sizing and costing of nine candidate architectures, a 24-hour dispatch simulation through an outage, nine weighted ranking criteria, four stress tests, an investment case and an agent trace (observe, classify, verify, stress-test, afford, decide).
- **Outage survival curve**: the outage started at each of the 24 hours of the design day, for 4, 8, 12, 18 and 24 hours.
- **Relocation case** for a facility that must move: phases, critical-load list, movable design, move plan, ownership, 5- and 10-year costs of diesel, grid and solar, funders and the Three A's (access, affordability, availability).
- **ESG report** for any selected site and lens: Scope 1 and Scope 2 emissions, environment, social and governance lines, and carbon value at a user-entered price marked as potential, not issued (`POST /api/report/esg`).
- **ML classifier** (`backend/app/ml/`): a Random Forest of 30 CART trees plus one CART tree for readable rules, trained on 10,000 engine-labelled synthetic sites, with a model card at `GET /api/ml/model`. The hourly simulation verifies every pick.
- **Ask GridRescue**: retrieval over an internal SQLite database with an FTS5 index (BM25) and extractive answers with numbered citations; no language model is used. Assessment history is shown on Report › History.
- **Web application** (React 19, TypeScript, Vite): Explorer with sun, wind, water, grid and new-site lenses; the relocation plan; Facility calculator; Advisor; Compare; Costs; Simulate (3D site through the outage, tagged with the selected location and lens); Build 3D; Learn; Report; hands-free page.
- **Offline mode** (`GR_OFFLINE=1`) from bundled snapshots.
- **Tests**: 63 pytest tests, 23 vitest tests and 10 Playwright GUI specs; GitHub Actions CI.
- **Research-repository files**: licence, citation metadata, contributing guide, code of conduct, security policy, model and data cards, documentation in `docs/`, a quick-start example and a reproducible ML evaluation.
- **Submission package** in `FINAL_DOC/`: POC summary, one-pager, 5-slide deck, demo video and pitch video.

### Changed

- **CO₂ method.** Solar power used during an outage was counted twice, once as diesel not burnt and once as grid electricity not bought. It is now counted once. Scope 1 is the diesel no longer burnt. Scope 2 is the change in grid electricity bought while the grid is on, which can be negative when the batteries charge from the grid. For the worked example, avoided CO₂ falls from 3,222 t to 2,246 t a year (2,323 t Scope 1 minus 77 t Scope 2). The figures in the documents and videos were updated to match.
- The ML training script takes `--n`, `--seed`, `--trees` and `--out` options, so the evaluation can be reproduced without replacing the shipped model.

### Fixed

- OpenStreetMap attribution is shown on the Simulate 3D ground map and on the Build 3D map.
- The Simulate page labels its payback as "bought outright", distinct from the service-fee model of the relocation plan.

[Unreleased]: https://github.com/pavangemmanjunath-cell/GridRescue_AI/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/pavangemmanjunath-cell/GridRescue_AI/releases/tag/v1.0.0
