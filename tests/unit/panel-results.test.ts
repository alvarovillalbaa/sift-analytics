// T1: pure panel/result reconciliation. No engine, UI, database, file or model execution.
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPanelResults } from '../../lib/panel-results.ts';
import type { Panel, QueryResult, Value } from '../../lib/types.ts';

const SQL = 'SELECT amount FROM sales';
const NOT_RUN = 'Query not run. Refresh this view to continue.';

function result(value: Value = 7, sql = SQL): QueryResult {
  return { columns: ['amount'], rows: [{ amount: value }], rowCount: 1, truncated: false,
    elapsedMs: 0, sql, executedAt: '2026-11-09T07:00:00.000Z',
    sources: [{ name: 'Sales', refreshedAt: '2026-11-09T06:00:00.000Z' }], approximate: false };
}

function panel(overrides: Partial<Panel> = {}): Panel {
  return { id: 'revenue', title: 'Revenue', type: 'table', sql: SQL, datasetIds: ['sales'],
    layout: { i: 'revenue', x: 0, y: 0, w: 6, h: 5 }, ...overrides };
}

test('PR01 query settlement preserves the current layout and every presentation field', () => {
  const requested = panel();
  const completion = { ...requested, result: result(), title: 'Old title', description: 'Old description' };
  const current = panel({ title: 'Current title', description: 'Current description', type: 'bar',
    xKey: 'month', yKeys: ['amount'], format: 'currency', currency: 'EUR',
    layout: { i: 'revenue', x: 6, y: 9, w: 5, h: 8 } });
  const [actual] = applyPanelResults([current], [completion], [requested]);
  assert.deepEqual(actual, { ...current, result: completion.result, error: undefined });
  assert.equal(actual.layout, current.layout);
  assert.equal(actual.yKeys, current.yKeys);
});

test('PR02 a changed SQL statement keeps its current result and error untouched', () => {
  const requested = panel(), current = panel({ sql: SQL + ' WHERE amount > 0', result: result(10), error: 'Current query note' });
  assert.equal(applyPanelResults([current], [{ ...requested, result: result(20) }], [requested])[0], current);
});

test('PR03 dataset order length and identity all participate in the query match', () => {
  const requested = panel({ datasetIds: ['sales', 'customers'] });
  const completion = { ...requested, result: result() };
  for (const datasetIds of [['customers', 'sales'], ['sales'], ['sales', 'customers', 'regions'], ['sales', 'regions']]) {
    const current = panel({ datasetIds, result: result(99), error: 'Keep current state' });
    assert.equal(applyPanelResults([current], [completion], [requested])[0], current);
  }
});

test('PR04 the same panel ID cannot mask a later completion for the current exact query', () => {
  const current = panel({ sql: SQL + ' WHERE amount = 0', datasetIds: ['sales', 'returns'] });
  const wrongSql = panel({ result: result(11) });
  const wrongDatasets = panel({ sql: current.sql, result: result(12, current.sql) });
  const match = { ...current, result: result(0, current.sql) };
  assert.deepEqual(applyPanelResults([current], [wrongSql, wrongDatasets, match])[0], { ...current, result: match.result, error: undefined });
});

test('PR05 a successful completion clears an old failure and retains falsy result values', () => {
  const current = panel({ error: 'Earlier failure' });
  const completedResult = { ...result(), columns: ['zero', 'false', 'null', 'empty'],
    rows: [{ zero: 0, false: false, null: null, empty: '' }] };
  const [actual] = applyPanelResults([current], [{ ...current, result: completedResult, error: undefined }]);
  assert.equal(actual.error, undefined);
  assert.equal(actual.result, completedResult);
  assert.deepEqual(actual.result.rows, [{ zero: 0, false: false, null: null, empty: '' }]);
});

test('PR06 a failed completion clears old rows without replacing presentation', () => {
  const current = panel({ result: result(100), layout: { i: 'revenue', x: 2, y: 3, w: 8, h: 6 } });
  const completion = panel({ result: undefined, error: 'Authored query failure' });
  assert.deepEqual(applyPanelResults([current], [completion])[0], { ...current, result: undefined, error: completion.error });
});

test('PR07 a requested query that never completed loses stale rows and reports not run', () => {
  const requested = panel(), current = panel({ result: result(10), error: 'Older failure' });
  assert.deepEqual(applyPanelResults([current], [], [requested])[0], { ...current, result: undefined, error: NOT_RUN });
});

test('PR08 panels added after the request retain their state while unfinished requested panels are marked', () => {
  const requested = panel(), added = panel({ id: 'new', title: 'Added during query', result: result(4) });
  const actual = applyPanelResults([added, requested], [], [requested]);
  assert.equal(actual[0], added);
  assert.deepEqual(actual[1], { ...requested, result: undefined, error: NOT_RUN });
});

test('PR09 current order wins and deleted panels are never resurrected', () => {
  const first = panel(), second = panel({ id: 'second', title: 'Second panel' }), deleted = panel({ id: 'deleted' });
  const actual = applyPanelResults([second, first], [
    { ...first, result: result(1) }, { ...deleted, result: result(2) }, { ...second, result: result(3) },
  ], [first, second, deleted]);
  assert.deepEqual(actual.map(value => value.id), ['second', 'revenue']);
  assert.deepEqual(actual.map(value => value.result?.rows[0]?.amount), [3, 1]);
});

test('PR10 omitting requested panels does not manufacture an unfinished-query error', () => {
  const current = panel({ result: result(), error: 'Existing note' });
  assert.equal(applyPanelResults([current], [panel({ id: 'unrelated', result: result(2) })])[0], current);
  assert.deepEqual(applyPanelResults([], [current], [current]), []);
});

test('PR11 caller-owned arrays panels layouts datasets and result records remain immutable', () => {
  const current = panel({ title: 'Current title', result: result(1) });
  const completed = panel({ result: result(2) }), requested = panel();
  const inputs = [[current], [completed], [requested]];
  const before = structuredClone(inputs);
  function freeze(value: unknown): void {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  freeze(inputs);
  const actual = applyPanelResults(inputs[0], inputs[1], inputs[2]);
  assert.deepEqual(inputs, before);
  assert.notEqual(actual[0], current);
  assert.equal(actual[0].layout, current.layout);
  assert.equal(actual[0].result, completed.result);
});

test('PR12 typed empty identities and exact whitespace are compared without truthiness or normalization', () => {
  const current = panel({ id: '', sql: '', datasetIds: [], result: result(1), error: 'Old error' });
  const completion = { ...current, result: undefined, error: '' };
  assert.deepEqual(applyPanelResults([current], [completion])[0], { ...current, result: undefined, error: '' });
  const whitespace = panel({ sql: SQL + ' ', result: result(3) });
  assert.equal(applyPanelResults([whitespace], [{ ...panel(), result: result(4) }], [panel()])[0], whitespace);
});
