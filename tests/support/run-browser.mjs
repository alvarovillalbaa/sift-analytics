import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { open, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { guardRoot } from './fixtures.mjs';

const root = process.env.SIFT_IMPORT_RUN_ROOT; const proof = process.env.SIFT_IMPORT_PROOF_DIR;
assert.ok(root && proof); await guardRoot(root, process.env.SIFT_IMPORT_NONCE);
assert.equal(process.version, 'v24.22.2');
const taskStartTicks = process.env.SIFT_IMPORT_START_TICKS;
assert.ok(/^[1-9][0-9]{0,19}$/.test(taskStartTicks ?? ''), 'A positive bounded task-start tick cutoff is required');
const scope = process.env.SIFT_BROWSER_SCOPE ?? 'local-import';
const scopes = {
  'local-import': { spec: 'tests/e2e/local-import.spec.mjs', ids: ['L01', 'L02', 'L03', 'L04'] },
  'panel-form': { spec: 'tests/e2e/panel-form.spec.mjs', ids: ['F01', 'F02', 'F03', 'F04', 'F05', 'F06'] },
};
assert.ok(Object.hasOwn(scopes, scope), 'Unknown browser-check scope');
const env = {};
for (const key of ['HOME', 'PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'TEMP', 'TMP', 'CI', 'SOURCE_COMMIT', 'SIFT_IMPORT_RUN_ROOT', 'SIFT_IMPORT_NONCE', 'SIFT_IMPORT_START_TICKS', 'SIFT_IMPORT_PROOF_DIR', 'SIFT_IMPORT_PLAYWRIGHT_DIR', 'PLAYWRIGHT_BROWSERS_PATH']) if (process.env[key] !== undefined) env[key] = process.env[key];
env.NODE_ENV = 'production'; env.NEXT_TELEMETRY_DISABLED = '1';
if (scope === 'panel-form') env.SIFT_SESSION_SECRET = randomBytes(32).toString('hex');
const report = { schemaVersion: 1, scope, sourceCommit: env.SOURCE_COMMIT, startedAt: new Date().toISOString(), commands: [], cleanup: {}, passed: false, proofLimits: ['Owned child groups and terminal pipes are observed; an external job kill remains an infrastructure boundary.', 'Only exact unchanged same-UID baseline identities born before the recorded task-start cutoff are excluded from the later marker scan; task-created build/tool residue remains in scope. This is not a host-wide absence check.'] };
const children = [];
const baseline = new Map();
const processLimit = 2048;
report.processBaseline = { limit: processLimit, taskStartTicks, exclusionScope: 'exact_unchanged_pre_task_identities_only', complete: false, identities: [] };
const workEnd = Date.now() + 360000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function identity(pid) {
  try {
    const text = await readFile(`/proc/${pid}/stat`, 'utf8'); const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    const info = await stat(`/proc/${pid}`); return { pid, uid: info.uid, ppid: Number(fields[1]), pgid: Number(fields[2]), startTime: fields[19], state: fields[0] };
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error; }
}
function groupGone(pgid) { try { process.kill(-pgid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } }
function sameIdentity(a, b) { return a.pid === b.pid && a.uid === b.uid && a.pgid === b.pgid && a.startTime === b.startTime; }
function errorCode(error) { return typeof error.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'UNKNOWN'; }
async function launch(label, args) {
  const row = { label, args, pid: null, identity: null, exitCode: null, signal: null, closeObserved: false, streams: {}, signalsSent: [] };
  report.commands.push(row);
  const handles = await Promise.all(['stdout', 'stderr'].map((name) => open(path.join(proof, `${label}.${name}.log`), 'wx', 0o600)));
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  row.pid = child.pid;
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => { row.exitCode = code; row.signal = signal; }); child.on('close', () => { row.closeObserved = true; resolve(); }); });
  const writes = [];
  for (const [index, name] of ['stdout', 'stderr'].entries()) {
    const handle = handles[index];
    const hash = createHash('sha256'); const record = { bytes: 0, retainedBytes: 0, sha256: null, eof: false, descriptorClosed: false, overflow: false };
    row.streams[name] = record; let serial = Promise.resolve();
    child[name].on('data', (chunk) => {
      record.bytes += chunk.length; hash.update(chunk);
      if (record.retainedBytes + chunk.length <= 2 * 1024 * 1024) { record.retainedBytes += chunk.length; serial = serial.then(() => handle.write(chunk)); }
      else record.overflow = true;
    });
    writes.push(new Promise((resolve, reject) => {
      child[name].on('end', () => { record.eof = true; });
      child[name].on('error', reject);
      child[name].on('close', () => {
        serial.then(() => { record.sha256 = hash.digest('hex'); return handle.close(); }).then(() => { record.descriptorClosed = true; resolve(); }, reject);
      });
    }));
  }
  const tracked = { child, row, done: Promise.all([done, ...writes]) }; tracked.done.catch(() => {}); children.push(tracked);
  row.identity = child.pid ? await identity(child.pid) : null;
  assert.ok(row.identity && row.identity.uid === process.getuid() && row.identity.pgid === child.pid);
  return tracked;
}
async function signal(tracked, name) {
  const current = await identity(tracked.row.pid);
  if (!current) return;
  assert.ok(tracked.row.identity, 'Cannot signal a child without its observed launch identity');
  assert.equal(current.uid, tracked.row.identity.uid); assert.equal(current.startTime, tracked.row.identity.startTime); assert.equal(current.pgid, tracked.row.pid);
  process.kill(-tracked.row.pid, name); tracked.row.signalsSent.push(name);
}
async function wait(tracked, ms) {
  let timer;
  try { return await Promise.race([tracked.done.then(() => true), new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); })]); }
  finally { clearTimeout(timer); }
}
async function stop(tracked, expectedServer = false) {
  if (tracked.child.exitCode === null && tracked.child.signalCode === null) {
    await signal(tracked, 'SIGTERM');
    if (!await wait(tracked, 8000)) { await signal(tracked, 'SIGKILL'); await wait(tracked, 5000); }
  }
  assert.ok(await wait(tracked, 1000), 'Tracked child not reaped/drained');
  const deadline = Date.now() + 3000;
  while (!groupGone(tracked.row.pid) && Date.now() < deadline) await delay(50);
  tracked.row.originalGroupAbsent = groupGone(tracked.row.pid);
  assert.ok(tracked.row.originalGroupAbsent);
  assert.ok(Object.values(tracked.row.streams).every((stream) => stream.eof && stream.descriptorClosed && !stream.overflow));
  assert.ok(!tracked.row.signalsSent.includes('SIGKILL'));
  if (!expectedServer) assert.ok(tracked.row.exitCode === 0 && tracked.row.signal === null && tracked.row.signalsSent.length === 0);
  else assert.ok(tracked.row.exitCode === 0 || tracked.row.signal === 'SIGTERM'
    || tracked.row.exitCode === 143 && tracked.row.signal === null && tracked.row.signalsSent.length === 1 && tracked.row.signalsSent[0] === 'SIGTERM');
}
let server;
try {
  const supervisorIdentity = await identity(process.pid);
  assert.ok(supervisorIdentity && BigInt(taskStartTicks) <= BigInt(supervisorIdentity.startTime), 'Task-start cutoff must not follow supervisor launch');
  for (const name of await readdir('/proc')) {
    if (!/^[0-9]+$/.test(name)) continue;
    const info = await identity(Number(name)); if (!info || info.uid !== process.getuid()) continue;
    assert.ok(baseline.size < processLimit, 'Same-UID process baseline exceeds its bound');
    baseline.set(info.pid, info); report.processBaseline.identities.push(info);
  }
  report.processBaseline.complete = true;
  server = await launch('server', ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '4173']);
  const readyEnd = Math.min(Date.now() + 60000, workEnd); let ready = false;
  while (Date.now() < readyEnd) {
    assert.equal(server.child.exitCode, null);
    try { const response = await fetch('http://127.0.0.1:4173', { signal: AbortSignal.timeout(1000) }); if (response.status === 200) { await response.arrayBuffer(); ready = true; break; } } catch {}
    await delay(200);
  }
  assert.ok(ready, 'Production Next server did not become ready');
  const test = await launch('browser', [scopes[scope].spec]);
  const browserBudget = Math.min(300000, workEnd - Date.now()); assert.ok(browserBudget > 0);
  report.browserBudgetMs = browserBudget;
  assert.ok(await wait(test, browserBudget), 'Focused browser deadline exceeded');
  await stop(test);
  const value = JSON.parse(await readFile(path.join(proof, 'browser.json'), 'utf8'));
  assert.equal(value.passed, true); assert.deepEqual(value.cases.map((row) => row.id), scopes[scope].ids);
  assert.ok(value.cases.every((row) => row.status === 'passed'));
  report.passed = true;
} catch (error) { report.error = String(error.stack ?? error).slice(0, 12000); }
finally {
  const failures = [];
  for (const tracked of [...children].reverse()) {
    try { await stop(tracked, tracked === server); }
    catch (error) { failures.push(`${tracked.row.label}:${error.message}`); }
  }
  const ancestors = new Set([process.pid]); let ancestor = await identity(process.pid);
  while (ancestor?.ppid > 1 && !ancestors.has(ancestor.ppid)) { ancestors.add(ancestor.ppid); ancestor = await identity(ancestor.ppid); }
  const remaining = []; const skipped = []; const scanErrors = [];
  let inspected = 0;
  try {
    for (const name of await readdir('/proc')) {
      if (!/^[0-9]+$/.test(name) || ancestors.has(Number(name))) continue;
      const info = await identity(Number(name)); if (!info || info.uid !== process.getuid()) continue;
      assert.ok(++inspected <= processLimit, 'Same-UID process scan exceeds its bound');
      const previous = baseline.get(info.pid);
      if (report.processBaseline.complete && previous && sameIdentity(previous, info) && BigInt(info.startTime) < BigInt(taskStartTicks)) { skipped.push(info); continue; }
      try {
        const variables = (await readFile(`/proc/${name}/environ`)).toString().split('\0');
        if (variables.includes(`SIFT_IMPORT_RUN_ROOT=${root}`)) remaining.push(info);
      } catch (error) {
        const record = { ...info, errno: errorCode(error), identityAfter: null, disposition: null }; scanErrors.push(record);
        try { record.identityAfter = await identity(info.pid); }
        catch (recheckError) { record.recheckErrno = errorCode(recheckError); record.disposition = 'identity_recheck_failed'; failures.push('owned_process_scan_uncertain'); continue; }
        if (!record.identityAfter) record.disposition = 'vanished';
        else if (record.identityAfter.startTime !== info.startTime) record.disposition = 'pid_reused';
        else { record.disposition = 'stable_unreadable'; failures.push('owned_process_scan_uncertain'); }
      }
    }
  } catch (error) {
    report.cleanup.scanError = { errno: errorCode(error) }; failures.push('owned_process_scan_failed');
  }
  report.cleanup.baselineProcessesSkipped = skipped;
  report.cleanup.baselineProcessesSkippedCount = skipped.length;
  report.cleanup.scanErrors = scanErrors;
  report.cleanup.ownedMarkedProcessesRemaining = remaining;
  if (remaining.length) failures.push('owned_marked_processes_remain');
  report.cleanup.failures = failures; report.passed &&= failures.length === 0;
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(proof, 'run.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
