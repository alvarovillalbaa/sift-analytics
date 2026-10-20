import type { AnalyticsConnector, Dataset, QueryResult } from '../lib/types';

export type ConformanceFixture = {
  /** A disposable, approved table with at least 1,001 rows and a stable snapshot. */
  dataset: Dataset;
  /** An existing table that this query scope must not be allowed to read. */
  outsideScopeTable: string;
  /** Portable SELECT that returns the fixture's complete row population. */
  selectSql: string;
  expectedRows: number;
  /** An intentionally slow read-only SELECT, tuned for this engine and disposable fixture. */
  slowSql?: string;
};
export type ConformanceCheck = { name: string; passed: boolean; detail: string };

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function assert(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}
function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Connector did not settle within the conformance observation deadline.')), milliseconds); }),
  ]).finally(() => clearTimeout(timeout));
}

/**
 * Opt-in connector contract checks. Run only against a disposable fixture and a
 * least-privilege read-only identity. A broken adapter may forward rejected SQL.
 * This helper never configures credentials, provisions a database, or runs itself.
 */
export async function runConnectorConformance(
  connector: AnalyticsConnector,
  fixture: ConformanceFixture,
): Promise<ConformanceCheck[]> {
  const checks: ConformanceCheck[] = [];
  const selected = [fixture.dataset];
  async function check(name: string, action: () => Promise<void>) {
    try { await action(); checks.push({ name, passed: true, detail: 'Passed' }); }
    catch (error) { checks.push({ name, passed: false, detail: message(error) }); }
  }
  async function rejects(sql: string) {
    let rejected = false;
    try { await within(connector.query(sql, selected), 15_000); }
    catch (error) {
      if (message(error).includes('observation deadline')) throw error;
      rejected = true;
    }
    assert(rejected, 'Query was accepted despite the connector policy.');
  }
  function evidence(result: QueryResult) {
    assert(Array.isArray(result.rows) && Array.isArray(result.columns), 'Result rows and columns must be arrays.');
    assert(result.rowCount === result.rows.length, 'rowCount must describe the returned rows.');
    assert(result.rowCount <= connector.capabilities.resultLimit, 'Connector returned more than its declared row limit.');
    assert(typeof result.approximate === 'boolean' && typeof result.truncated === 'boolean', 'Result must declare approximation and truncation.');
    assert(result.sql && Number.isFinite(Date.parse(result.executedAt)), 'Result needs executed SQL and an execution timestamp.');
    assert(Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0, 'Result needs nonnegative elapsed time.');
    assert(result.sources.length > 0 && result.sources.every((source) => source.name && Number.isFinite(Date.parse(source.refreshedAt))), 'Every referenced source needs a name and freshness timestamp.');
    assert(result.rows.every((row) => result.columns.every((column) => column in row)
      && Object.values(row).every((value) => value === null || typeof value === 'string'
        || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))), 'Result values must use the public JSON-safe scalar contract.');
  }
  await check('capability declaration', async () => {
    assert(connector.capabilities.readOnly, 'Analytical connectors must declare read-only execution.');
    assert(connector.capabilities.deadline, 'Analytical connectors need an enforced execution deadline.');
    assert(connector.capabilities.resultLimit > 0, 'A finite positive result limit is required.');
    assert(Number.isFinite(connector.capabilities.resultLimit), 'An unbounded result limit is not permitted.');
  });
  await check('schema discovery', async () => {
    const found = (await within(connector.discover(), 15_000)).find((dataset) => dataset.id === fixture.dataset.id);
    assert(found && found.table === fixture.dataset.table && found.columns.length > 0, 'Discovery must expose the approved fixture and typed columns.');
    assert(found.columns.every((column) => column.name && column.type), 'Every discovered column needs a name and type.');
  });
  await check('execution, scalar types, provenance, and completeness', async () => {
    assert(fixture.expectedRows > connector.capabilities.resultLimit, 'Use a fixture larger than the declared result limit to test truncation.');
    const count = await within(connector.query(`SELECT COUNT(*) AS row_count FROM (${fixture.selectSql.replace(/;\s*$/, '')}) AS sift_fixture`, selected), 15_000);
    evidence(count);
    assert(Number(count.rows[0]?.row_count) === fixture.expectedRows, 'The fixture population does not match its declared row count.');
    const result = await within(connector.query(fixture.selectSql, selected), 15_000);
    evidence(result);
    assert(result.rows.length === connector.capabilities.resultLimit && result.truncated, 'The extra-row probe must mark a limited population as truncated.');
  });
  await check('bounded complete result', async () => {
    const result = await within(connector.query(`SELECT * FROM (${fixture.selectSql.replace(/;\s*$/, '')}) AS sift_fixture LIMIT 1`, selected), 15_000);
    evidence(result);
    assert(result.rows.length === 1 && !result.truncated, 'A complete one-row result must not be marked truncated.');
  });
  await check('write rejection', () => rejects(`DELETE FROM ${fixture.dataset.table} WHERE FALSE`));
  await check('statement stacking rejection', () => rejects(`${fixture.selectSql.replace(/;\s*$/, '')}; SELECT 1`));
  await check('outside-scope table rejection', () => rejects(`SELECT * FROM ${fixture.outsideScopeTable} LIMIT 1`));
  await check('external table function rejection', () => rejects("SELECT * FROM read_csv('https://example.invalid/sift-conformance.csv')"));
  if (connector.capabilities.cancellation) {
    await check('pre-aborted query cancellation', async () => {
      const controller = new AbortController(); controller.abort();
      let rejected = false;
      try { await within(connector.query(fixture.selectSql, selected, controller.signal), 1500); }
      catch (error) { if (message(error).includes('observation deadline')) throw error; rejected = true; }
      assert(rejected, 'A pre-aborted query must not execute.');
    });
  }
  if (fixture.slowSql) {
    await check('execution deadline', async () => {
      let rejected = false;
      try { await within(connector.query(fixture.slowSql!, selected), 12_000); }
      catch (error) { if (message(error).includes('observation deadline')) throw error; rejected = true; }
      assert(rejected, 'The intentionally slow fixture must be rejected by the connector deadline.');
    });
    if (connector.capabilities.cancellation) {
      await check('in-flight cancellation and recovery', async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 50);
        let rejected = false;
        try { await within(connector.query(fixture.slowSql!, selected, controller.signal), 2000); }
        catch (error) { if (message(error).includes('observation deadline')) throw error; rejected = true; }
        finally { clearTimeout(timeout); }
        assert(rejected, 'An interrupted query must be cancelled promptly.');
        const recovery = await within(connector.query(`SELECT * FROM (${fixture.selectSql.replace(/;\s*$/, '')}) AS sift_fixture LIMIT 1`, selected), 15_000);
        evidence(recovery);
      });
    }
  } else {
    checks.push({ name: 'execution deadline and in-flight cancellation', passed: false, detail: 'Not verified: supply a slow read-only fixture query for this engine.' });
  }
  return checks;
}
