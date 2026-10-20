# Sift

A conversation with your data. Sift turns questions into reproducible dashboards with movable, resizable panels. Built with **Vercel eve**, Next.js, and browser-local DuckDB.

## What you can do

- Explore a ready-to-use SaaS revenue sample.
- Import **CSV, TSV, JSON, JSONL, Excel XLSX, and Parquet** files (up to 20 MB each). Choose workbook sheets. Files remain in your browser's IndexedDB.
- Ask eve to create saved dashboard views or plan an analysis over your selected datasets.
- Render metrics, line/area/bar charts, donut charts, and tables. Drag and resize panels; layouts and query definitions survive reloads on the same browser and origin. Results are recalculated locally.
- Inspect SQL, sources, execution times, freshness, and truncation. Export views/workspaces as JSON and query results as CSV.
- Connect administrator-configured **PostgreSQL** tables through a token-protected, read-only server adapter.
- Define approved business metrics and independently control schema sharing and query-result sharing with AI.

This release implements the SQL-and-files foundation. Warehouse, SaaS, semantic-layer, federation, private-worker, and stream adapters are extension targets; they are not advertised as working connectors. See the [support matrix and SDK](docs/connectors.md).

## Run locally

Use Node.js **24** or newer.

```sh
npm ci
cp .env.example .env.local
# Set SIFT_SESSION_SECRET to a random value of at least 32 characters.
# Set AI_GATEWAY_API_KEY for model access outside Vercel.
npm run dev
```

Open `http://localhost:3000`. The data engine and manual SQL panels work without model credentials. Conversational analysis needs a working AI Gateway connection. The configured model is `openai/gpt-6-luna` in `agent/agent.ts`.

The sample starts with schema/result sharing enabled because it contains generated public sample data. Importing a file or connecting PostgreSQL turns both settings off. Enable the settings explicitly to analyze your own schemas and request AI explanations.

## PostgreSQL

Set `SIFT_ACCESS_TOKEN` and `SIFT_POSTGRES_CONNECTIONS` on the server, then enter the deployment access token in **Data sources → PostgreSQL**. Use a dedicated database role with `SELECT` privileges only on the approved reporting tables or views. Configure credentials through your host's secret manager.

```json
[
  {
    "id": "reporting",
    "name": "Reporting database",
    "url": "postgresql://read_only:CHANGE_ME@database.example:5432/analytics?sslmode=verify-full",
    "tables": ["reporting.orders", "reporting.customers"]
  }
]
```

No arbitrary database URL is accepted from public HTTP requests. Only configured tables can be discovered and queried. Queries use a read-only transaction, a 10-second statement deadline, a built-in function allowlist, and a 1,000-row result limit. This initial deployment access token gives its holder access to all configured connections; it is intended for a private team deployment, not distinct tenant ACLs.

## Privacy and evidence

Uploaded file bytes never go to an upload endpoint or to eve. With schema sharing enabled, names, columns, types, and metric definitions go to the deployment's model provider. With query-result sharing enabled, up to 50 rows per analysis query may also be shared and retained in the server conversation history. These can be raw values; choose the setting accordingly.

Local workspace definitions are stored in localStorage; files use IndexedDB. Query results remain in memory unless exported or explicitly shared in conversation. Clearing site data removes local files and definitions. Server-side conversations use eve's durable session storage. Signed, HttpOnly browser identity and session-grant cookies enforce conversation ownership. Start a new conversation when a session grant expires after 24 hours.

Files do not sync between devices. Use JSON/CSV exports to keep a copy. The app does not claim that two connected sources can be joined without a common approved execution engine and a modeled relationship.

## Deployment

See [Vercel and self-hosting](docs/deployment.md), [architecture](docs/architecture.md), and [connector SDK](docs/connectors.md). eve is preview software; the dependency lockfile captures this release's framework versions.

## License

MIT. See [LICENSE](LICENSE).
