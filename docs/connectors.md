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
| `importFile(file, sheet?)` | A persisted local `Dataset` |
| `listWorkbookSheets(file)` | Local XLSX sheet names |
| `query(sql, datasets, signal?)` | Validated, bounded `QueryResult` |
| `restoreFiles()` | Restored file datasets |
| `getRestoreErrors()` | Local restoration errors to display |
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
