import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const CANARY = 'SIFT_LOCAL_IMPORT_CANARY_8f37db42_20261107';
const csv = (rows) => `item,amount,canary\n${rows.map(([item, amount]) => `${item},${amount},${CANARY}`).join('\n')}\n`;
export const FILES = Object.freeze([
  { relative: 'north/sales.csv', text: csv([['north-a', 10], ['north-b', 20]]), rows: 2, total: 30, selected: true },
  { relative: 'south/sales.csv', text: csv([['south-a', 7]]), rows: 1, total: 7, selected: true },
  { relative: 'events.json', text: `${JSON.stringify([{ item: 'event-a', amount: 3, canary: CANARY }, { item: 'event-b', amount: 4, canary: CANARY }])}\n`, rows: 2, total: 7, selected: true },
  { relative: 'notes.ndjson', text: `${JSON.stringify({ item: 'note-a', amount: 5, canary: CANARY })}\n`, rows: 1, total: 5, selected: true },
  { relative: 'bad.json', text: `{"broken": ${CANARY} NOT_JSON}\n`, selected: true, invalid: true },
  { relative: 'ignored.csv', text: csv([['must-stay-unselected', 9999]]), rows: 1, total: 9999, selected: false },
]);
export const RACE_FILES = Object.freeze([
  { relative: 'first.csv', text: csv([['committed-first', 11]]), rows: 1, total: 11 },
  { relative: 'second.csv', text: csv([['queued-second', 13]]), rows: 1, total: 13 },
]);
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function guardRoot(root, nonce) {
  assert.ok(path.isAbsolute(root) && /^[a-f0-9]{32}$/.test(nonce ?? ''));
  const info = await lstat(root);
  assert.ok(info.isDirectory() && !info.isSymbolicLink());
  assert.equal(info.uid, process.getuid()); assert.equal(info.mode & 0o777, 0o700);
  assert.equal(await realpath(root), root);
  const marker = path.join(root, '.owner'); const mark = await lstat(marker);
  assert.ok(mark.isFile() && !mark.isSymbolicLink()); assert.equal(mark.uid, process.getuid()); assert.equal(mark.mode & 0o777, 0o600);
  assert.equal(await readFile(marker, 'utf8'), nonce);
}

export async function createFixture(parent, name, files) {
  assert.ok(/^[a-z][a-z0-9-]{1,48}$/.test(name));
  const directory = path.join(parent, name);
  await mkdir(directory, { mode: 0o700 });
  const records = [];
  for (const file of files) {
    const destination = path.join(directory, file.relative);
    assert.ok(path.relative(directory, destination) && !path.relative(directory, destination).startsWith('..'));
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const bytes = Buffer.from(file.text);
    assert.ok(bytes.length < 4096);
    await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
    records.push({ ...file, path: `${name}/${file.relative}`, absolute: destination, bytes: bytes.length, sha256: sha(bytes) });
  }
  return { directory, name, files: records };
}

export async function verifyFixture(fixture) {
  for (const file of fixture.files) {
    const info = await lstat(file.absolute);
    assert.ok(info.isFile() && !info.isSymbolicLink()); assert.equal(info.uid, process.getuid());
    const bytes = await readFile(file.absolute); assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256);
  }
  return true;
}
