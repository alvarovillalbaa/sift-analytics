import assert from 'node:assert/strict';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
const root = process.env.SIFT_IMPORT_PROOF_DIR; assert.ok(root);
const allowed = /^(source-(?:before|after)\.json|(?:fixture|unit)-tests\.tap|(?:install|build|server\.stdout|server\.stderr|browser\.stdout|browser\.stderr)\.log|browser\.json|run\.json|fixture-manifest\.json|tools-lock\.json|(?:desktop|narrow|commit-race|workbook|panel-form-F0[1-6])\.png)$/;
let total = 0;
for (const name of (await readdir(root)).sort()) {
  assert.ok(allowed.test(name), 'Unexpected proof file'); const file = path.join(root, name); const info = await lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 2 * 1024 * 1024);
  total += info.size; assert.ok(total <= 8 * 1024 * 1024);
  const bytes = await readFile(file); const packed = gzipSync(bytes, { level: 9, mtime: 0 }); const encoded = packed.toString('base64');
  console.log(`SIFT_IMPORT_PROOF_FILE ${JSON.stringify({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), gzipBytes: packed.length, chunks: Math.ceil(encoded.length / 3000) })}`);
  for (let offset = 0; offset < encoded.length; offset += 3000) console.log(`SIFT_IMPORT_PROOF_CHUNK ${JSON.stringify({ name, index: offset / 3000, data: encoded.slice(offset, offset + 3000) })}`);
}
