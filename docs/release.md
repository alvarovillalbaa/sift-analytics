# Release evidence

## 0.1.0 — 2026-10-20

Implemented: Next.js workspace; local CSV/TSV/JSON/JSONL/XLSX/Parquet import and persistence; DuckDB query execution; configured PostgreSQL adapter; eve dashboard/analysis planning; signed session ownership; saved draggable/resizable views; charts/tables/metrics; SQL/source/freshness/truncation inspector; exports; metric definitions; explicit model-exposure settings; SDK contract/conformance helper; Node/Docker self-hosting configuration.

Verification so far:

- Targeted strict TypeScript checks pass for the app/postgres route, browser engine/storage/SQL policy/demo, connector conformance helper, and agent/auth integration.
- Build/copy scripts pass Node syntax checks.
- Static SQL probes cover the deterministic demo statements, CTEs, scope validation, and rejected mutations/external access/qualified custom functions.
- Authentication probes cover identity/grant signatures, ownership, concurrent session grants, tampering, and origin checks.
- `git diff --check` is clean.

Local installs/builds stopped after the newly supplied Storage Guard preflight measured 32.6 GiB free versus 34 GiB required. No local Next build, dev-server smoke, browser check, live PostgreSQL integration, Docker run, or live model call has been performed. Static checks do not prove these behaviors.

Vercel project created: `sift-analytics`, ID `prj_y8cXMQAAIQIIqbvsBlrlwGNfekum`, Clous Team, Node 24. The Vercel connector returned 403 for environment-variable creation. No installed CLI fallback was found. `SIFT_SESSION_SECRET` remains required for hosted AI sessions; production intentionally fails closed without it.

Publication and hosted-build receipts are appended after the remote state is inspected.
