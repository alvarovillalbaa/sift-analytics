// T2 authored-fixture contract only; no application imports, DuckDB or browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FILES, RACE_FILES, CANARY } from './fixtures.mjs';

test('four selected healthy files independently total 49 across six rows', () => {
  const healthy = FILES.filter((file) => file.selected && !file.invalid);
  assert.equal(healthy.length, 4); assert.equal(healthy.reduce((n, file) => n + file.rows, 0), 6);
  assert.equal(healthy.reduce((n, file) => n + file.total, 0), 49);
});
test('same basenames have distinct relative identities and authored contents', () => {
  const sales = FILES.filter((file) => file.relative.endsWith('/sales.csv'));
  assert.equal(sales.length, 2); assert.notEqual(sales[0].relative, sales[1].relative); assert.notEqual(sales[0].text, sales[1].text);
});
test('malformed JSON really refuses while JSON and NDJSON have exact numeric rows', () => {
  assert.throws(() => JSON.parse(FILES.find((file) => file.invalid).text));
  const json = JSON.parse(FILES.find((file) => file.relative === 'events.json').text);
  assert.deepEqual(json.map((row) => row.amount), [3, 4]);
  assert.equal(JSON.parse(FILES.find((file) => file.relative === 'notes.ndjson').text).amount, 5);
});
test('unselected 9999 decoy changes the aggregate if accidentally imported', () => {
  const ignored = FILES.find((file) => !file.selected); assert.equal(ignored.total, 9999);
  assert.ok(FILES.every((file) => file.text.includes(CANARY)));
});
test('commit-race fixture has two different ordered payloads and a known total', () => {
  assert.deepEqual(RACE_FILES.map((file) => file.relative), ['first.csv', 'second.csv']);
  assert.notEqual(RACE_FILES[0].text, RACE_FILES[1].text); assert.equal(RACE_FILES.reduce((n, file) => n + file.total, 0), 24);
});
