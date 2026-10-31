# Release Guide

## Before Release

- [ ] Tests pass: `cd backend && pytest`, `cd frontend && npx tsc -b && npm test`, and `npm run e2e` with both servers running
- [ ] CI is green on `develop`
- [ ] Documentation updated: README, `docs/`, MODEL_CARD, DATA_CARD
- [ ] CHANGELOG.md: move **Unreleased** entries under the new version and date
- [ ] Version updated in `backend/app/config.py`, `frontend/package.json` (`npm version X.Y.Z --no-git-tag-version`) and `CITATION.cff` (`version`, `date-released`)
- [ ] CITATION.cff valid: `pip install cffconvert && cffconvert --validate`
- [ ] Secrets scan clean: no `.env`, keys, tokens or personal data in the diff
- [ ] Licence and NOTICE correct for any new third-party material
- [ ] Examples run: `python examples/quickstart.py`
- [ ] Links verified in README and `docs/`
- [ ] Release notes written in `docs/releases/vX.Y.Z.md`

## Versioning

Semantic versioning, `MAJOR.MINOR.PATCH`, tags with a lowercase `v`: `v1.0.0`, `v1.1.0`, `v1.1.1`, `v2.0.0`.

- **MAJOR** — backward-incompatible changes to the API, the assessment output or the data formats.
- **MINOR** — new backward-compatible capabilities, such as a new outage type, lens or report.
- **PATCH** — backward-compatible fixes and documentation corrections.

Avoid tags such as `V_1.1`, `Version_1` or `release_new`.

## Branches

`develop` collects merged pull requests. A release is prepared on `develop`, then merged into `main` with a merge commit, and the tag is created on `main`.

```bash
git checkout main
git merge --no-ff develop -m "Release vX.Y.Z"
git tag -a vX.Y.Z -m "GridRescue AI vX.Y.Z"
git push origin main vX.Y.Z
```

## GitHub Release

On GitHub: **Releases → Draft a new release**, choose the tag, title `GridRescue AI vX.Y.Z`, paste `docs/releases/vX.Y.Z.md` as the description, and publish. Create the release only from a tested commit on `main`, and only with the owner's approval.

## Zenodo

One-time setup by the repository owner:

1. Sign in to [Zenodo](https://zenodo.org) with GitHub (optionally link ORCID).
2. Open **Zenodo → GitHub**, press **Sync now**, and switch on `GridRescue_AI`.

After that, every published GitHub release is archived automatically:

GitHub release → Zenodo ingests the release → archived software version → version DOI (plus a concept DOI for all versions).

Zenodo reads the metadata from `CITATION.cff` (title, authors with ORCID, version, licence, abstract, keywords). There is no `.zenodo.json`, so CITATION.cff is the single source. Do not also upload the same release to Zenodo by hand.

## Post-Release

After Zenodo creates the DOI:

- check the Zenodo record's authors, title, licence and description;
- add the DOI badge and the software DOI to the README;
- add `doi:` (the concept DOI) to CITATION.cff for the next release;
- start a new **Unreleased** section in CHANGELOG.md.

Never modify an archived version to make history look cleaner; publish a new version instead.
