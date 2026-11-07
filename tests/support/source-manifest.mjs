import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

assert.equal(process.argv.length, 3);
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const entries = execFileSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const files = [];
for (const entry of entries) {
  const match = /^(100644|100755) ([a-f0-9]{40}) 0\t(.+)$/.exec(entry); assert.ok(match, 'Only regular tracked source files are admitted');
  const [, mode, blob, file] = match; const info = await lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink());
  const body = await readFile(file);
  const computed = createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
  const observedMode = info.mode & 0o111 ? '100755' : '100644';
  files.push({ path: file, mode, blob, observedMode, observedBlob: computed, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') });
}
await writeFile(process.argv[2], `${JSON.stringify({ head, files }, null, 2)}\n`, { flag: 'wx' });
assert.equal(head, process.env.SOURCE_COMMIT);
assert.ok(files.every((file) => file.mode === file.observedMode && file.blob === file.observedBlob), 'Observed checkout differs from the index');
assert.equal(spawnSync('git', ['diff', '--quiet', 'HEAD', '--']).status, 0, 'Index or checkout differs from immutable HEAD');
console.log(`SOURCE_MANIFEST ${head} ${files.length} files`);
