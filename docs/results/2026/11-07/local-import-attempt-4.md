# Local import checks — attempt 4 failed on narrow navigation

[Run 42407606569](https://github.com/alvarovillalbaa/sift-analytics/actions/runs/42407606569), job `128508584671`, checked `cfcdfbf28c63526a2619dc03b32f20e64e2861cc`. Its overall verdict remains **failed**. Five fixture/22 selection checks, actual production build and byte-identical strict 102-file source guards passed. Both manifests have SHA-256 `7dd80bdd473d0bcdf34a704e6cf308a3a1c78c308f74663ef86915c165fa8b3b`.

- **L01 passed:** the explicit four-file subset imported, malformed JSON failed independently, retry preserved successes, reload preserved bytes/IDs/order, and actual manual SQL returned 49 across six rows. The 9,999-value decoy remained absent.
- **L02 failed:** ordinary narrow touch controls completed import/retry/reload, but the `Close navigation` button's center was intercepted by the sidebar. Its entire viewport hit rectangle extended behind the 226-pixel drawer. Aggregate SQL was not reached. The follow-up restricts the mobile scrim to the exposed region; no forced-coordinate tap or assertion waiver is added.
- **L03 passed:** the explicit native-commit/late-Stop control retained its committed file and retried only the queued file.
- **L04 passed:** real sheet selection imported South=9 instead of North=99, actual SQL and reload returned 9, and the separately injected missing-metadata reload retained the same file with both sharing flags off.

All eight actual session POSTs returned 503 and completed both `response.finished() === null` and `requestfinished` under the retained deadlines. There were zero request failures, boundary violations or unexpected console errors. These are positive observations after the client-body-read change, not a retrospective causal explanation of [attempt 3](local-import-attempt-3.md).

Every context/page closed normally. The server's exact TERM→143 path, EOF/descriptors and original groups closed; zero marker-scan errors or remaining owned processes were observed, with two exact pre-task identity exclusions. The supervisor still correctly failed on the browser child's exit 1.

The [originals manifest](local-import-attempt-4/originals.json) binds all 17 complete decoded captures, including three screenshots, and the full lossless job log. Original log: 852,232 bytes, SHA-256 `be2b6c1236bb90b81a6eeefa762ca4f8201d798812c0f6d57557fcbea4264328`. Browser report: 320,740 bytes, SHA-256 `dc3d33375771a4f8ac0dad1eadd4dd5ed9d1a77b188644cd091738f72fbfeda6`. Large JSON/log captures are losslessly compressed; their original identities remain in the manifest. No hosted, model, PostgreSQL or physical-device acceptance is claimed.
