# Preserve panel edits when queries finish

9 November 2026. The old refresh and AI-plan settlement paths copied an entire
captured panel back over current state. A move or resize performed during the
query could therefore be reverted when its result arrived.

`lib/panel-results.ts` now merges only result/error fields into current panels,
with an exact panel-ID/SQL/ordered-dataset match. Both refresh and AI-plan paths
use it. Current presentation, layout and order survive; removed panels stay
removed. An interrupted plan marks only its own still-matching unexecuted
queries as needing refresh and clears their stale rows.

Verification used existing Node26.8.2 and TypeScript7.0.2, without installing,
building or launching the application. All12pure-data cases passed on their
first run, covering layout/presentation, changed query scope, complete/falsy
results, failure cleanup, interruption, later additions, order/deletion and
immutable inputs. The targeted helper/test type check passed with strict mode
and library checking enabled. `git diff --check` passed. Full independent source
review covered the helper, tests and both integration paths.

The first compiler invocation exited1 before checking files with TS5112:
`tsconfig.json is present but will not be loaded if files are specified on commandline.`
The corrected invocation uses the compiler's requested `--ignoreConfig` and
supplies the focused options explicitly. No source or check was disabled.
Original command outputs, including the first failure and Node's module-type
warning, remain in the private task receipt; its byte/hash projection is in
[the verification record](../results/2026/11-09/panel-results.json).

These checks exercise the actual pure reconciliation helper. They do not
execute React, DuckDB, the agent or a browser, and do not establish newest-
request ordering for overlapping executions of the same query. Previous
import/HTTP/browser receipts retain their original sources and were not rerun.
Provider build and delivery observations, if obtained, are separate evidence.

Reproduce the focused checks with the existing compatible tools:

```sh
node --test tests/unit/panel-results.test.ts
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --allowImportingTsExtensions --esModuleInterop --types node --skipLibCheck false lib/panel-results.ts tests/unit/panel-results.test.ts
git diff --check
```
