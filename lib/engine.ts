'use client';

import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import type { AnalyticsConnector, Dataset, QueryResult, Value } from './types';
import { createDemoRows, demoDataset, DEMO_TABLE } from './demo';
import { loadFiles, removeStoredFile, storeFile, type StoredFile } from './storage';
import { QUERY_ROW_LIMIT, QUERY_TIMEOUT_MS, analyzeReadOnlySql } from './sql-policy';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
type Engine = { db: AsyncDuckDB; connection: AsyncDuckDBConnection; worker: Worker; datasets: Map<string, Dataset> };
let engine: Engine | null = null;
let starting: Promise<Engine> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let restoreErrors: string[] = [];

function exclusive<T>(action: () => Promise<T>): Promise<T> {
  const pending = queue.then(action, action);
  queue = pending.catch(() => undefined);
  return pending;
}
function quote(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
function literal(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
function extension(name: string): string { return name.split('.').pop()?.toLowerCase() ?? ''; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Unknown local data error.'; }
function checkFile(file: File): void {
  if (!file.size) throw new Error('This file is empty.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose a file smaller than 20 MB.');
  if (!['csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xlsx', 'parquet'].includes(extension(file.name))) {
    throw new Error('Choose a CSV, TSV, JSON, JSONL, XLSX, or Parquet file.');
  }
}
function csvCell(value: unknown): string {
  if (value == null) return '';
  const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
function uniqueHeaders(values: unknown[]): string[] {
  const used = new Set<string>();
  return values.map((value, index) => {
    const base = String(value ?? '').trim() || `column_${index + 1}`;
    let name = base;
    for (let suffix = 2; used.has(name.toLowerCase()); suffix++) name = `${base}_${suffix}`;
    used.add(name.toLowerCase());
    return name;
  });
}
function objectRowsToCsv(rows: unknown[]): Uint8Array {
  if (!rows.length || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('JSON data must be a nonempty array of objects, or one object per JSONL line.');
  }
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row as object)))];
  if (!keys.length || keys.length > 1000) throw new Error('Datasets need between 1 and 1,000 columns.');
  const header = uniqueHeaders(keys).map(csvCell).join(',');
  return new TextEncoder().encode([header, ...rows.map((row) => keys.map((key) => csvCell((row as Record<string, unknown>)[key])).join(','))].join('\n'));
}

/** Reads a workbook locally; no upload endpoint or model is involved. */
export async function listWorkbookSheets(file: File): Promise<string[]> {
  checkFile(file);
  if (extension(file.name) !== 'xlsx') throw new Error('Sheet selection is available for XLSX workbooks.');
  const { default: readWorkbook } = await import('read-excel-file/browser');
  const sheets = await readWorkbook(file);
  return sheets.map((sheet) => sheet.sheet);
}

async function prepareFile(file: StoredFile): Promise<{ bytes: Uint8Array; format: 'csv' | 'tsv' | 'parquet' }> {
  const kind = extension(file.name);
  if (kind === 'xlsx') {
    const { readSheet } = await import('read-excel-file/browser');
    const data = await readSheet(new Blob([file.bytes]), file.sheet ?? 1);
    if (data.length < 2) throw new Error('The selected sheet needs a header row and at least one data row.');
    const width = data.reduce((largest, row) => Math.max(largest, row.length), 0);
    if (width > 1000) throw new Error('Datasets can have at most 1,000 columns.');
    const headers = uniqueHeaders(Array.from({ length: width }, (_, i) => data[0][i]));
    const csv = [headers.map(csvCell).join(','), ...data.slice(1).map((row) => headers.map((_, i) => csvCell(row[i])).join(','))].join('\n');
    return { bytes: new TextEncoder().encode(csv), format: 'csv' };
  }
  if (['json', 'jsonl', 'ndjson'].includes(kind)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes).replace(/^\uFEFF/, '');
    let rows: unknown;
    try {
      rows = kind === 'json' ? JSON.parse(text) : text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
        try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON on line ${index + 1}.`); }
      });
    } catch (error) {
      throw new Error(`Could not read JSON: ${errorMessage(error)}`);
    }
    if (!Array.isArray(rows)) throw new Error('JSON files must contain an array of row objects.');
    return { bytes: objectRowsToCsv(rows), format: 'csv' };
  }
  return { bytes: new Uint8Array(file.bytes.slice(0)), format: kind === 'parquet' ? 'parquet' : kind === 'tsv' ? 'tsv' : 'csv' };
}

async function importStoredFile(target: Engine, file: StoredFile): Promise<Dataset> {
  if (!/^data_[a-f0-9]{32}$/.test(file.id)) throw new Error('This saved file has an invalid dataset identifier.');
  if (file.bytes.byteLength > MAX_FILE_BYTES) throw new Error('The saved file exceeds the 20 MB limit.');
  const prepared = await prepareFile(file);
  const registeredName = `${file.id}.${prepared.format}`;
  const table = quote(file.id);
  await target.db.registerFileBuffer(registeredName, prepared.bytes);
  try {
    const reader = prepared.format === 'parquet'
      ? `read_parquet(${literal(registeredName)})`
      : `read_csv_auto(${literal(registeredName)}, header = true, delim = ${literal(prepared.format === 'tsv' ? '\t' : ',')}, sample_size = -1)`;
    await target.connection.query(`CREATE TABLE ${table} AS SELECT * FROM ${reader}`);
    const info = await target.connection.query(`DESCRIBE ${table}`);
    const count = await target.connection.query(`SELECT COUNT(*) AS count FROM ${table}`);
    const dataset: Dataset = {
      id: file.id, name: file.sheet ? `${file.name} · ${file.sheet}` : file.name,
      table: file.id, sourceId: 'local-files', kind: 'file',
      columns: info.toArray().map((row) => ({ name: String(row.column_name), type: String(row.column_type) })),
      rowCount: Number(count.get(0)?.count ?? 0), updatedAt: file.updatedAt,
    };
    target.datasets.set(dataset.id, dataset);
    return dataset;
  } catch (error) {
    await target.connection.query(`DROP TABLE IF EXISTS ${table}`).catch(() => undefined);
    throw error;
  } finally {
    await target.db.dropFile(registeredName).catch(() => undefined);
  }
}

function stopEngine(target: Engine): void {
  target.worker.terminate();
  if (engine === target) engine = null;
  starting = null;
}

async function getEngine(): Promise<Engine> {
  if (typeof window === 'undefined') throw new Error('Local analytics runs in your browser.');
  if (engine) return engine;
  if (starting) return starting;
  starting = (async () => {
    const duckdb = await import('@duckdb/duckdb-wasm');
    const worker = new Worker('/duckdb/duckdb-browser-mvp.worker.js');
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    try {
      await db.instantiate('/duckdb/duckdb-mvp.wasm');
      await db.open({ maximumThreads: 1, allowUnsignedExtensions: false, query: { castBigIntToDouble: false, castDecimalToDouble: true } });
      const connection = await db.connect();
      const target: Engine = { db, connection, worker, datasets: new Map() };
      await connection.query("SET memory_limit = '256MB'");
      await connection.query('SET autoinstall_known_extensions = false');
      await connection.query('SET autoload_known_extensions = false');
      const values = createDemoRows().map((row) => `(${literal(String(row.month))}::DATE, ${literal(String(row.channel))}, ${literal(String(row.plan))}, ${literal(String(row.region))}, ${row.customers}, ${row.revenue}, ${row.new_customers})`).join(',');
      await connection.query(`CREATE TABLE ${quote(DEMO_TABLE)} (month DATE, channel VARCHAR, plan VARCHAR, region VARCHAR, customers BIGINT, revenue BIGINT, new_customers BIGINT)`);
      await connection.query(`INSERT INTO ${quote(DEMO_TABLE)} VALUES ${values}`);
      target.datasets.set(demoDataset.id, structuredClone(demoDataset));
      restoreErrors = [];
      const files = await loadFiles().catch((error) => { restoreErrors.push(errorMessage(error)); return []; });
      for (const file of files) {
        try { await importStoredFile(target, file); } catch (error) { restoreErrors.push(`${file.name}: ${errorMessage(error)}`); }
      }
      engine = target;
      return target;
    } catch (error) {
      worker.terminate();
      throw new Error(`Could not start local analytics: ${errorMessage(error)}`);
    }
  })();
  try { return await starting; } finally { starting = null; }
}

/** Initialize the worker, deterministic demo, and all persisted uploaded files. */
export async function initEngine(): Promise<Dataset[]> {
  return exclusive(async () => structuredClone([...(await getEngine()).datasets.values()]));
}

export function getRestoreErrors(): string[] { return [...restoreErrors]; }

export async function restoreFiles(): Promise<Dataset[]> {
  return (await initEngine()).filter((dataset) => dataset.kind === 'file');
}

export async function importFile(file: File, sheet?: string): Promise<Dataset> {
  checkFile(file);
  return exclusive(async () => {
    const target = await getEngine();
    const stored: StoredFile = {
      id: `data_${crypto.randomUUID().replaceAll('-', '')}`, name: file.name,
      bytes: await file.arrayBuffer(), sheet, updatedAt: new Date().toISOString(),
    };
    const dataset = await importStoredFile(target, stored);
    try { await storeFile(stored); }
    catch (error) {
      await target.connection.query(`DROP TABLE ${quote(stored.id)}`);
      target.datasets.delete(stored.id);
      throw new Error(`The file was not saved: ${errorMessage(error)} Check browser storage space and retry.`);
    }
    return structuredClone(dataset);
  });
}

export async function deleteDataset(id: string): Promise<void> {
  return exclusive(async () => {
    const target = await getEngine();
    const dataset = target.datasets.get(id);
    if (!dataset || dataset.kind !== 'file') throw new Error('Only uploaded file datasets can be removed here.');
    await removeStoredFile(id);
    await target.connection.query(`DROP TABLE ${quote(dataset.table)}`);
    target.datasets.delete(id);
  });
}

function plainValue(value: unknown, type: string): Value {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
  if (typeof value === 'number') {
    if (/^Date/.test(type)) return new Date(value).toISOString().slice(0, 10);
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return String(value);
}

/** Enforces actual registered dataset identities, parsed SQL scope, result size, and a worker deadline. */
export async function query(sql: string, datasets: Dataset[], signal?: AbortSignal): Promise<QueryResult> {
  return exclusive(async () => {
    if (signal?.aborted) throw new DOMException('Query cancelled.', 'AbortError');
    const target = await getEngine();
    if (signal?.aborted) throw new DOMException('Query cancelled.', 'AbortError');
    const approved = datasets.map((candidate) => {
      const actual = target.datasets.get(candidate.id);
      if (!actual || actual.table !== candidate.table) throw new Error(`Dataset “${candidate.name}” is unavailable. Reconnect it before querying.`);
      return actual;
    });
    const policy = analyzeReadOnlySql(sql, approved.map((dataset) => dataset.table));
    const safeSql = policy.sql;
    const started = performance.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      const interrupted = new Promise<never>((_, reject) => {
        const stop = (error: Error) => { stopEngine(target); reject(error); };
        timeout = setTimeout(() => stop(new Error('Query exceeded the 10-second deadline. Try a smaller dataset or simpler query.')), QUERY_TIMEOUT_MS);
        cancel = () => stop(new DOMException('Query cancelled.', 'AbortError'));
        signal?.addEventListener('abort', cancel, { once: true });
      });
      const result = await Promise.race([
        target.connection.query(`SELECT * FROM (${safeSql}) AS sift_result LIMIT ${QUERY_ROW_LIMIT + 1}`),
        interrupted,
      ]);
      const fields = result.schema.fields;
      const rows = result.toArray().slice(0, QUERY_ROW_LIMIT).map((row) => Object.fromEntries(fields.map((field) => [field.name, plainValue(row[field.name], field.type.toString())])));
      return {
        columns: fields.map((field) => field.name), rows, rowCount: rows.length,
        truncated: result.numRows > QUERY_ROW_LIMIT, elapsedMs: Math.round(performance.now() - started),
        sql: safeSql, executedAt: new Date().toISOString(),
        sources: approved.filter((dataset) => policy.tables.includes(dataset.table)).map((dataset) => ({ name: dataset.name, refreshedAt: dataset.updatedAt })), approximate: false,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      if (cancel) signal?.removeEventListener('abort', cancel);
    }
  });
}

/** Reference connector: files execute in a dedicated browser worker with no server data transfer. */
export const browserConnector: AnalyticsConnector = {
  id: 'browser-local', name: 'Local files & sample data',
  capabilities: {
    discovery: true, modes: ['file'], readOnly: true, cancellation: true,
    deadline: true, resultLimit: QUERY_ROW_LIMIT, executionLocation: 'worker',
  },
  discover: (signal) => signal?.aborted ? Promise.reject(new DOMException('Discovery cancelled.', 'AbortError')) : initEngine(),
  query,
  close: () => exclusive(async () => { if (engine) stopEngine(engine); }),
};
