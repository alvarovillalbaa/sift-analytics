import { createHash, timingSafeEqual } from 'node:crypto';
import { Client, types as pgTypes } from 'pg';
import { analyzeReadOnlySql } from './sql-policy';
import type { Dataset, QueryResult, Value } from './types';

export type PostgresConfig = { id: string; name: string; url: string; tables: string[] };
const POSTGRES_TYPE_NAMES = new Map(Object.entries(pgTypes.builtins).map(([name, oid]) => [Number(oid), name]));
export function connections(): PostgresConfig[] {
  const value = process.env.SIFT_POSTGRES_CONNECTIONS;
  if (!value) return [];
  const parsed = JSON.parse(value) as PostgresConfig[];
  if (!Array.isArray(parsed) || parsed.some(c => !/^[a-z0-9_-]+$/i.test(c.id) || !c.name || !c.url || !c.tables?.length || c.tables.some(t => !/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(t)))) {
    throw new Error('Invalid PostgreSQL server configuration. Use schema.table allowlists.');
  }
  return parsed;
}
export function authorize(request: Request): boolean {
  const configured = process.env.SIFT_ACCESS_TOKEN;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '');
  return Boolean(configured && supplied && timingSafeEqual(createHash('sha256').update(configured).digest(), createHash('sha256').update(supplied).digest()));
}
async function withClient<T>(config: PostgresConfig, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: config.url, connectionTimeoutMillis: 5000, query_timeout: 12000, application_name: 'sift-read-only',
    types: { getTypeParser(oid, format) {
      // Keep calendar timestamps and microseconds out of JavaScript Date's timezone/millisecond conversion.
      if (format !== 'binary' && [1082, 1114, 1184].includes(oid)) return (value: string) => {
        if (oid === 1082) return value;
        const timestamp = value.replace(' ', 'T');
        return oid === 1184 ? timestamp.replace(/([+-]\d{2})$/, '$1:00') : timestamp;
      };
      // Preserve exact numeric/JSON/array/custom-type text; native JSON.parse and array parsers can round values.
      if (format !== 'binary' && ![16, 21, 23, 700, 701].includes(oid)) return (value: string) => value;
      return pgTypes.getTypeParser(oid, format);
    } },
  });
  try { await client.connect(); return await fn(client); } finally { await client.end().catch(() => {}); }
}
export async function discover(): Promise<Dataset[]> {
  const datasets: Dataset[] = [];
  for (const config of connections()) {
    await withClient(config, async client => {
      for (const table of config.tables) {
        const [schema, name] = table.split('.');
        const columns = await client.query<{ name: string; type: string }>('SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', [schema, name]);
        if (!columns.rows.length) continue;
        datasets.push({ id: `pg:${config.id}:${table}`, name: `${config.name} / ${name}`, table, sourceId: config.id, kind: 'postgres', columns: columns.rows, rowCount: -1, updatedAt: new Date().toISOString() });
      }
    });
  }
  return datasets;
}
export async function queryPostgres(sql: string, datasetIds: string[]): Promise<QueryResult> {
  const configs = connections();
  const selected = datasetIds.map(id => {
    const [, connectionId, table] = id.split(':');
    const config = configs.find(c => c.id === connectionId && c.tables.includes(table));
    if (!id.startsWith('pg:') || !config) throw new Error('Dataset is outside the approved connection scope.');
    return { config, table };
  });
  if (!selected.length || selected.some(s => s.config.id !== selected[0].config.id)) throw new Error('Choose datasets from one PostgreSQL connection. Cross-source joins need an approved shared engine.');
  const policy = analyzeReadOnlySql(sql, selected.map(s => s.table), 'postgres');
  const validated = policy.sql;
  const start = Date.now();
  const rows = await withClient(selected[0].config, async client => {
    await client.query('BEGIN READ ONLY');
    try {
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query('SET LOCAL search_path = pg_catalog');
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '12s'");
      const result = await client.query(`SELECT * FROM (${validated}) AS sift_result LIMIT 1001`);
      if (new Set(result.fields.map(f => f.name)).size !== result.fields.length) throw new Error('Give each selected column a unique alias.');
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  });
  const values = rows.rows.slice(0, 1000).map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : typeof v === 'bigint' || typeof v === 'number' && !Number.isFinite(v) ? String(v) : (v ?? null) as Value])));
  return { sql: validated, columns: rows.fields.map(f => f.name), columnTypes: Object.fromEntries(rows.fields.map(f => [f.name, POSTGRES_TYPE_NAMES.get(f.dataTypeID) ?? `oid:${f.dataTypeID}`])), rows: values, rowCount: values.length, truncated: rows.rows.length > 1000, elapsedMs: Date.now() - start, executedAt: new Date().toISOString(), sources: selected.filter(s => policy.tables.includes(s.table)).map(s => ({ name: `${s.config.name} / ${s.table}`, refreshedAt: new Date().toISOString() })), approximate: false };
}
