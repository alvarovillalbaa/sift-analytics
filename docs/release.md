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

## Publication receipt

- Public GitHub repository: https://github.com/alvarovillalbaa/sift-analytics
- Production URL: https://sift-analytics.vercel.app
- Initial deployed commit: `14c79f902b51422bede34af77e082a0ec21e7f8d`
- Production deployment: `dpl_EeWPdfLp4E5MNABV1NBtmVwkf8o5`, verified `READY`, Git-sourced, Node 24.
- Hosted Next.js compilation, TypeScript, static-page generation, and eve/Nitro service build passed. Vercel reported a completed build in 43 seconds.
- HTTP checks: homepage 200; eve health 200 with `status:ready`; DuckDB WASM 200 with `application/wasm`; browser worker 200 with JavaScript MIME; PostgreSQL discovery 200 with `configured:false`.
- `/api/session` returned 503 with the expected missing-`SIFT_SESSION_SECRET` message. AI acceptance remains blocked on authorized environment configuration followed by redeployment and a real model/tool turn.

No browser interaction, live file import, PostgreSQL source connection, or Docker runtime proof is claimed. Publication is verified; the complete conversational product acceptance remains open.

## Final runtime revision and deferred setup

- Runtime commit: `4872badd14194fc970cf26d60ad075e9627a51da`.
- Production deployment: `dpl_GGXXeLhfKsG4vyKxBGAJY49bw94q`, verified `READY` and assigned to https://sift-analytics.vercel.app.
- Includes the readable typography/contrast pass, dataset selection for metric definitions, and corrected self-host callback documentation.
- Hosted compilation, TypeScript, and eve service builds passed again. Homepage and eve health return 200. Browser session initialization still returns the expected 503 configuration error.
- Alvaro explicitly chose “I’ll configure it later” for `SIFT_SESSION_SECRET` on 2026-10-20. AI conversations remain disabled until that production secret is configured and the app is redeployed. A real model/tool turn remains acceptance work; no provider success is claimed.

Subsequent documentation-only commits do not change the deployed runtime code.

## Acceptance corrections — 2026-10-20

Source review found and corrected data-fidelity and interruption issues before live-provider acceptance:

- Exact JSON/XLSX number tokens and decimal scales survive import and Arrow serialization. Text identifiers remain text; timestamp units and timezone semantics are preserved. CSV/TSV automatic inference limits are documented.
- Result column types prevent text IDs such as `00123` from being coerced into numbers. Unsafe numeric chart coercion produces an inspector prompt. Currency labels require an explicit supported ISO code; date labels retain useful date/time context; longer donut legends disclose additional categories.
- PostgreSQL client-local type parsers preserve exact numeric/JSON/array/custom-type text and calendar timestamps without Date's millisecond/timezone conversion.
- AI plans persist their stable view identity and replay receipt in the same workspace update. Reset, Stop, concurrent plans, and component remounts cannot move queued results into a different conversation or leave local queries outside cancellation control.
- Worker startup/import/restoration and IndexedDB phases have bounded deadlines. Failed saved uploads can be removed from Data sources even when restoration fails. Synchronous parser limits and asynchronous deadline boundaries are explicit.
- Planner validation uses SQL syntax trees, so harmless quoted columns such as `"query"` or `"load"` are accepted while connector scopes remain authoritative.

Targeted strict TypeScript checks cover the changed app, PostgreSQL route, EVE tools, data engine/value helpers/storage, and panel renderer. Whitespace checks pass. No local install/build, browser check, database provisioning, or live-provider suite was run; Storage Guard still reports less than the required 34 GiB. Hosted build and publication receipts follow after the corrected revision is deployed.

- Corrected runtime commit: `8228cd32e8728ff3a2153469f4d314ddf128dcff`, verified on GitHub `main`.
- Production deployment: `dpl_9Pg8DtLfDUFH8fruz8vGixjh2BcJ`, verified `READY` and assigned to https://sift-analytics.vercel.app.
- Hosted Next.js compilation, TypeScript, and eve service builds passed; Vercel reported a completed build in 35 seconds.
- Current HTTP checks: homepage 200; eve health 200 with `status:ready`; `/api/session` 503 for the deferred signing-secret configuration.
- The previous goal turn made progress by publishing the application. This continuation made progress by correcting identified acceptance defects and publishing the corrected runtime. Full completion remains unproven: live AI, PostgreSQL, browser file/resize/replay behavior, and Docker runtime acceptance remain open. The signing secret remains explicitly deferred; it was not retried through a denied configuration interface.
