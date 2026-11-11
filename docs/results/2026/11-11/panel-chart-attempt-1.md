# Chart renderer attempt1 — browser cases unrun

[Run43060125760](https://github.com/alvarovillalbaa/sift-analytics/actions/runs/43060125760),
job130660085578, failed at source45135cb4f2168f0ebdfdc0835bcf973756bb099b.
The production build passed. Both source guards passed and their complete
230-file manifests match each other; independent local comparison matched every
unchanged baseline or frozen task input. No browser/server supervisor launched:
C01–04 are **UNRUN**, with no chart or browser acceptance from this attempt.

The separately exported [failed setup log](panel-chart-attempt-1/chromium-setup.failed-step.gh.log.gz)
records Ubuntu apt mirror DNS resolution failures and the three-minute setup
deadline. Playwright/package integrities had already passed; optional
`install --with-deps chromium` was waiting on system packages. The next source
downloads Chromium only and leaves its actual launch/libraries check mandatory.
No assertion is removed or converted to a pass.

[Originals and hashes](panel-chart-attempt-1/checksums.json) retain five Actions
artifact members plus the separately labelled `gh run view --log-failed` export.
Log gzip round-trips reproduce their exact captured bytes. This export is not
claimed as the original server-side job ZIP. The source JSON and tool lock stay
unchanged. Runner disposal, task process absence and temporary disk removal were
not observed here and remain unverified; a terminal job is not cleanup proof.

No application/dependency change, provider/model request, account, database,
production configuration or local build/browser was introduced.
