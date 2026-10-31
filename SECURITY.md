# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.0.x | Yes |
| earlier, unreleased snapshots | No |

## Reporting a Vulnerability

**Do not report exploitable vulnerabilities in public issues, pull requests or discussions.**

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. The report is visible only to the maintainers. If that button is not shown, open an issue titled "Security contact request" **without any details**, and the maintainer will arrange a private channel.

## What to Include

- the affected version or commit;
- a description of the vulnerability;
- steps to reproduce it;
- its impact — what an attacker could read, change or stop;
- a suggested mitigation, if you have one.

Do not include real patient, customer or personal data in a report.

## Response Expectations

This is a small research project maintained in the authors' own time. The maintainer aims to acknowledge a report within a couple of weeks, agree on a fix and a disclosure date with the reporter, and credit the reporter in the release notes unless they prefer otherwise. No response time is guaranteed.

## Security Design Notes

- No API keys or secrets are needed or stored in the code. Optional settings (for example `GR_HEALTHSITES_API_KEY`, `GR_USER_AGENT`) are read from a local `backend/.env`, which is git-ignored.
- No personal data is collected: inputs are a map location and facility figures. Assessment summaries are kept in a local SQLite file (`backend/.cache/`, git-ignored).
- Inputs are validated server-side (coordinate ranges, sizes) with Pydantic.
- The start scripts bind the API to `127.0.0.1`. The Vite development server listens on all network interfaces so the demo can be opened from another device on the same network; set `server.host` to `false` in `frontend/vite.config.ts` to keep it local.
- The application is a pre-feasibility planner and is **not hardened for production**: there is no sign-in, rate limiting or audit log. A production deployment needs authentication and roles, HTTPS, rate limiting, audit logs of reports and signed report files.
- The map loads tiles from tile.openstreetmap.org and fonts from Google Fonts, so a browser running the app contacts those services.
