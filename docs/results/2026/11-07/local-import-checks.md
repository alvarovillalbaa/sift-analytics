# Local folder import — accepted focused packet

[Run 42408226622](https://github.com/alvarovillalbaa/sift-analytics/actions/runs/42408226622), job `128510469802`, passed at exact source `3b06822cf61ad5a18c0029004366f000a5f9db7f`. It ran five authored fixture checks, 22 metadata/selection checks, the actual eve/Next production build and four Chromium scenarios. The four scenarios contain 30 named checks and 19 retained snapshots; these are different counting levels, not 61 independent tests.

Node was 24.22.2, Playwright/core 1.65.0 with verified locked SRIs, Chromium 158.0.8127.18. No model credentials, database, account or production data were used. This is real browser/DuckDB/IndexedDB execution over authored T2 files, with an emulated narrow touch profile.

## Observed behavior

| Case | Actual result |
| --- | --- |
| L01 desktop | Six unchecked metadata rows; explicit four-file subset; nested same-basename identities; independent malformed-JSON failure; retry/reload preserve original bytes, IDs, metadata and order; actual manual SQL inspector shows 49 across six rows. The 9,999-value decoy remains absent. |
| L02 narrow touch | Same independent import/retry/reload/SQL journey through ordinary touch/navigation controls, including unobstructed navigation close. |
| L03 commit boundary | Injected native transaction-complete listener clicks Stop. One native late-abort `InvalidStateError` is recorded; the acknowledged first file remains, the queued file stays absent, and ordinary retry adds only the remaining file. |
| L04 workbook | Actual chooser and sheet inspection expose North/South. South=9 rather than North=99 is imported, queried and restored. A separately injected missing-workspace-metadata reload retains the file and keeps schema/result sharing off. |

Independent review reconstructed all 19 workspace snapshots and 38 complete file-payload copies: 13,046 decoded bytes, 11 distinct imported identities. Fixture bytes independently give the expected 49/6 aggregate and selected sheet value 9. Actual query results were checked in the DOM; the report's aggregate/value summary fields are not a separate raw DuckDB-response recording. Desktop, narrow and commit-control screenshots were inspected; the workbook screenshot captures a modal transition and is not stable-modal visual proof.

All eight actual session POSTs returned the expected 503 and completed both `response.finished() === null` and `requestfinished` within the absolute ten-second deadlines. All 16 lifecycle checkpoints completed. The 107 observed requests had no boundary violations, request failures, unexpected console errors or WebSockets. Four contexts/pages closed through expected paths. These observations establish the disabled-session boundary, not successful AI authentication or a model/tool turn.

## Source, resources and originals

Both complete source manifests are byte-identical: 43,592 bytes, SHA-256 `02817ea4607ea396eb4c67c7d9a5239619e6360c6bfa7e7ddd9f99e41cba3dd5`. Independent review matched all 122 modes/blob identities and read/hashed every Git body: 2,353,471 bytes. No checked input drifted.

The browser supervisor child exited 0 without signals. The owned server returned 143 after exactly one TERM, matching locked Next's behavior. Both original groups disappeared; close, EOF, descriptors and bounded stream retention passed; no KILL was used. The task cutoff was 1553. Only exact unchanged pre-task identities with start ticks 902 and 912 were excluded. Marker-scan errors, remaining owned processes and cleanup failures were empty. This is the declared group/marker scope, not host-wide absence; filesystem scratch deletion was not recorded.

The [originals manifest](local-import-attempt-5/originals.json) binds all 18 complete decoded captures and the full lossless job log. Original log: 849,016 bytes, SHA-256 `1bc3fa3f9f600f1ba9643675bc697e138fdd401c7e5b214f9ff59a8855fce226`. Original browser report: 341,917 bytes, SHA-256 `08fd0daa97c4ba23f002aa7cc80812273d89baa79cba50d703c38c8f508be3ef`. Each archive records compressed and uncompressed identities. Chunk completeness, gzip, sizes and SHA-256 were verified before exclusive preservation.

All four failed packets remain separate and false: [attempt 1](local-import-attempt-1.md), [2](local-import-attempt-2.md), [3](local-import-attempt-3.md), [4](local-import-attempt-4.md). The temporary workflow was disabled after terminal success and removed; its checked bytes remain in the [inactive example](../../../proposals/local-import-checks.workflow.yml.example).

## Publication boundary

Vercel production `dpl_J5ZPhyWokYaNF9gYzRE13LqH2L3R` was observed READY at checked source `3b06822cf61ad5a18c0029004366f000a5f9db7f`, assigned to [Sift](https://sift-analytics.vercel.app). The deployment requested Node 24 and frozen `npm ci`. The subsequent receipt/workflow-retirement edition preserves the checked runtime and browser-test inputs; deployment identity refers to the tested source, not a later documentation commit.

An anonymous local GET could not obtain any HTTP status because DNS failed; its [original observations](hosted-http-local/manifest.json) remain negative. An independent public web fetch also returned unavailable. Neither is evidence of a site outage or hosted success. A separate read-only remote HTTP check is prepared; hosted-bootstrap results are owned separately from this browser packet.

General/private files, TSV/JSONL/Parquet edges, other browsers, physical devices, power loss, natural race timing, live PostgreSQL, Docker and a real AI session/model turn remain unverified. SIFT_SESSION_SECRET setup remains owner-deferred. Local heavyweight execution remains withheld by Storage Guard (10.8 GiB free versus 34 GiB required); the application/runtime acceptance above belongs to the owned CI runner.
