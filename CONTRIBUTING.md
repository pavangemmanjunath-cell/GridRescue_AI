# Contributing

## Welcome

Thank you for considering a contribution to GridRescue AI. The project plans clean backup power for hospitals and other critical facilities on weak grids, and it improves most when people who know a grid, a hospital, a tariff or a method check it against reality. Bug reports, data, methods, tests and documentation are all welcome. A list of concrete open tasks is in [README › Call for contributions](README.md#call-for-contributions) and [ROADMAP.md](ROADMAP.md).

## Ways to Contribute

- **Bug fixes** — something in the engine, API or app gives a wrong or broken result.
- **Features** — a new outage type, facility type, lens or report section.
- **Research extensions** — a full-year simulation, better load models, another ML method, a language model behind Ask.
- **Benchmark additions** — independent comparisons of the classifier or the sizing against other tools or measured data.
- **Dataset adapters** — a tariff table for a new country, a health-facility registry, a meter-log format.
- **Documentation** — clearer explanations, worked examples, translations.
- **Tests** — regression tests for a calculation, GUI tests for a page.
- **Reproducibility verification** — run [docs/reproducibility.md](docs/reproducibility.md) on your machine and report what differs.

## Development Setup

Requirements: **Python 3.11–3.13** and **Node.js 22.12 or newer**. No API keys are needed.

```bash
git clone https://github.com/pavangemmanjunath-cell/GridRescue_AI.git
cd GridRescue_AI

# backend
cd backend
python -m venv .venv
# Linux / macOS: source .venv/bin/activate      Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
pytest                        # offline tests from bundled snapshots
python -m uvicorn app.main:app --reload --port 8000

# frontend (second terminal)
cd frontend
npm ci
npm run dev                   # http://localhost:5173, proxies /api to :8000
npm test                      # vitest unit tests
npx tsc -b                    # type-check
npm run e2e                   # Playwright GUI tests; needs both servers running
```

On Windows, `START.bat` does all of this in one step.

## Forking

1. Click **Fork** on the repository page.
2. Clone your fork and add the original as `upstream`:
   ```bash
   git clone https://github.com/<you>/GridRescue_AI.git
   cd GridRescue_AI
   git remote add upstream https://github.com/pavangemmanjunath-cell/GridRescue_AI.git
   git fetch upstream
   ```
3. Start every change from the latest `develop`: `git checkout -b feature/<description> upstream/develop`.

## Branches

| Branch | Purpose |
|---|---|
| `main` | Stable code. Every release is tagged here (`v1.0.0`, `v1.1.0`, …). Changes reach `main` only from `develop`. |
| `develop` | Integration branch. Pull requests target `develop`. |
| `feature/<description>` | New capability, e.g. `feature/meter-log-sizing` |
| `fix/<description>` | Bug fix, e.g. `fix/esg-scope2-sign` |
| `docs/<description>` | Documentation only |
| `research/<description>` | Methods or experiments, e.g. `research/full-year-dispatch` |
| `benchmark/<description>` | Benchmarks and comparisons |

Use lowercase words joined by hyphens.

## Making Changes

- Keep a change focused on one thing; open an issue first for anything large.
- Match the existing style: typed Python (`from __future__ import annotations`), small pure functions in `backend/app/engine/`, React function components with TypeScript in `frontend/src/`.
- Every number the app shows must come from the engine or from a published source with its reference. Do not hard-code results for one site; Enugu is the worked example, not a special case.
- Keep the planner vendor-neutral: no brand or product names in the ranking, the data or the reports.
- Never commit secrets, `.env` files, caches or test output (they are in `.gitignore`).

## Testing

Before opening a pull request, run the tests that cover your change and include the result in the pull request:

```bash
cd backend && pytest
cd frontend && npx tsc -b && npm test
cd frontend && npm run e2e        # for UI changes, with both servers running
```

Add a test for every bug fix and every new calculation. CI runs the backend tests, the type-check, the unit tests and the production build on each pull request.

## Documentation

Document new capabilities in the README (what it does, where it shows) and, for methods, in [docs/methodology.md](docs/methodology.md). New API endpoints go in the README's API table. Update [CHANGELOG.md](CHANGELOG.md) under **Unreleased**.

## Research Contributions

For a method, model or experiment, explain in the pull request:

- the research problem it addresses;
- the proposed method and why it fits;
- assumptions and their sources;
- the evaluation: data, metric, baseline, and how to reproduce it with one command;
- supporting references where needed.

Report results as measured, including negative or mixed results. Do not change validated results to look better.

## Pull Request Process

1. Fork the repository.
2. Create a branch from `develop` with the naming above.
3. Make the change.
4. Run the tests.
5. Update the documentation and the changelog.
6. Open a pull request into `develop` and fill in the template.

A maintainer reviews it; CI must pass before merge. Releases are cut from `develop` into `main` by the maintainers.

## Data Contributions

Data must be openly licensed for redistribution, with its source and licence stated. Do **not** contribute:

- proprietary or paid datasets;
- private customer or patient data;
- confidential company data, including your employer's;
- personal data without authorisation;
- copyrighted datasets without redistribution rights.

OpenStreetMap-derived data stays under the ODbL and must be attributed (see [NOTICE](NOTICE)).

## Contributor Attribution

Merged contributions are credited in [AUTHORS.md](AUTHORS.md) with their category and in the release notes. Authorship of papers or releases is not granted automatically; it is agreed with the authors for substantial scientific contributions.

By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE), and you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
