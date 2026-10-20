'use client';

import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import type { AnalyticsConnector, Dataset, QueryResult } from './types';
import { createDemoRows, demoDataset, DEMO_TABLE } from './demo';
import { loadFiles, removeStoredFile, storeFile, type StoredFile } from './storage';
import { QUERY_ROW_LIMIT, QUERY_TIMEOUT_MS, analyzeReadOnlySql } from './sql-policy';
import { cellText, checkWorkbookArchive, ExactNumber, importColumnType, parseExactJson, serializeArrowValue } from './data-values';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const STARTUP_TIMEOUT_MS = 30_000;
const IMPORT_TIMEOUT_MS = 30_000;
const RESTORE_TIMEOUT_MS = 60_000;
const MAX_IMPORT_CELLS = 2_000_000;
type Runtime = { db: AsyncDuckDB; worker: Worker; stopped: boolean };
type Engine = Runtime & { connection: AsyncDuckDBConnection; datasets: Map<string, Dataset> };
export type RestoreFailure = { id: string; name: string; error: string };
let engine: Engine | null = null;
let starting: Promise<Engine> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let restoreErrors: string[] = [];
let restoreFailures: RestoreFailure[] = [];

function exclusive<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const run = () => {
    if (signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError');
    return action();
  };
  const pending = queue.then(run, run);
  queue = pending.catch(() => undefined);
  if (!signal) return pending;
  return bounded(() => pending, undefined, undefined, signal);
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
  const text = cellText(value);
  return `"${text.replaceAll('"', '""')}"`;
}
function uniqueHeaders(values: unknown[]): string[] {
  const used = new Set<string>();
  return values.map((value, index) => {
    const base = cellText(value).trim() || `column_${index + 1}`;
    let name = base;
    for (let suffix = 2; used.has(name.toLowerCase()); suffix++) name = `${base}_${suffix}`;
    used.add(name.toLowerCase());
    return name;
  });
}
type PreparedFile = { bytes: Uint8Array; format: 'csv' | 'tsv' | 'parquet'; types?: Record<string, string> };
function typedRowsToCsv(headers: string[], rows: unknown[][]): PreparedFile {
  if (headers.length * rows.length > MAX_IMPORT_CELLS) throw new Error('The selected table exceeds the two-million-cell local import limit.');
  return {
    bytes: new TextEncoder().encode([headers.map(csvCell).join(','), ...rows.map((row) => headers.map((_, index) => csvCell(row[index])).join(','))].join('\n')),
    format: 'csv', types: Object.fromEntries(headers.map((header, index) => [header, importColumnType(rows.map((row) => row[index]))])),
  };
}
function objectRowsToCsv(rows: unknown[]): PreparedFile {
  if (!rows.length || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row) || row instanceof ExactNumber)) {
    throw new Error('JSON data must be a nonempty array of objects, or one object per JSONL line.');
  }
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row as object)))];
  if (!keys.length || keys.length > 1000) throw new Error('Datasets need between 1 and 1,000 columns.');
  if (keys.length * rows.length > MAX_IMPORT_CELLS) throw new Error('The selected table exceeds the two-million-cell local import limit.');
  return typedRowsToCsv(uniqueHeaders(keys), rows.map((row) => keys.map((key) => (row as Record<string, unknown>)[key])));
}

/** Reads a workbook locally; no upload endpoint or model is involved. */
export async function listWorkbookSheets(file: File): Promise<string[]> {
  checkFile(file);
  if (extension(file.name) !== 'xlsx') throw new Error('Sheet selection is available for XLSX workbooks.');
  const sheets = await bounded(async () => {
    const bytes = await file.arrayBuffer();
    checkWorkbookArchive(bytes);
    const { default: readWorkbook } = await import('read-excel-file/browser');
    return readWorkbook(new Blob([bytes]), { parseNumber: (text) => new ExactNumber(text) });
  }, IMPORT_TIMEOUT_MS, 'Workbook inspection exceeded the 30-second deadline.');
  return sheets.map((sheet) => sheet.sheet);
}

async function prepareFile(file: StoredFile): Promise<PreparedFile> {
  const kind = extension(file.name);
  if (kind === 'xlsx') {
    checkWorkbookArchive(file.bytes);
    const { readSheet } = await import('read-excel-file/browser');
    const data = await readSheet(new Blob([file.bytes]), file.sheet ?? 1, { parseNumber: (text) => new ExactNumber(text), trim: false });
    if (data.length < 2) throw new Error('The selected sheet needs a header row and at least one data row.');
    const width = data.reduce((largest, row) => Math.max(largest, row.length), 0);
    if (width > 1000) throw new Error('Datasets can have at most 1,000 columns.');
    const headers = uniqueHeaders(Array.from({ length: width }, (_, i) => data[0][i]));
    return typedRowsToCsv(headers, data.slice(1));
  }
  if (['json', 'jsonl', 'ndjson'].includes(kind)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes).replace(/^\uFEFF/, '');
    let rows: unknown;
    try {
      if (kind === 'json') rows = parseExactJson(text);
      else {
        const budget = { remaining: 1_000_000 };
        rows = text.split(/\r?\n/).flatMap((line, index) => {
          if (!line.trim()) return [];
          try { return [parseExactJson(line, budget)]; } catch (error) { throw new Error(`Invalid JSON on line ${index + 1}: ${errorMessage(error)}`); }
        });
      }
    } catch (error) {
      throw new Error(`Could not read JSON: ${errorMessage(error)}`);
    }
    if (!Array.isArray(rows)) throw new Error('JSON files must contain an array of row objects.');
    return objectRowsToCsv(rows);
  }
  return { bytes: new Uint8Array(file.bytes.slice(0)), format: kind === 'parquet' ? 'parquet' : kind === 'tsv' ? 'tsv' : 'csv' };
}

async function importStoredFile(target: Engine, file: StoredFile, signal?: AbortSignal): Promise<Dataset> {
  if (!/^data_[a-f0-9]{32}$/.test(file.id)) throw new Error('This saved file has an invalid dataset identifier.');
  if (file.bytes.byteLength > MAX_FILE_BYTES) throw new Error('The saved file exceeds the 20 MB limit.');
  const prepared = await bounded(() => prepareFile(file), IMPORT_TIMEOUT_MS, 'File parsing exceeded the 30-second deadline.', signal);
  const registeredName = `${file.id}.${prepared.format}`;
  const table = quote(file.id);
  return workerOperation(target, async () => {
    await target.db.registerFileBuffer(registeredName, prepared.bytes);
    try {
      const types = prepared.types ? `, types = {${Object.entries(prepared.types).map(([name, type]) => `${literal(name)}: ${literal(type)}`).join(', ')}}` : '';
      const reader = prepared.format === 'parquet'
        ? `read_parquet(${literal(registeredName)})`
        : `read_csv_auto(${literal(registeredName)}, header = true, delim = ${literal(prepared.format === 'tsv' ? '\t' : ',')}, sample_size = -1, allow_quoted_nulls = false${types})`;
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
      if (!target.stopped) await target.connection.query(`DROP TABLE IF EXISTS ${table}`).catch(() => undefined);
      throw error;
    } finally {
      if (!target.stopped) await target.db.dropFile(registeredName).catch(() => undefined);
    }
  }, IMPORT_TIMEOUT_MS, 'File import exceeded the 30-second deadline.', signal);
}

function stopEngine(target: Runtime): void {
  target.stopped = true;
  target.worker.terminate();
  target.db.detach();
  if (engine === target) engine = null;
}

function bounded<T>(action: () => Promise<T>, timeoutMs?: number, timeoutMessage?: string, signal?: AbortSignal, stop?: () => void): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('Operation cancelled.', 'AbortError'));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    const interrupt = (error: Error) => { try { stop?.(); } finally { reject(error); } };
    if (timeoutMs) timeout = setTimeout(() => interrupt(new Error(timeoutMessage ?? 'Operation deadline exceeded.')), timeoutMs);
    cancel = () => interrupt(new DOMException('Operation cancelled.', 'AbortError'));
    signal?.addEventListener('abort', cancel, { once: true });
  });
  return Promise.race([Promise.resolve().then(action), interrupted]).finally(() => {
    if (timeout) clearTimeout(timeout);
    if (cancel) signal?.removeEventListener('abort', cancel);
  });
}

function workerOperation<T>(target: Runtime, action: () => Promise<T>, timeoutMs: number, message: string, signal?: AbortSignal): Promise<T> {
  if (target.stopped) return Promise.reject(new Error('The local engine was restarted. Retry this operation.'));
  let failure: ((event: ErrorEvent) => void) | undefined;
  const failed = new Promise<never>((_, reject) => {
    failure = (event) => { stopEngine(target); reject(new Error(`Local data worker failed: ${event.message || 'worker unavailable'}`)); };
    target.worker.addEventListener('error', failure, { once: true });
  });
  return bounded(() => Promise.race([action(), failed]), timeoutMs, message, signal, () => stopEngine(target))
    .finally(() => { if (failure) target.worker.removeEventListener('error', failure); });
}

async function createEngine(signal?: AbortSignal): Promise<Engine> {
  const duckdb = await bounded(() => import('@duckdb/duckdb-wasm'), STARTUP_TIMEOUT_MS, 'Loading local analytics exceeded the 30-second deadline.', signal);
  const worker = new Worker('/duckdb/duckdb-browser-mvp.worker.js');
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  const runtime: Runtime = { db, worker, stopped: false };
  try {
    return await workerOperation(runtime, async () => {
      await db.instantiate('/duckdb/duckdb-mvp.wasm');
      await db.open({ maximumThreads: 1, allowUnsignedExtensions: false, query: { castBigIntToDouble: false, castDecimalToDouble: false, castTimestampToDate: false } });
      const connection = await db.connect();
      const target: Engine = { ...runtime, connection, datasets: new Map() };
      await connection.query("SET memory_limit = '256MB'");
      await connection.query('SET autoinstall_known_extensions = false');
      await connection.query('SET autoload_known_extensions = false');
      const values = createDemoRows().map((row) => `(${literal(String(row.month))}::DATE, ${literal(String(row.channel))}, ${literal(String(row.plan))}, ${literal(String(row.region))}, ${row.customers}, ${row.revenue}, ${row.new_customers})`).join(',');
      await connection.query(`CREATE TABLE ${quote(DEMO_TABLE)} (month DATE, channel VARCHAR, plan VARCHAR, region VARCHAR, customers BIGINT, revenue BIGINT, new_customers BIGINT)`);
      await connection.query(`INSERT INTO ${quote(DEMO_TABLE)} VALUES ${values}`);
      target.datasets.set(demoDataset.id, structuredClone(demoDataset));
      return target;
    }, STARTUP_TIMEOUT_MS, 'Local engine startup exceeded the 30-second deadline.', signal);
  } catch (error) {
    stopEngine(runtime);
    throw error;
  }
}

function recordRestoreFailure(file: StoredFile, error: string): void {
  restoreFailures = [...restoreFailures.filter((failure) => failure.id !== file.id), { id: file.id, name: file.name, error }];
}

async function getEngine(signal?: AbortSignal): Promise<Engine> {
  if (typeof window === 'undefined') throw new Error('Local analytics runs in your browser.');
  if (signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError');
  if (engine && !engine.stopped) return engine;
  if (starting) { const active = starting; return bounded(() => active, undefined, undefined, signal); }
  starting = (async () => {
    let target = await createEngine(signal);
    try {
      restoreErrors = [];
      restoreFailures = [];
      const files = await bounded(loadFiles, 10_000, 'Reading saved files exceeded the 10-second deadline.', signal)
        .catch((error) => {
          if (signal?.aborted) throw error;
          restoreErrors.push(errorMessage(error)); return [];
        });
      const restored: StoredFile[] = [];
      const restoreStarted = performance.now();
      for (const file of files) {
        const remaining = RESTORE_TIMEOUT_MS - (performance.now() - restoreStarted);
        if (remaining <= 0) { recordRestoreFailure(file, 'Restoration reached its 60-second budget. Reload to retry.'); continue; }
        try {
          await workerOperation(target, () => importStoredFile(target, file, signal), Math.min(IMPORT_TIMEOUT_MS, remaining), 'Saved file restoration exceeded its deadline.', signal);
          restored.push(file);
        } catch (error) {
          if (signal?.aborted) throw error;
          recordRestoreFailure(file, errorMessage(error));
          if (target.stopped) {
            target = await createEngine(signal);
            // A worker reset invalidates earlier tables. Rebuild healthy ones;
            // if replay also fails, expose every unavailable file for recovery.
            const previous = restored.splice(0);
            for (const prior of previous) {
              const budget = RESTORE_TIMEOUT_MS - (performance.now() - restoreStarted);
              if (budget <= 0) { recordRestoreFailure(prior, 'Restoration budget ended after the worker restarted. Reload to retry.'); continue; }
              try {
                await workerOperation(target, () => importStoredFile(target, prior, signal), Math.min(IMPORT_TIMEOUT_MS, budget), 'Saved file recovery exceeded its deadline.', signal);
                restored.push(prior);
              } catch (recoveryError) {
                if (signal?.aborted) throw recoveryError;
                recordRestoreFailure(prior, errorMessage(recoveryError));
                if (target.stopped) {
                  for (const unavailable of previous) recordRestoreFailure(unavailable, 'The worker restarted while restoring saved files. Reload to retry.');
                  restored.splice(0);
                  target = await createEngine(signal);
                  break;
                }
              }
            }
          }
        }
      }
      engine = target;
      return target;
    } catch (error) {
      stopEngine(target);
      if (signal?.aborted) throw error;
      throw new Error(`Could not start local analytics: ${errorMessage(error)}`);
    }
  })();
  try { return await starting; } finally { starting = null; }
}

/** Initialize the worker, deterministic demo, and all persisted uploaded files. */
export async function initEngine(): Promise<Dataset[]> {
  return exclusive(async () => structuredClone([...(await getEngine()).datasets.values()]));
}

export function getRestoreErrors(): string[] { return [...restoreErrors, ...restoreFailures.map((failure) => `${failure.name}: ${failure.error}`)]; }
export function getRestoreFailures(): RestoreFailure[] { return structuredClone(restoreFailures); }

export async function restoreFiles(): Promise<Dataset[]> {
  return (await initEngine()).filter((dataset) => dataset.kind === 'file');
}

export async function importFile(file: File, sheet?: string, signal?: AbortSignal): Promise<Dataset> {
  checkFile(file);
  return exclusive(async () => {
    const target = await getEngine(signal);
    const stored: StoredFile = {
      id: `data_${crypto.randomUUID().replaceAll('-', '')}`, name: file.name,
      bytes: await bounded(() => file.arrayBuffer(), IMPORT_TIMEOUT_MS, 'Reading the file exceeded the 30-second deadline.', signal), sheet, updatedAt: new Date().toISOString(),
    };
    const dataset = await workerOperation(target, () => importStoredFile(target, stored, signal), IMPORT_TIMEOUT_MS, 'File import exceeded the 30-second deadline.', signal);
    try { await storeFile(stored, signal); }
    catch (error) {
      target.datasets.delete(stored.id);
      if (!target.stopped) await workerOperation(target, () => target.connection.query(`DROP TABLE IF EXISTS ${quote(stored.id)}`), QUERY_TIMEOUT_MS, 'Import cleanup exceeded its deadline.').catch(() => stopEngine(target));
      if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
      throw new Error(`The file was not saved: ${errorMessage(error)} Check browser storage space and retry.`);
    }
    return structuredClone(dataset);
  }, signal);
}

export async function deleteDataset(id: string): Promise<void> {
  return exclusive(async () => {
    if (!/^data_[a-f0-9]{32}$/.test(id) && !restoreFailures.some((failure) => failure.id === id)) throw new Error('Only uploaded file datasets can be removed here.');
    await removeStoredFile(id);
    restoreFailures = restoreFailures.filter((failure) => failure.id !== id);
    const target = engine;
    if (target) {
      target.datasets.delete(id);
      await workerOperation(target, () => target.connection.query(`DROP TABLE IF EXISTS ${quote(id)}`), QUERY_TIMEOUT_MS, 'Removing the local table exceeded its deadline.').catch(() => stopEngine(target));
    }
  });
}

/** Enforces actual registered dataset identities, parsed SQL scope, result size, and a worker deadline. */
export async function query(sql: string, datasets: Dataset[], signal?: AbortSignal): Promise<QueryResult> {
  return exclusive(async () => {
    if (signal?.aborted) throw new DOMException('Query cancelled.', 'AbortError');
    const target = await getEngine(signal);
    if (signal?.aborted) throw new DOMException('Query cancelled.', 'AbortError');
    const approved = datasets.map((candidate) => {
      const actual = target.datasets.get(candidate.id);
      if (!actual || actual.table !== candidate.table) throw new Error(`Dataset “${candidate.name}” is unavailable. Reconnect it before querying.`);
      return actual;
    });
    const policy = analyzeReadOnlySql(sql, approved.map((dataset) => dataset.table));
    const safeSql = policy.sql;
    const started = performance.now();
    const result = await workerOperation(target,
      () => target.connection.query(`SELECT * FROM (${safeSql}) AS sift_result LIMIT ${QUERY_ROW_LIMIT + 1}`),
      QUERY_TIMEOUT_MS, 'Query exceeded the 10-second deadline. Try a smaller dataset or simpler query.', signal);
    const fields = result.schema.fields;
    if (new Set(fields.map((field) => field.name)).size !== fields.length) throw new Error('Give each selected column a unique alias.');
    const vectors = fields.map((_, index) => result.getChildAt(index)!);
    const rows = Array.from({ length: Math.min(result.numRows, QUERY_ROW_LIMIT) }, (_, rowIndex) => Object.fromEntries(fields.map((field, columnIndex) => {
      const vector = vectors[columnIndex];
      if (!vector.isValid(rowIndex)) return [field.name, null];
      let raw: bigint | undefined;
      if (/^Timestamp/.test(field.type.toString())) {
        let offset = rowIndex;
        for (const chunk of vector.data) {
          if (offset < chunk.length) { raw = BigInt(chunk.values[offset]); break; }
          offset -= chunk.length;
        }
      }
      return [field.name, serializeArrowValue(raw ?? vector.get(rowIndex), field.type, raw)];
    })));
    return {
      columns: fields.map((field) => field.name), rows, rowCount: rows.length,
      columnTypes: Object.fromEntries(fields.map((field) => [field.name, field.type.toString()])),
      truncated: result.numRows > QUERY_ROW_LIMIT, elapsedMs: Math.round(performance.now() - started),
      sql: safeSql, executedAt: new Date().toISOString(),
      sources: approved.filter((dataset) => policy.tables.includes(dataset.table)).map((dataset) => ({ name: dataset.name, refreshedAt: dataset.updatedAt })), approximate: false,
    };
  }, signal);
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
