# Panel-form focused verification

Eight unique T1 cases passed against the actual `createPanelFormLease.submit`
coordinator. The corrected invocation on 9 November 2026 at 11:51:51–52 UTC
passed all eight with no failures, cancellations, skips or todos; Node's
reporter duration was 172.630542 ms. The strict helper/test TypeScript check
also passed. [Machine record](panel-form.json) binds the checked sources,
commands, timings and private-original byte/hash records.

The cases cover commit-before-reset for an unchanged form; synchronous duplicate
suppression and request reuse; an older result committing while a new form
survives; all four draft-field edits; replacement dialogs/inspector; view/form
ABA transitions; unmount/remount and old-request release; and evaluation
rejection followed by retry. Results are authored deferred values, not live
queries. Independent source review also checked the component's actual
invalidation paths and captured-view/current-workspace append.

The first invocation remains separate: eight cases passed at 11:49:42–43 UTC
(172.896209 ms reporter duration), then its narrow type check failed with
TS2345. The assertion typings narrowed an empty `committed` array to `never[]`
before PF08's retry callback. The only correction was the erased `as string[]`
annotation on that empty expected array. It preserves every runtime assertion
value, case ID and control-flow step; the first checked source and failure
originals remain retained. There was no single sixteen-case run, and the earlier
[twelve reconciliation cases](panel-results.json) were not rerun.

Checks used existing Node 26.8.2 and TypeScript 7.0.2 without installing tools or
changing package configuration. Node's `MODULE_TYPELESS_PACKAGE_JSON` warning
is preserved in both unit outputs. Raw outputs contain private local paths and
remain in private task notes; this public receipt publishes safe command
descriptions, counts and digests, not raw originals.

These checks establish the pure coordinator seam and its narrow types. They do
not execute React, DuckDB, the agent, an application build or a browser, or prove
the UI race at runtime. Publication and production observations remain pending
separately. See the [implementation note](../../../fixes/panel-form-settlement.md).
