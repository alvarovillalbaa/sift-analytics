# Local import checks — attempt 3 failed at startup

[Run 42407046929](https://github.com/alvarovillalbaa/sift-analytics/actions/runs/42407046929), job `128506879642`, checked `e3a47a915be3245790cc7707def6d0dbd5660691`. The verdict remains **failed**.

Five fixture and 22 selection checks, the actual production build, and strict 85-file source guards passed. Both complete source manifests have SHA-256 `6db9701ed23be68e6e22f1ee01911d6a88feb5da77ea2662c09e1eae9fdc8ffc`.

All four Chromium cases loaded the application/engine, then stopped at the new startup completion gate. Each actual `/api/session` POST received 503 headers, but neither `response.finished() === null` nor its `requestfinished` event was observed within ten seconds. Each retained `session_finished_timeout`. No request failure/abort was observed in this attempt. Folder selection, workbook selection, imported-file snapshots, manual SQL and the injected commit race were not reached; no screenshot was produced. This does not rerun or invalidate the separate L03 functional observation from [attempt 2](local-import-attempt-2.md).

Native context/browser closure and owned supervisor cleanup completed. The expected server returned 143 after exactly our TERM; its streams closed and original process group disappeared. Two exact unchanged identities born before the recorded task cutoff were excluded. There were zero scan errors and no remaining marked owned processes. The overall supervisor still failed because its browser child returned 1.

The follow-up makes the existing client consume its small session response body before handling success/error. Previously it discarded that body. This is a conservative response-lifecycle correction; whether it resolves the observed completion gate remains a new check, and no cause is assigned to earlier aborts/timeouts. Authentication settings, status expectations, all four cases, deadlines and fatal failure gates remain unchanged.

The [originals manifest](local-import-attempt-3/originals.json) preserves all 14 complete decoded captures plus the full losslessly compressed log. Original log: 107,657 bytes, SHA-256 `8ed20bb1ae85e68551b8c956ef724c5f6deab746eb2944f5a2abbd1466bb221e`. Original browser report: 18,263 bytes, SHA-256 `fde471ddc7364b08d221c141616171bc33d042cd92da342df57ac53ccd3a6370`. Earlier failed packets remain immutable. No hosted, provider/model, database or physical-device acceptance is claimed.
