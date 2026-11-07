# Local import checks — attempt 1 failed

The [original run](https://github.com/alvarovillalbaa/sift-analytics/actions/runs/42405198982), job `128501296706`, checked source `9902661a00afb36fafe8fe6d53f523cce84a1c22` through activation `06217c67e9ab49a42f6295b2f3aea9886fba9415`. Its verdict remains **failed**. Chromium installation and all four browser cases were **unrun**.

On Node 24.22.2, five authored fixture checks and 22 selection checks passed. Frozen installation, eve build and Next compilation completed; Next's TypeScript gate then refused the deliberately throwing `ArrayLike<File>` test getter: `tests/unit/local-import.test.ts:143`, TS2322, `void` is not assignable to `File`. The correction adds the explicit `: File` return annotation without changing the assertion or excluding tests.

The strict source guard independently failed because locked Next 16.4.2 regenerated only `next-env.d.ts`: 81 to 288 bytes, unchanged mode, SHA-256 `879741880b6ab48da99dcc06dcc674d381c9826137b0496bf7bb368f302de9fc` to `1862ac4bbbc5192d4bf562161df66ea547ed3e67173100656ab606ae9797db2b`. All other 57 tracked files were unchanged. The locked generator's source independently reproduces that exact output. The follow-up refreshes this declaration using `writeAppTypeDeclarations`; it does not hand-edit generated text or relax source guards.

The [originals manifest](local-import-attempt-1/originals.json) binds six complete decoded captures and the losslessly compressed full job log. Chunk completeness, gzip bytes, lengths and SHA-256 were checked before exclusive preservation. Uncompressed job log: 65,039 bytes, SHA-256 `966df0a15e737ccb67bc260dec35e3ce08df1ac542be3a1565875d7010c3c876`. No later result changes this failed verdict.

Local build/browser execution remains withheld by Storage Guard: 10.8 GiB free versus 34 GiB required. A separate local compiler-API syntax probe could not start because TypeScript 7 exposes version metadata rather than the former JavaScript compiler API; it supplies no source-check pass. The existing local metadata checks passed separately on Node 26.8.2. No database, live model or production-data acceptance is claimed.
