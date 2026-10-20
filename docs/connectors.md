# Connectors and SDK

Last updated: 2026-10-20

Sift separates a source, an access mode, and an execution location. A connector is supported only for the behavior its implementation and verification establish. The first implementation contains local files and server-configured PostgreSQL. Other sources require an adapter; the application does not claim universal connectivity.

## Implementation matrix

| Source | Access and execution | Scope and limits | Current verification boundary |
| --- | --- | --- | --- |
| Deterministic SaaS sample | SQL in a browser DuckDB worker | One registered sample table; 432 rows | SQL policy and deterministic generation checked; runtime and rendered results require browser verification |
| CSV / TSV | Local upload → DuckDB worker | 20 MB/file; first row is a header | Implemented; live import, restoration, and edge-case format checks remain acceptance work |
| JSON / JSONL / NDJSON | Local parsing → DuckDB worker | Array of objects or one object per line; nested values become JSON strings; at most 1,000 columns | Implemented; live format and type verification remains acceptance work |
| Excel XLSX | Local workbook/sheet selection → DuckDB worker | Header row plus data; 20 MB/file; at most 1,000 columns | Implemented using `read-excel-file`; legacy `.xls` is not supported |
| Parquet | Registered local file → DuckDB worker | 20 MB/file | Implemented; live Parquet/type checks remain acceptance work |
| PostgreSQL | Live SQL on the deployment server | Administrator-configured `schema.table` allowlist; access token; one connection per query; 1,000-row result; 10-second SQL deadline | Adapter and API implemented; no database credentials or live-source proof assumed |
| MySQL, SQL Server, Sheets, warehouses, SaaS, semantic models, streams, private workers | No shipped implementation | No supported mode declared | Extension candidates |

All SQL runs through [`lib/sql-policy.ts`](../lib/sql-policy.ts). It parses one SELECT/WITH statement, checks every base table and subquery against the approved scope, prohibits recursive CTEs and table functions, allowlists analytical functions and casts, and regenerates the validated AST. File readers and network functions are available only to the trusted import path, never to analytical SQL. Results use a 1,001-row probe to return at most 1,000 rows with an explicit `truncated` flag.

File bytes remain on the user's browser and origin. Workspace metadata uses localStorage; uploaded bytes use IndexedDB. The DuckDB worker materializes the selected files in memory and is recreated after cancellation or a deadline. Persisted files and the sample are restored when the next query initializes it. There is no background synchronization, cross-device file storage, arbitrary URL import, or automatic connector discovery beyond the implemented adapters.

### Precision and temporal values

JSON/JSONL numbers are parsed as original numeric tokens before JavaScript can round them. Numeric-only JSON/XLSX columns receive explicit DECIMAL types when the entire column fits within 38 digits and one common scale; larger values or mixed columns become VARCHAR. JSON strings and XLSX text cells remain VARCHAR, preserving identifiers such as `"00123"`. Quoted empty strings remain distinct from null. Nested JSON values retain their number tokens inside the resulting JSON text. XLSX parsing preserves numeric source tokens; it cannot recover precision that Excel already discarded when writing a numeric cell.

DECIMAL query results use Arrow's scale metadata and are returned as exact decimal strings; scale-zero integers can be numbers when they are within JavaScript's safe range. Large integers remain strings. Timestamp serialization reads raw Arrow integer units, preserving microseconds/nanoseconds. A timezone-naive timestamp uses `YYYY-MM-DDTHH:mm:ss[.fraction]` without a suffix; a timezone-aware timestamp is normalized to UTC and ends in `Z`. Dates and times retain their calendar/clock meaning. Calendar values outside the JavaScript date range produce an explicit error; cast them to VARCHAR in SQL to inspect their source representation. Nested, binary, and interval result values also require an explicit VARCHAR cast instead of a potentially lossy generic serialization.

CSV/TSV use DuckDB's source type inference. That inference can choose DOUBLE for decimal tokens or integers beyond its default integer range, and can infer numeric types for identifier-like values. The output serializer cannot reconstruct precision already lost during source inference. For exact high-precision input, use typed Parquet DECIMAL/integer fields or JSON/XLSX with the explicit type handling above. `approximate` reports the connector's population/aggregation guarantee; it does not imply that an inferred floating-point source was exact.

### Resource limits and restoration

Worker module loading and startup have 30-second deadlines; file reading/parsing and import operations also have 30-second deadlines. Analytical SQL retains its 10-second deadline. Saved-file restoration has a 60-second import/replay budget, with any necessary worker startup bounded separately. A deadline or abort terminates the active DuckDB worker. Recovery recreates the sample and replays healthy persisted files; unavailable files remain stored and are exposed through `getRestoreFailures()` for retry or removal. Deleting a failed file does not require that its table successfully registered.

JSON is limited to 100 levels of nesting and one million parsed values per file. JSON/XLSX table conversion is limited to two million cells and 1,000 columns. Workbook ZIP metadata is checked before extraction: at most 4,096 entries, 64 MB total expanded data, and 32 MB per entry; encrypted, split, and ZIP64 workbooks are rejected. These checks reduce expansion risk but do not turn browser parsing into a sandbox. JavaScript timers cannot preempt synchronous JSON/XML parsing; the input and complexity limits bound that work, while worker termination enforces SQL execution deadlines. IndexedDB opening/transactions have 10-second deadlines, and file persistence accepts cancellation before commit. Browser storage limits still apply.

## PostgreSQL configuration

Set `SIFT_ACCESS_TOKEN` to a strong deployment secret. Set `SIFT_POSTGRES_CONNECTIONS` on the server to a JSON array:

```json
[
  {
    "id": "reporting",
    "name": "Company reporting",
    "url": "postgresql://sift_reader:REPLACE_ME@db.internal:5432/analytics",
    "tables": ["reporting.orders", "reporting.customers"]
  }
]
```

Use a dedicated database identity with SELECT permissions only on the approved reporting tables/views. Revoke inherited write, schema creation, and unsafe function privileges. The SQL policy and read-only transaction are application controls; least-privilege database grants remain an independent boundary. Configure TLS and private network reachability through your database and deployment settings. Never put connection URLs in client code or submit them through the public API.

The Data sources screen accepts the deployment access token, then calls `GET /api/postgres` to discover approved tables and column types. Query requests use `POST /api/postgres` with `{ "sql": "…", "datasetIds": ["pg:reporting:reporting.orders"] }` and a Bearer token. The server resolves IDs against its own configuration. PostgreSQL table names in SQL must include their approved schema. Different PostgreSQL connections and local files cannot be joined by this adapter. A frontend abort can stop waiting for a response; the server SQL deadline bounds the underlying job.

Discovery timestamps describe when the schema was discovered, not a warehouse ingestion watermark. Live-query freshness is the query snapshot time. Table row counts can be unknown (`-1`); do not interpret that as an exact population count.

## Connector contract

[`lib/types.ts`](../lib/types.ts) owns `AnalyticsConnector`, `ConnectorCapabilities`, `Dataset`, and `QueryResult`:

```ts
interface AnalyticsConnector {
  id: string;
  name: string;
  capabilities: ConnectorCapabilities;
  discover(signal?: AbortSignal): Promise<Dataset[]>;
  query(sql: string, datasets: Dataset[], signal?: AbortSignal): Promise<QueryResult>;
  close(): Promise<void>;
}
```

Capabilities declare discovery, supported modes (`file`, `live-query`, `semantic`, `sync`, `federation`, `stream`), read-only execution, cancellation, a deadline, a finite result limit, and location (`browser`, `worker`, `server`). Declare only implemented behavior. The reference implementation is `browserConnector` in [`lib/engine.ts`](../lib/engine.ts). PostgreSQL currently uses standalone server functions and an authenticated API rather than an `AnalyticsConnector` instance.

Adapters must resolve dataset identities against their own trusted registry or server configuration. Caller-supplied metadata is not authorization. Restrict all base tables, including references inside CTEs, nested subqueries, and set operations. Enforce read-only behavior, deadlines, result limits, and identity in code and at the source. Do not rely on model instructions or a successful OAuth connection.

`QueryResult` includes the executed SQL, named JSON-safe columns and rows, returned row count, elapsed time, execution time, source names and freshness, truncation, and approximation. `rowCount` counts returned rows; it is not the full matched population. Preserve large integers as strings when converting them to numbers would lose precision. Preserve nulls. Sampled, incomplete, or approximate results must disclose those limitations. A connector that cannot establish completeness must not claim an exact full population.

The current local interface is:

| Function | Result |
| --- | --- |
| `initEngine()` | Registered demo and restored local `Dataset[]` |
| `importFile(file, sheet?, signal?)` | A persisted local `Dataset`; an optional AbortSignal cancels before commit |
| `listWorkbookSheets(file)` | Local XLSX sheet names |
| `query(sql, datasets, signal?)` | Validated, bounded `QueryResult` |
| `restoreFiles()` | Restored file datasets |
| `getRestoreErrors()` | Local restoration errors to display |
| `getRestoreFailures()` | `{ id, name, error }[]` for persisted files unavailable after restoration |
| `deleteDataset(id)` | Remove an uploaded table and its persisted bytes |
| `browserConnector.close()` | Terminate the worker; the next query restores persisted data |

## Conformance and acceptance

[`scripts/check-connector.ts`](../scripts/check-connector.ts) exports `runConnectorConformance(connector, fixture)`. It is an opt-in integration helper, not a claim that a live provider was tested. It requires a disposable fixture larger than the declared result limit, an existing outside-scope table, and an intentionally slow read-only query for that engine. It exercises discovery and types, result envelopes and completeness, forbidden writes and statement stacking, scope rejection, external table functions, cancellation, deadlines, and recovery.

Run it through a TypeScript-capable test runner in the relevant environment. Browser connectors require a browser; importing the helper in Node does not provide browser IndexedDB or workers. Server adapters must be wrapped in the public contract and run against a disposable database with a read-only identity. The helper submits a no-op DELETE to verify rejection; do not point an unverified adapter at production data. A policy error alone does not prove that no network request occurred: instrument network calls and the source during acceptance.

Before labeling an additional adapter supported, record passing evidence for:

1. Approved schema discovery; empty and inaccessible tables; stable IDs and native types.
2. Safe identity handling, denied tables/functions, attempted writes, and revoked access.
3. Nulls, timestamps/timezones, decimals, large integers, special column names, empty results, and provider errors.
4. Complete versus limited populations, sampling, pagination, and approximate aggregates.
5. A real execution deadline, cancellation where declared, and successful recovery afterward.
6. Source freshness, exact executed SQL/native request, and explicit metric definitions.
7. Restore/delete/retention behavior for copied data and prevention of implicit model uploads.

Cross-source joins require an authorized shared execution environment and a defined join grain. A connected CRM and billing API do not establish compatible customer IDs, currencies, periods, or revenue definitions. Provider synchronization, semantic query APIs, and private workers require separate contracts and acceptance evidence.

See [architecture](architecture.md) for the data and model boundaries.
