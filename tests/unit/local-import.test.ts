// T2: authored File metadata only. No file parsing, DuckDB, browser or model calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import { planLocalFiles, validateImportSelection, type ImportCandidate } from '../../lib/local-import.ts';

const MiB = 1024 * 1024;

function fixture(name: string, size = 1, relativePath = ''): File {
  const file = new File(['x'], name);
  Object.defineProperties(file, { size: { value: size }, webkitRelativePath: { value: relativePath } });
  for (const method of ['arrayBuffer', 'text', 'stream', 'slice']) {
    Object.defineProperty(file, method, { value() { throw new Error('File contents must remain unread.'); } });
  }
  return file;
}

const ids = (candidates: readonly ImportCandidate[]) => candidates.map((candidate) => candidate.id);

test('Supported extensions produce deterministic sorted candidates without reading contents', () => {
  const names = ['z.parquet', 'd.JSONL', 'b.tsv', 'g.xlsx', 'e.ndjson', 'c.json', 'a.csv'];
  const files = names.map((name) => fixture(name));
  const planned = planLocalFiles(files, false);
  assert.deepEqual(planned.map((candidate) => candidate.path), [...names].sort());
  assert.ok(planned.every((candidate) => candidate.error === undefined));
  assert.ok(planned.every((candidate) => files.includes(candidate.file)));
  assert.equal(validateImportSelection(planned, ids(planned)), undefined);
  assert.deepEqual(planLocalFiles([...files].reverse(), false).map(({ id, path }) => ({ id, path })), planned.map(({ id, path }) => ({ id, path })));
});

test('File mode ignores folder metadata and uses only file.name', () => {
  const file = fixture('table.csv', 1, '../not-an-approved-folder/table.csv');
  const [candidate] = planLocalFiles([file], false);
  assert.equal(candidate.path, 'table.csv');
  assert.equal(candidate.error, undefined);
});

test('Folder paths retain spaces and Unicode beneath one common root', () => {
  const planned = planLocalFiles([
    fixture('東京.csv', 1, 'Business data/東京.csv'),
    fixture('sales.json', 1, 'Business data/monthly/sales.json'),
  ], true);
  assert.deepEqual(planned.map((candidate) => candidate.path), ['Business data/monthly/sales.json', 'Business data/東京.csv']);
  assert.ok(planned.every((candidate) => candidate.error === undefined));
});

test('Unsafe folder paths remain visible and cannot be selected', () => {
  for (const path of ['', '/root/data.csv', 'root//data.csv', 'root/./data.csv', 'root/../data.csv', 'root/data.csv/', 'root\\data.csv', 'C:/root/data.csv', 'root/\u0000data.csv', 'root/\tdata.csv', 'root/\ndata.csv', 'root/\rdata.csv', 'root/\u007fdata.csv']) {
    const planned = planLocalFiles([fixture('data.csv', 1, path)], true);
    assert.equal(planned.length, 1);
    assert.equal(planned[0].path, path);
    assert.ok(planned[0].error, `Expected an error for ${JSON.stringify(path)}`);
    assert.ok(validateImportSelection(planned, ids(planned)));
  }
});

test('Folder selection requires an actual root and matching file basename', () => {
  for (const path of ['data.csv', 'root/other.csv']) {
    const [candidate] = planLocalFiles([fixture('data.csv', 1, path)], true);
    assert.ok(candidate.error);
  }
});

test('A folder path at the 4,096-character boundary is allowed', () => {
  const path = `${'r'.repeat(4096 - '/data.csv'.length)}/data.csv`;
  assert.equal(path.length, 4096);
  const planned = planLocalFiles([fixture('data.csv', 1, path)], true);
  assert.equal(planned[0].error, undefined);
  assert.equal(validateImportSelection(planned, ids(planned)), undefined);
});

test('Paths above 4,096 characters are visibly refused in folder and file mode', () => {
  const folderPath = `${'r'.repeat(4097 - '/data.csv'.length)}/data.csv`;
  const fileName = `${'r'.repeat(4097 - '.csv'.length)}.csv`;
  for (const planned of [planLocalFiles([fixture('data.csv', 1, folderPath)], true), planLocalFiles([fixture(fileName)], false)]) {
    assert.equal(planned[0].path.length, 4097);
    assert.match(planned[0].error!, /4,096-character/);
    assert.ok(validateImportSelection(planned, ids(planned)));
  }
});

test('Mixed folder roots invalidate all well-formed rows rather than choosing an arbitrary root', () => {
  const planned = planLocalFiles([fixture('a.csv', 1, 'One/a.csv'), fixture('b.csv', 1, 'Two/b.csv')], true);
  assert.ok(planned.every((candidate) => candidate.error?.includes('common folder root')));
});

test('Every exact duplicate path is visibly rejected and still has a distinct ID', () => {
  const planned = planLocalFiles([fixture('same.csv'), fixture('same.csv'), fixture('other.csv')], false);
  const duplicates = planned.filter((candidate) => candidate.path === 'same.csv');
  assert.equal(duplicates.length, 2);
  assert.ok(duplicates.every((candidate) => candidate.error?.includes('Duplicate paths')));
  assert.equal(new Set(ids(planned)).size, planned.length);
  assert.ok(validateImportSelection(planned, [duplicates[0].id]));
});

test('Only exact duplicate paths collide; case-distinct names remain distinct', () => {
  const planned = planLocalFiles([fixture('Report.csv'), fixture('report.csv')], false);
  assert.ok(planned.every((candidate) => candidate.error === undefined));
  assert.equal(validateImportSelection(planned, ids(planned)), undefined);
});

test('Unsupported, empty and oversized files remain visible with readable errors', () => {
  const planned = planLocalFiles([fixture('readme.txt'), fixture('empty.csv', 0), fixture('large.csv', 20 * MiB + 1)], false);
  assert.equal(planned.length, 3);
  assert.ok(planned.every((candidate) => typeof candidate.error === 'string' && candidate.error.length > 10));
  assert.match(planned.find((candidate) => candidate.path === 'large.csv')!.error!, /20 MiB/);
});

test('A 20 MiB file is allowed but invalid numeric metadata is refused', () => {
  assert.equal(planLocalFiles([fixture('limit.csv', 20 * MiB)], false)[0].error, undefined);
  for (const size of [-1, NaN, Infinity, 0.5]) assert.ok(planLocalFiles([fixture('invalid.csv', size)], false)[0].error);
});

test('Exactly 200 metadata candidates are allowed', () => {
  const planned = planLocalFiles(Array.from({ length: 200 }, (_, index) => fixture(`${index}.csv`)), false);
  assert.equal(planned.length, 200);
  assert.equal(new Set(ids(planned)).size, 200);
});

test('More than 200 candidates are refused before any file metadata is accessed', () => {
  const inaccessible = new Proxy({} as File, { get() { throw new Error('Metadata was scanned.'); } });
  assert.throws(() => planLocalFiles(Array(201).fill(inaccessible), true), /at most 200/);
});

test('FileList-like indexed collections are accepted and oversized lists are refused before indexed access', () => {
  const first = fixture('b.csv');
  const second = fixture('a.csv');
  let reads = 0;
  const files: ArrayLike<File> = {
    length: 2,
    get 0() { reads++; return first; },
    get 1() { reads++; return second; },
  };
  const planned = planLocalFiles(files, false);
  assert.equal(reads, 2);
  assert.deepEqual(planned.map((candidate) => candidate.path), ['a.csv', 'b.csv']);
  assert.equal(planned[0].file, second);
  assert.equal(planned[1].file, first);
  assert.equal(validateImportSelection(planned, ids(planned)), undefined);

  let oversizedReads = 0;
  const oversized: ArrayLike<File> = {
    length: 201,
    get 0() { oversizedReads++; throw new Error('Indexed access happened before the count gate.'); },
  };
  assert.throws(() => planLocalFiles(oversized, false), /at most 200/);
  assert.equal(oversizedReads, 0);
});

test('Invalid unselected rows do not block a valid explicit subset', () => {
  const planned = planLocalFiles([fixture('valid.csv'), fixture('unsupported.exe')], false);
  const valid = planned.find((candidate) => candidate.path === 'valid.csv')!;
  assert.equal(validateImportSelection(planned, [valid.id]), undefined);
});

test('Empty, unknown, malformed and repeated selection IDs are refused', () => {
  const planned = planLocalFiles([fixture('valid.csv')], false);
  assert.ok(validateImportSelection(planned, []));
  assert.ok(validateImportSelection(planned, ['not-in-this-plan']));
  assert.ok(validateImportSelection(planned, ['']));
  assert.ok(validateImportSelection(planned, [null as unknown as string]));
  assert.ok(validateImportSelection(planned, [planned[0].id, planned[0].id]));
});

test('An invalid or duplicate candidate identity is refused without ambiguity', () => {
  const planned = planLocalFiles([fixture('a.csv'), fixture('b.csv')], false);
  assert.ok(validateImportSelection([{ ...planned[0], id: '' }], [planned[0].id]));
  assert.ok(validateImportSelection([planned[0], { ...planned[1], id: planned[0].id }], [planned[0].id]));
});

test('At most twenty files can be selected independently of the preview count', () => {
  const planned = planLocalFiles(Array.from({ length: 21 }, (_, index) => fixture(`${index}.csv`)), false);
  assert.equal(validateImportSelection(planned, ids(planned).slice(0, 20)), undefined);
  assert.match(validateImportSelection(planned, ids(planned))!, /at most 20/);
});

test('The aggregate limit permits exactly 100 MiB and refuses a larger selection', () => {
  const planned = planLocalFiles(Array.from({ length: 6 }, (_, index) => fixture(`${index}.csv`, 20 * MiB)), false);
  assert.equal(validateImportSelection(planned, ids(planned).slice(0, 5)), undefined);
  assert.match(validateImportSelection(planned, ids(planned))!, /100 MiB/);
});

test('Selection validation checks file metadata again and rejects duplicated paths', () => {
  const [valid] = planLocalFiles([fixture('valid.csv')], false);
  assert.ok(validateImportSelection([{ ...valid, file: fixture('large.csv', 20 * MiB + 1) }], [valid.id]));
  assert.ok(validateImportSelection([valid, { ...valid, id: 'another-id' }], [valid.id, 'another-id']));
});

test('Planning and validation leave caller-owned arrays and candidates unchanged', () => {
  const files = Object.freeze([fixture('z.csv'), fixture('a.csv')]);
  const planned = planLocalFiles(files, false);
  const prior = planned.map((candidate) => ({ ...candidate }));
  const frozen = Object.freeze(planned.map((candidate) => Object.freeze(candidate)));
  assert.equal(validateImportSelection(frozen, Object.freeze(ids(planned))), undefined);
  assert.deepEqual(planned, prior);
  assert.equal(files[0].name, 'z.csv');
});
