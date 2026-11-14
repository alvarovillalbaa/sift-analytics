# Eve transport repair and native chat qualification

Sift upgrades Eve 0.81.1 to 0.88.1 and its nested Undici 8.10.2 to 8.12.3.
The 248-entry graph changes only those two package nodes and root dependency
specifications; other direct dependencies are pinned to their existing locked
versions. The unchanged baseline audit reports two affected package entries
covering eight Undici advisories. The generated/published graph reports zero
at the recorded query times. No override or unrelated package upgrade is used.

The [complete normalized receipts](eve-dependency-review.json) preserve the
baseline report, failed harness run, successful qualification, full command
streams and SHA-256 values. Extracted files and every command stream were
verified against their receipts; the artifact ZIP digest was not compared.

## Application behavior

The UI uses native v27 messages, tool parts, view selectors and addressed
interaction answers. Paused turns remain followed and stoppable; explanations
wait for actual turn settlement. Existing schema/result opt-in, upload refusal,
signed browser identity and session grants remain enforced. Native inbox
tokens and nullable cancellation stay within the same owned session. `/end`
replaces the old retirement route; New remains a local SDK reset. A failed
idle replay allows local New, including expired/stranded saved sessions.

The saved cache uses Eve's native legacy-event converter, preserving its cursor
and reader metadata. Original bytes are backed up before replacement. Bad
history, storage failures and stale tabs expose recovery/export controls.
An explicit New clears storage before detaching and late snapshots cannot
resurrect the cleared session. Compare-and-save is not an atomic localStorage
transaction across simultaneous browser tabs. Old raw plan receipts retain
their meaning only for the restored old session; new session IDs qualify all
new receipts/view IDs. Receipt and view still share one workspace update.

Usage callbacks preserve 80,000 input tokens, 12,000 output tokens and reported
$0.25 thresholds. Cached input counts. The 24-hour SDK timeout now means idle
time; the app's signed grant still expires after 24 hours. Cooperative usage
checks do not establish a hard provider billing cap.

## Actual checks

- Lock-generation run [43629048205](https://github.com/alvarovillalbaa/sift-analytics/actions/runs/43629048205) succeeded without installing/running the app. The generated lock SHA-256 is `785f191b7e9364ec53a894982e27ac1a40f03d3a1704808c5b1e737268eecd2f`.
- First qualification [43629190816](https://github.com/alvarovillalbaa/sift-analytics/actions/runs/43629190816) installed the clean graph. Twenty-five checks passed; the channel file failed before its ten checks initialized because the VM omitted `URL`. It did not qualify the app. That failure remains retained.
- Corrected qualification [43629326905](https://github.com/alvarovillalbaa/sift-analytics/actions/runs/43629326905), source `c026994f6fb79d87352a660d999046268e0b8045`, passes **all 35 identities together**: 11 archive, ten channel/auth, 11 actual component callback/effect and three usage cases. Fresh `npm ci`, TypeScript and the existing Eve/Next production build pass under Node 24.21.0/npm 11.19.0. Exact source manifests match; no generated declaration change was needed; runner-owned dependencies/build/cache cleanup passes.

The original cache fixture was captured by the actual installed 0.81.1 store
before upgrading, using ten authored facts and two projected messages. No
transport was attached. An earlier local three-check attempt failed in the
harness because TypeScript 7's main export lacks the old transformation API;
the harness now uses the existing Next SWC API, without a new dependency.
These are **35 distinct identities**, not accumulated passes across retries.

The native SDK converter/fold/selectors execute. React hooks/messages/JSX,
browser storage and SQL results are authored harness state. Channel policy uses
real Request objects, native route inventory/errors and Sift HMAC. The grant
wrapper test explicitly stubs dispatch. These T2 checks do not prove a real
React lifecycle, DOM/browser, hosted Workflow turn, model, PostgreSQL or device.
Previously accepted import/chart/Add-panel browser cases were not replayed.

## Publication boundary

Temporary workflow `418549478` is observed `disabled_manually`; its active file
is removed after all three runs finished. Its exact source remains in Git
history. Release metadata and bounded production HTTP observations are recorded
separately in [the release receipt](eve-dependency-release.json).

No local install/build/server/browser was started below Storage Guard's
2.3/34 GiB measurement. The existing local installed Eve remains 0.81.1;
the fresh CI install and hosted build qualify the upgraded source. The
owner-deferred production signing secret, provider/PG settings and their prior
permission gates remain untouched. No paid plan, real account, customer data,
provider/model call or database migration is involved. The full portfolio
goal remains active and unfinished; this scoped repair is progress.
