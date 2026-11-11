# Add-panel browser verification

The form-ownership repair has eight passing coordinator cases. Its React wiring,
real DuckDB results and browser persistence remain unverified together. This
packet runs the production app with six private Chromium contexts and generated
sample data, under the standing all-work approval.

| Case | Observable behavior |
| --- | --- |
| F01 desktop | Submit a real SQL panel, inspect its 432-row aggregate, and retain its definition across reload. |
| F02 desktop | Hold one native worker query, close its dialog and open a new panel draft. Its result commits once while the newer draft survives and can submit. |
| F03 narrow/touch | Replace the pending panel with a new-view draft. Completion preserves that form; creating the view still works. |
| F04 desktop | Delete the pending query's destination while another view survives. Completion does not recreate the deleted view or erase the survivor's open draft. |
| F05 desktop | Edit the submitting form in place. The submitted snapshot commits while the edited draft survives and can submit separately. |
| F06 narrow/touch | Delay the actual loopback session response, submit a local query, then release authentication. The real React remount cancels the old worker request without adding its panel, and a new submission works. |

Queries use the actual DuckDB worker. A browser-only hook holds the outbound
`RUN_QUERY` message containing a fixed authored marker, preserving the message
and transfer arguments. Releasing it invokes native `postMessage`; native response
identity and returned UI values are observed. Holds stay below eight seconds,
within the unchanged ten-second application query deadline. No result is supplied
by a mock and no application state or production testing hook is added.

The session endpoint uses a fresh random signing secret in the disposable
loopback server. F06 holds its actual successful response, then fulfills that
same response without modifying its body or headers. No agent session, account,
database, model request or production configuration is created or changed.
All browser HTTP traffic is limited to loopback app assets and `/api/session`;
an authored SQL marker in any network request is a failure.

Use one public Ubuntu 24.04 job capped at twenty minutes, Node 24.22.2, the frozen
application lockfile and isolated Playwright 1.65.0 with its recorded integrity.
The existing production server/browser supervisor retains its deadline, process
identity, stream and teardown checks. Its old local-import scope stays the default;
the new explicit panel-form scope selects only these six cases. Source manifests
bind all tracked files before and after execution. Keep original logs, JSON and
at most six bounded screenshots. Retire the temporary active workflow and task
branch after terminal publication. An inactive workflow example remains.

These controlled timing cases establish the exercised UI seams, not ordinary-user
timing frequency, physical-device behavior, live models or PostgreSQL. The older
unit/import/hosted receipts are separate and are not rerun by this packet.

[Playwright response forwarding](https://playwright.dev/docs/api/class-route#route-fetch)

The [first run](https://github.com/alvarovillalbaa/sift-analytics/actions/runs/43006691449)
passed the frozen build but all six cases stopped at the exact Visualization
label lookup before submitting any query. Actual desktop/narrow screenshots
show the native dropdown present. The corrected selector matches the existing
import-check pattern: one non-multiple select and one multiple select within the
panel dialog, with explicit uniqueness assertions. No application code, timing,
case expectation or result is changed. [Original packet](../results/2026/11-11/panel-form-attempt-1/checksums.json)
retains all raw files. Both source manifests match all 189 source inputs; all
contexts/pages and response bodies closed, both child groups were absent and no
marked process remained. The browser exit-one/supervisor failure stays recorded.
