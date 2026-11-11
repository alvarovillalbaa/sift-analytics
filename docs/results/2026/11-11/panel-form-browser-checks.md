# Add-panel browser verification

All six authored cases passed together in [run 43007822894](https://github.com/alvarovillalbaa/sift-analytics/actions/runs/43007822894)
at source `3e830c04112809afb1bb1be6332051612ede07f5`. The production build,
including Next.js compilation and TypeScript, passed with the frozen application
lockfile. Actual tools were Node 24.22.2, Playwright 1.65.0 and Chromium
158.0.8127.18. Application components, engine, coordinator and dependencies were
unchanged by this verification work.

| Case | Actual result |
| --- | --- |
| F01 desktop | A new table panel returned the authored marker and 432-row sample count; inspection and the definition survived reload. |
| F02 desktop | An older query committed once while a replacement panel's title, bar type and SQL remained open. The new draft submitted independently and both panels reloaded correctly. |
| F03 narrow/touch | The new-view draft survived the older query. Creating the empty view worked, and the old panel remained in its original view after reload. |
| F04 desktop | Deleting the captured destination did not recreate it or populate the survivor. The survivor's open draft remained intact; reload retained only the surviving view. |
| F05 desktop | In-place edits survived the submitted snapshot's completion. The original result was 432 and the edited query returned 7; both definitions and results reloaded correctly. |
| F06 narrow/touch | Releasing the actual session response replaced the React shell. The held old request was terminated before dispatch, with no panel added. A new-lifetime query returned 432 and survived reload. |

The worker hook forwarded each held native `RUN_QUERY` message unchanged.
All four released queries produced a matching native `QUERY_RESULT` with a
706-byte Arrow response. Measured holds were 32.9–399.8 ms, below the eight-second
fixture bound and unchanged ten-second application deadline. F06 observed one
additional DOM shell mount and termination of its held request, with zero native
dispatches for that disposed request. The application state and query values
were not injected by a mock.

All 158 browser HTTP requests stayed inside the finite loopback policy and
finished their bodies. Actual session responses were forwarded unchanged;
their body digests matched. No SQL marker left through a network request,
no page/console error or WebSocket occurred, and all six contexts/pages closed.
Both owned server/browser process groups were absent; four original streams
were fully retained, hash-checked and closed. No marked process or uncertain
process-scan entry remained. Before/after manifests matched all 207 tracked
inputs against their immutable Git blobs, modes, sizes and SHA-256 digests.

[Original packet and byte inventory](panel-form-attempt-2/checksums.json) ·
[Independent verification](panel-form-attempt-2/verification.json) ·
[Browser report](panel-form-attempt-2/browser.json) ·
[Supervisor report](panel-form-attempt-2/run.json)

All six passing PNGs were downloaded, hash-checked and viewed:
[normal result](panel-form-attempt-2/panel-form-F01.png),
[replacement panel](panel-form-attempt-2/panel-form-F02.png),
[new-view draft](panel-form-attempt-2/panel-form-F03.png),
[deleted destination](panel-form-attempt-2/panel-form-F04.png),
[edited draft](panel-form-attempt-2/panel-form-F05.png), and
[new lifetime](panel-form-attempt-2/panel-form-F06.png).
They document the captured form/result states; settled chart animation and
global visual fidelity are outside this packet.

The [first run](https://github.com/alvarovillalbaa/sift-analytics/actions/runs/43006691449)
failed all six cases at an exact dropdown-label selector before submission.
Its [originals](panel-form-attempt-1/checksums.json) remain preserved. The only
test correction selected the unique native non-multiple/multiple controls
within the panel dialog, retaining the same expectations and deadlines. There
was no single twelve-pass invocation. Original logs use lossless gzip with
both decoded and stored byte/hash records.

This is controlled T2 timing over generated sample data and a disposable local
session secret. It does not establish ordinary timing frequency, live models,
PostgreSQL, hosted deployment, physical devices or full-product completion.
The older coordinator/import/HTTP receipts remain separate and were not rerun.
The final documentation/result edition preserves all checked application,
dependency and verification-code bytes; its active temporary workflow is omitted.
