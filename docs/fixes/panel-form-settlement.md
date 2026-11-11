# Preserve the current Add-panel form

An Add-panel query captured its submitted panel and destination view correctly,
then unconditionally closed the dialog and cleared the shared title after the
query finished. Closing it and opening another panel or a new-view draft while
the query ran let the older completion erase the newer form.

`createPanelFormLease()` in [`lib/panel-form.ts`](../../lib/panel-form.ts) owns the
actual manual submission. A synchronous request guard refuses duplicate submits.
The submitted result can still append to its captured view in the current
workspace; it does not replace that view's current panels or recreate a deleted
view. Closing, replacing or editing the form invalidates only its right to reset
the dialog. The same request may close and clear an unchanged form after its
result is committed. Component disposal invalidates the request's lifetime too,
so an older callback cannot write through a later mount or release its request.

The component invalidates form ownership at modal/inspector transitions, draft
edits, view changes and replacement-form submissions. This does not change query
controllers, refresh semantics or import cancellation. The earlier panel-result
reconciliation remains a separate boundary.

Eight authored deferred-promise cases target the production coordinator: unchanged
owner, synchronous duplicate/release, old request/new panel, in-place edits,
replacement dialogs, view/form ABA, unmount/remount, and evaluation rejection/retry.
All eight pass with the existing Node installation, and the narrow helper/test
type check passes after a retained test-only type annotation correction. See
the [actual result](../results/2026/11-09/panel-form.md). These T1 checks do not
establish React, DuckDB, browser, provider or physical-device behavior.

On 11 November, [six production-browser cases](../results/2026/11-11/panel-form-browser-checks.md)
passed with actual React dialogs, native DuckDB results, persistence/reload,
deleted destinations and an authentication-driven remount. The browser hook
controls delivery of one authored query or session response; it supplies no
query result. The earlier eight coordinator cases remain separate. This closes
the exercised browser-integration gap while retaining provider, hosted and
physical-device limits.
