# Render native query results as usable panels

Verify the README's six advertised renderers through the actual production React
app and DuckDB worker. The preceding six panel-form cases are closed and are not
rerun. This scope uses only authored SQL over the deterministic public sample.

- C01: desktop table, metric, bar, line, area and donut; exact inspector values,
  native SVG shapes, nonzero finite settled geometry, bar 1:2:3 value proportions,
  donut labels, explicit refresh and reload.
- C02: the same renderer journey at390px using native Playwright taps. This is
  Chromium mobile emulation, not a physical-device claim.
- C03: exact BIGINT9007199254740993 survives inspector/table display; a chart
  visibly refuses unsafe numeric coercion. A VARCHAR0012 measure is not silently
  charted as a number, and its table retains the leading zeros across reload.
- C04: a real zero-row query renders the empty state; a subsequent real chart
  works, removing the empty panel stays removed through refresh and reload.

Worker.postMessage observation forwards the original message and transfer list
unchanged. No held delivery, query value, result, chart, layout, ARIA or clock
mock is used. The observed native request IDs and QUERY_RESULT byte lengths are
retained with DOM geometry and inspector checks. App result rows are not injected
into storage: only the real UI creates views/panels. Storage snapshots must omit
result/error rows and preserve the sample's datasets, original view and metrics.

One public Ubuntu24.04 CI job, maximum20minutes, uses the existing frozen app
lock, Node24.22.2 and separately pinned Playwright1.65.0. An ephemeral signing
secret exists only in the owned Next server's child environment. Finite loopback
request policy permits static/DuckDB assets and the real empty-body session POST;
agent, provider, upload, PostgreSQL and external requests fail the checks. Each
disposable context restores its own original storage and closes its page/context;
the existing supervisor checks terminal streams and owned process groups.

Retain all failed packets without relabeling them. Four screenshots and bounded
source/runtime originals are uploaded before temporary control retirement. Keep
runtime/dependencies unchanged unless an actual failure establishes a defect.
No paid plan, new account, model call, production data/configuration or database
is needed. Storage Guard failed4.9/34GiB locally; no local install/build/browser.
Standing all-work/check/temporary-CI approval applies to this named scope.
