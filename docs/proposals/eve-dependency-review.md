# Sift Eve transport and native event repair

Date: 2026-11-14. Approved by Alvaro’s standing instruction to finish the work,
including dependency, focused check, temporary CI and publication scopes.

The unchanged `4dc2bc00c03611f6c01a916914480615bfc7dfbb` lock has Eve 0.81.1
and its nested Undici 8.10.2. The metadata-only npm audit reports two affected
package entries covering eight Undici advisories. Eve 0.88.1 carries Undici
8.12.3, including the 8.12.2 security corrections. Update Eve using its native
v27 API. Pin other direct dependencies to their existing locked versions;
allow only Eve and its nested Undici package nodes to change. A graph override
would not establish that Eve’s bundled transport was patched.

Keep Sift’s model, signed browser identity, session grant lifetime, upload
refusal, SQL policies and explicit schema/result sharing unchanged. Accept
native `answers`/`interactionId`, the SDK’s opaque inbox and nullable cancel
scope within the already authenticated session. Expose native `/end` in place
of `/reset`; New conversation remains a local SDK reset. The 80,000 input,
12,000 output and reported $0.25 usage thresholds use `sessionUsage`. The
24-hour SDK timeout now measures idle time; the signed session grant still
expires after 24 hours. Reported-cost checks are not a hard provider billing cap.

Use the version-pinned SDK’s `convertLegacyEvents`, with unchanged session
cursor and native reader metadata. Before replacing the old browser cache,
retain its exact bytes at `sift-chat-before-v27`. Invalid/unsupported caches,
quota failures, conflicting backups and stale tabs must remain recoverable.
Explicit New removes the current cache before resetting the local hook and
cannot be undone by a late snapshot. If recovery is needed, New first exports
both raw copies. This does not remove the existing before-upgrade backup.

Existing raw tool-call receipts retain their old meaning **only for the session
restored from the pre-upgrade cache**. This is a scoped data-preservation
exception, not a general compatibility layer. New sessions qualify plan IDs
and receipts with their session ID; view and receipt persist atomically.
Do not invent ownership for older raw receipts from other historic sessions.

## Bounded qualification

Local Storage Guard requires remote installation/builds. One public Ubuntu job
on `qa/sift-eve-20261114`, at most 20 minutes per run, resolves the lock without
scripts or installing. Retain that generated lock, commit it, then run the same
job against exact matching source. Require a zero-finding audit, `npm ci`, the
34 focused authored checks, TypeScript and the existing production build
(including Eve). Check source hashes before/after and remove only runner-owned
dependencies, build outputs and temporary cache. Disable/remove the active
workflow and remove its owned branch after publication; retain its source,
receipts and failures in history/evidence.

Checks cover 11 persistence cases using a fixture captured by the real installed
0.81.1 store with no transport attached, 10 channel/auth boundary cases, 10
actual WorkspaceApp callback/effect cases and three usage thresholds. The new
SDK fold/converter/selectors are real; React hooks/JSX, browser storage, query
results and messages are authored harness state. The create-handler grant test
stubs dispatch explicitly. These are T2 checks, not browser, live workflow,
model, PostgreSQL or physical-device acceptance. Do not replay earlier accepted
DuckDB/import/chart browser journeys.

After a passing source qualification, inspect the actual Vercel deployment and
bounded anonymous home/health/bootstrap HTTP responses. Leave the owner-deferred
`SIFT_SESSION_SECRET` and provider/PG settings untouched; do not retry their
unchanged permission gates. No account, paid plan, model/provider call, user
data or production mutation is part of these checks.

## Primary sources

- [Eve 0.88.1 release](https://github.com/vercel/eve/releases/tag/eve%400.88.1)
- [Pinned native event upgrade guide](https://github.com/vercel/eve/blob/eve%400.88.1/docs/concepts/upgrade-to-v27-events.md)
- [Undici 8.12.2 fixes](https://github.com/nodejs/undici/releases/tag/v8.12.2)
- [Undici 8.12.3](https://github.com/nodejs/undici/releases/tag/v8.12.3)
