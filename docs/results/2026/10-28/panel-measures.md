# Explicit numeric panel measures

28 October 2026. The all-project goal remains active.

The [architecture](../../../architecture.md) requires returned column types to
preserve text identifiers and exact analytical values. At baseline
`004f248717ba35e52b1a0dcc36eaf518c7dae42e`, explicit `yKeys` bypassed numeric
inference. A metric bound to a VARCHAR `customer_id` containing `00123` displayed
`123`; charts could receive nonnumeric, mixed or absent explicit measures.

`components/PanelCard.tsx` now requires selected metric/chart measures to exist
in the returned columns and pass the existing numeric-type predicate. Invalid
explicit selections show the existing query-review state without substituting
another measure. Tables, source rows, inspector callbacks, exports, numeric
inference and exact-precision handling retain their existing paths.

## Focused verification

The [portable receipt](panel-measures.json) records ten authored frontend cases,
source/harness/output hashes and actual results. Existing Node 24.21.0 and
TypeScript 5.9.3 transpiled and directly called the actual TSX with JSX, hooks,
icon and chart-module boundaries stubbed. Current source passed **10/10**;
the identical harness at baseline passed five and failed five. No cases were
cancelled, skipped or TODO. Raw TAP identities, plans, totals and hashes were
independently checked without rerunning the cases.

The five baseline failures cover text identifiers, missing metric columns,
text/mixed/missing chart measures and timestamp metrics. Passing regression
cases cover DECIMAL/null values, typed and legacy inference, exact large values,
date labels, table identifiers, unchanged row objects, inspector access and
loading/error/empty precedence. TypeScript syntax and `git diff --check` pass;
independent source review found no further concrete regression in this scope.

Checked component SHA256:
`6876f3d4e177fb780885b70cec1a273730542b4a6445f067afa0ef3d68d787a5`.
Temporary harness SHA256:
`91f7a3746caa964c436c768a2cdd84941b888e6e3b3444107be5c48c5315dca1`.
The bounded temporary harness and raw outputs are removed after receipt closure.
No permanent test mirroring this small presentation change was added.

These checks do not run React/Recharts implementations, a DOM, browser, DuckDB,
backend, database, model or provider. No dependency installation, local build,
broad TypeScript compile, server, Auth/secret/configuration or CI change occurred.
Live imports, panel interactions and rendering remain browser acceptance work.
The explicitly deferred `SIFT_SESSION_SECRET` remains deferred.

## Publication

GitHub source and hosted-build evidence will be recorded after publication.
Static/source checks alone do not establish the live rendering or conversational
acceptance documented in the [release record](../../../release.md).
