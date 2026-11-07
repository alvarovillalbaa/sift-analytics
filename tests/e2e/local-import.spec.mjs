// T2: actual production UI, DuckDB worker and IndexedDB over disposable authored files.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CANARY, FILES, RACE_FILES, createFixture, verifyFixture, guardRoot, sha } from '../support/fixtures.mjs';
import { createWorkbook } from '../fixtures/workbook.mjs';

const ROOT = process.env.SIFT_IMPORT_RUN_ROOT;
const PROOF = process.env.SIFT_IMPORT_PROOF_DIR;
const TOOLS = process.env.SIFT_IMPORT_PLAYWRIGHT_DIR;
const SOURCE = process.env.SOURCE_COMMIT;
const ORIGIN = 'http://127.0.0.1:4173';
assert.ok(ROOT && PROOF && TOOLS && /^[a-f0-9]{40}$/.test(SOURCE ?? ''));
assert.equal(process.version, 'v24.22.2');
await guardRoot(ROOT, process.env.SIFT_IMPORT_NONCE);
for (const entry of [PROOF, TOOLS]) assert.ok(path.isAbsolute(entry) && path.relative(ROOT, entry) && !path.relative(ROOT, entry).startsWith('..'));
const require = createRequire(path.join(TOOLS, 'package.json'));
const { chromium, expect } = require('playwright/test');
const fixtures = await createFixture(ROOT, 'authored-import', FILES);
const raceFixture = await createFixture(ROOT, 'committed-import', RACE_FILES);
const workbookBytes = createWorkbook();
assert.equal(workbookBytes.length, 3063); assert.equal(sha(workbookBytes), 'b1686c3b2b389f75dae32a01d0a4ef87cb76c100d30c100473f06ccd4334da38');
const workbookPath = path.join(ROOT, 'authored-workbook.xlsx');
await writeFile(workbookPath, workbookBytes, { flag: 'wx', mode: 0o600 });
await mkdir(PROOF, { recursive: true, mode: 0o700 });
await writeFile(path.join(PROOF, 'fixture-manifest.json'), `${JSON.stringify({ canary: CANARY, normal: fixtures, commitRace: raceFixture }, null, 2)}\n`);
const report = { schemaVersion: 1, tier: 'T2', sourceCommit: SOURCE, node: process.version, cases: [], passed: false,
  proofLimits: ['Authored files and private Chromium contexts only; no customer folder, server database, account or model.', 'L03 explicitly injects a native IndexedDB completion/Stop-button race; it is not ordinary-user timing evidence.', 'XLSX proof uses one authored two-sheet workbook; Parquet, model analysis and deployed hosting are outside these four cases.'] };
const browser = await chromium.launch({ headless: true, timeout: 30000 });
report.browser = browser.version();
let browserClosing = false;
const globalFailures = [];
browser.on('disconnected', () => { if (!browserClosing) globalFailures.push('unexpected_browser_disconnect'); });
const live = new Set();
const sessionControls = new WeakMap();
const SESSION_DEADLINE_MS = 10000;
process.once('SIGTERM', () => {
  globalFailures.push('supervisor_deadline_signal');
  browserClosing = true;
  void browser.close().catch(() => globalFailures.push('deadline_browser_close_failed'));
});

function allowed(request) {
  const url = new URL(request.url());
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash) return false;
  if (request.method() === 'POST') return url.pathname === '/api/session' && !(request.postDataBuffer()?.length);
  return ['GET', 'HEAD'].includes(request.method()) && (['/', '/icon.svg', '/favicon.ico', '/duckdb/duckdb-browser-mvp.worker.js', '/duckdb/duckdb-mvp.wasm'].includes(url.pathname)
    || url.pathname.startsWith('/_next/static/') && !url.pathname.includes('..') && !/%2f|%5c/i.test(url.pathname));
}
async function fresh(profile, result, fault = false) {
  const context = await browser.newContext({ viewport: profile === 'narrow' ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: profile === 'narrow', hasTouch: profile === 'narrow', serviceWorkers: 'block', acceptDownloads: false });
  live.add(context); result.boundary = { requests: [], violations: [], failures: [], console: [], sessionResponses: [], sessionRequests: [], sessionNavigations: [], sessionCheckpoints: [], expectedSessionConsole: 0, pagesCreated: 0, websockets: 0 };
  result.cleanup = { closeExpected: false, contextClosed: false, pageClosed: false };
  const boundary = result.boundary;
  const fail = (code) => { if (boundary.violations.length < 30) boundary.violations.push(code); };
  const sessions = new Map(); const sessionJobs = new Set(); let navigation = 0; let sessionOverflow = false;
  function beginNavigation(phase) {
    navigation++;
    boundary.sessionNavigations.push({ ordinal: navigation, phase, startedAt: Date.now() });
  }
  function sessionRequest(request) {
    const url = new URL(request.url());
    if (url.origin !== ORIGIN || url.pathname !== '/api/session') return null;
    let row = sessions.get(request);
    if (!row) {
      if (sessions.size >= 16) { sessionOverflow = true; fail('session_request_bound'); return null; }
      row = { ordinal: sessions.size + 1, navigation, method: request.method(), path: url.pathname, startedAt: Date.now(), status: null, responseAt: null,
        requestFinishedAt: null, failedAt: null, failure: null, finishedStartedAt: null, finishedDeadlineAt: null, finishedSettledAt: null, finishedResolvedNull: false,
        completionError: null, responseTimeoutAt: null, checkpointTimeoutAt: null };
      sessions.set(request, row); boundary.sessionRequests.push(row);
    }
    return row;
  }
  function finishSession(response, row) {
    if (!row || row.finishedStartedAt !== null) { fail('session_response_identity'); return; }
    row.status = response.status(); row.responseAt = Date.now(); row.finishedStartedAt = Date.now(); row.finishedDeadlineAt = row.finishedStartedAt + SESSION_DEADLINE_MS;
    const job = (async () => {
      let timer;
      try {
        const outcome = await Promise.race([response.finished(), new Promise((_, reject) => {
          timer = setTimeout(() => { row.responseTimeoutAt = Date.now(); reject(new Error('session_finished_timeout')); }, SESSION_DEADLINE_MS);
        })]);
        assert.equal(outcome, null, 'The observed session response must finish successfully');
        if (Date.now() >= row.finishedDeadlineAt) { row.responseTimeoutAt ??= Date.now(); throw new Error('session_finished_timeout'); }
        row.finishedResolvedNull = true;
      } catch (error) {
        row.completionError = String(error?.message ?? error).slice(0, 500);
        fail(row.responseTimeoutAt ? 'session_finished_timeout' : 'session_finished_rejected');
      } finally { clearTimeout(timer); row.finishedSettledAt = Date.now(); }
    })();
    sessionJobs.add(job); void job.finally(() => sessionJobs.delete(job));
  }
  async function settleSessions(phase) {
    const checkpoint = { phase, navigation, startedAt: Date.now(), deadlineAt: null, settledAt: null, observedOrdinals: [], completed: false, error: null };
    boundary.sessionCheckpoints.push(checkpoint);
    const deadline = checkpoint.startedAt + SESSION_DEADLINE_MS;
    checkpoint.deadlineAt = deadline;
    try {
      while (true) {
        const rows = [...sessions.values()]; checkpoint.observedOrdinals = rows.map((row) => row.ordinal);
        assert.equal(sessionOverflow, false, 'Every session request must fit the bounded identity ledger');
        assert.ok(rows.every((row) => row.failedAt === null && row.completionError === null && row.responseTimeoutAt === null && row.checkpointTimeoutAt === null), 'An observed session request failed or timed out');
        const observedThisNavigation = rows.some((row) => row.navigation === navigation);
        if (Date.now() >= deadline) {
          for (const row of rows) if (!row.finishedResolvedNull || row.requestFinishedAt === null) row.checkpointTimeoutAt ??= Date.now();
          fail(observedThisNavigation ? 'session_checkpoint_timeout' : 'session_request_not_observed');
          throw new Error(observedThisNavigation ? 'session_checkpoint_timeout' : 'session_request_not_observed');
        }
        if (observedThisNavigation && rows.every((row) => row.status === 503 && row.finishedResolvedNull && row.requestFinishedAt !== null)) {
          checkpoint.completed = true; break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } catch (error) { checkpoint.error = String(error?.message ?? error).slice(0, 500); throw error; }
    finally { checkpoint.settledAt = Date.now(); }
  }
  sessionControls.set(context, { result, beginNavigation, settleSessions, drain: () => Promise.allSettled([...sessionJobs]) });
  context.on('page', (page) => {
    boundary.pagesCreated++; if (boundary.pagesCreated > 1) fail('extra_page');
    page.on('pageerror', (error) => fail(`page_error:${error.message.slice(0, 500)}`));
    page.on('crash', () => fail('page_crash'));
    page.on('websocket', () => { boundary.websockets++; fail('websocket'); });
    page.on('close', () => { result.cleanup.pageClosed = true; if (!result.cleanup.closeExpected) fail('unexpected_page_close'); });
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (message.location().url === `${ORIGIN}/api/session` && /^Failed to load resource: the server responded with a status of 503 \((?:Service Unavailable)?\)$/.test(message.text())) { boundary.expectedSessionConsole++; return; }
      if (boundary.console.length < 12) boundary.console.push(message.text().slice(0, 1000));
      fail('console_error');
    });
  });
  context.on('close', () => { result.cleanup.contextClosed = true; if (!result.cleanup.closeExpected) fail('unexpected_context_close'); });
  context.on('request', (request) => {
    sessionRequest(request);
    if (boundary.requests.length < 150) boundary.requests.push({ method: request.method(), path: new URL(request.url()).pathname }); else fail('request_bound');
    const exposed = `${request.url()}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ''}`;
    if (exposed.includes(CANARY)) fail('authored_canary_network_leak');
    if (!allowed(request)) fail('request_outside_finite_local_policy');
  });
  context.on('requestfinished', (request) => { const row = sessions.get(request); if (row) row.requestFinishedAt = Date.now(); });
  context.on('requestfailed', (request) => {
    const row = sessions.get(request); if (row) { row.failedAt = Date.now(); row.failure = request.failure()?.errorText ?? 'unknown'; }
    if (boundary.failures.length < 20) boundary.failures.push({ path: new URL(request.url()).pathname, failure: request.failure()?.errorText }); fail('request_failed');
  });
  context.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === ORIGIN && url.pathname === '/api/session') {
      boundary.sessionResponses.push(response.status()); finishSession(response, sessions.get(response.request()));
      if (response.status() !== 503) fail('unexpected_session_configuration');
    }
    else if (response.status() >= 400) fail(`http_${response.status()}:${url.pathname}`);
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const raw = `${request.url()}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ''}`;
    if (!allowed(request) || raw.includes(CANARY)) { fail('blocked_disallowed_network'); await route.abort('blockedbyclient'); }
    else await route.continue();
  });
  await context.routeWebSocket('**/*', (route) => { fail('blocked_websocket'); route.close(); });
  if (fault) await context.addInitScript(() => {
    const state = { installed: true, intercepted: 0, complete: 0, stopButtons: 0, stopClicked: false, abortCalls: 0, abortThrows: 0, nativeAbortName: null };
    Object.defineProperty(window, '__siftImportCommitFault', { value: state });
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = Reflect.apply(original, this, args);
      const names = typeof args[0] === 'string' ? [args[0]] : Array.from(args[0]);
      if (this.name === 'sift.local-data.v1' && args[1] === 'readwrite' && names.length === 1 && names[0] === 'files' && state.intercepted === 0) {
        state.intercepted++;
        IDBDatabase.prototype.transaction = original;
        const abort = transaction.abort;
        transaction.abort = function (...values) {
          state.abortCalls++;
          try { return Reflect.apply(abort, this, values); }
          catch (error) { state.abortThrows++; state.nativeAbortName = error instanceof DOMException ? error.name : 'other'; throw error; }
        };
        transaction.addEventListener('complete', () => {
          state.complete++;
          const buttons = [...document.querySelectorAll('button')].filter((button) => button.textContent.trim() === 'Stop import' && !button.disabled && button.getClientRects().length);
          state.stopButtons = buttons.length;
          if (buttons.length === 1) { state.stopClicked = true; buttons[0].click(); }
        }, { once: true });
      }
      return transaction;
    };
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(45000);
  beginNavigation('startup');
  const response = await page.goto(ORIGIN, { waitUntil: 'load' }); assert.equal(response.status(), 200);
  await expect(page.getByRole('button', { name: 'Add panel', exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({ timeout: 60000 });
  await settleSessions('startup-complete');
  return { context, page };
}
async function reloadPage(page, context, phase) {
  const control = sessionControls.get(context);
  await control.settleSessions(`before-${phase}`);
  control.beginNavigation(phase);
  await page.reload({ waitUntil: 'load' });
  await control.settleSessions(`after-${phase}`);
}
async function closeContext(context, result) {
  const control = sessionControls.get(context);
  try { await control.settleSessions('before-context-close'); result.cleanup.sessionsCompletedBeforeClose = true; }
  catch (error) { result.cleanup.sessionsCompletedBeforeClose = false; result.cleanup.sessionCompletionError = String(error?.message ?? error).slice(0, 500); }
  finally {
    result.cleanup.closeExpected = true;
    await context.close();
    await control.drain();
    live.delete(context);
  }
}
async function sources(page, profile) {
  if (profile === 'narrow') await page.getByRole('button', { name: 'Open navigation', exact: true }).tap();
  await page.getByRole('button', { name: /^Data sources/ }).click();
  const dialog = page.getByRole('dialog', { name: 'sources', exact: true });
  await expect(dialog).toBeVisible(); return dialog;
}
async function snapshot(page, result, stage) {
  const value = await page.evaluate(async () => {
    const raw = localStorage.getItem('sift.workspace.v1');
    if (!raw || raw.length > 256 * 1024) throw new Error('workspace_snapshot_bound');
    const files = await new Promise((resolve, reject) => {
      const opened = indexedDB.open('sift.local-data.v1');
      opened.onupgradeneeded = () => { opened.transaction.abort(); reject(new Error('expected_existing_database')); };
      opened.onerror = () => reject(new Error('snapshot_open_failed'));
      opened.onsuccess = () => {
        const database = opened.result; const tx = database.transaction('files', 'readonly'); const request = tx.objectStore('files').getAll(); let records;
        request.onsuccess = () => { records = request.result; };
        tx.oncomplete = () => { database.close(); resolve(records); };
        tx.onerror = tx.onabort = () => { database.close(); reject(new Error('snapshot_read_failed')); };
      };
    });
    const records = [];
    for (const file of files) {
      if (!(file.bytes instanceof ArrayBuffer) || file.bytes.byteLength > 4096) throw new Error('authored_payload_bound');
      const bytes = new Uint8Array(file.bytes);
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      records.push({ id: file.id, name: file.name, updatedAt: file.updatedAt, sheet: file.sheet ?? null, bytes: bytes.length, sha256: hash, originalBase64: btoa(String.fromCharCode(...bytes)) });
    }
    return { workspaceRaw: raw, files: records.sort((a, b) => a.id.localeCompare(b.id)) };
  });
  value.stage = stage; value.workspaceSha256 = sha(value.workspaceRaw); value.workspace = JSON.parse(value.workspaceRaw);
  result.snapshots.push(value); return value;
}
function assertSources(state, files, baseline) {
  const datasets = state.workspace.datasets.filter((dataset) => dataset.kind === 'file');
  assert.equal(datasets.length, files.length); assert.equal(state.files.length, files.length);
  assert.equal(new Set(datasets.map((dataset) => dataset.id)).size, files.length);
  for (const file of files) {
    const record = state.files.find((row) => row.name === file.path);
    assert.ok(record, `Expected stored path: ${file.path}`); assert.equal(record.sha256, file.sha256); assert.equal(record.bytes, file.bytes);
    assert.equal(Buffer.from(record.originalBase64, 'base64').toString(), file.text);
    const dataset = datasets.find((row) => row.id === record.id); assert.ok(dataset);
    assert.equal(dataset.name, file.path); assert.equal(dataset.rowCount, file.rows); assert.equal(dataset.table, record.id);
    assert.match(dataset.id, /^data_[a-f0-9]{32}$/);
  }
  if (files.length) { assert.equal(state.workspace.shareSchema, false); assert.equal(state.workspace.shareResults, false); }
  if (baseline) {
    const strip = ({ datasets, shareSchema, shareResults, ...rest }) => rest;
    assert.deepEqual(strip(state.workspace), strip(baseline.workspace), 'Unrelated workspace metadata must remain unchanged');
    assert.deepEqual(state.workspace.datasets.filter((row) => row.kind !== 'file'), baseline.workspace.datasets);
  }
  return datasets;
}
async function persistReady(page, count) {
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('sift.workspace.v1'); return raw ? JSON.parse(raw).datasets.filter((dataset) => dataset.kind === 'file').length : -1;
  })).toBe(count);
}
async function ordinary(profile, result) {
  const { context, page } = await fresh(profile, result); result.snapshots = [];
  try {
    const baseline = await snapshot(page, result, 'baseline'); assertSources(baseline, []);
    const dialog = await sources(page, profile);
    await dialog.getByLabel('Choose a data folder', { exact: true }).setInputFiles(fixtures.directory);
    await expect(dialog.locator('.import-candidate')).toHaveCount(6);
    const preview = await dialog.locator('.import-candidate').evaluateAll((rows) => rows.map((row) => ({ path: row.querySelector('strong').textContent, checked: row.querySelector('input[type=checkbox]').checked })));
    assert.deepEqual(preview.map((row) => row.path).sort(), fixtures.files.map((file) => file.path).sort());
    assert.ok(preview.every((row) => row.checked === false)); result.preview = preview;
    const beforeImport = await snapshot(page, result, 'metadata-preview'); assert.deepEqual(beforeImport.files, []); assert.equal(beforeImport.workspaceRaw, baseline.workspaceRaw);
    const healthy = fixtures.files.filter((file) => file.selected && !file.invalid);
    for (const file of [...healthy, fixtures.files.find((file) => file.invalid)]) await dialog.getByLabel(`Select ${file.path}`, { exact: true }).check();
    assert.equal(await dialog.getByLabel(`Select ${fixtures.files.find((file) => !file.selected).path}`, { exact: true }).isChecked(), false);
    await dialog.getByRole('button', { name: 'Import selected', exact: true }).click();
    await expect(dialog.getByText(/^4 imported, 1 failed in this run\./)).toBeVisible({ timeout: 150000 });
    await persistReady(page, 4);
    const imported = await snapshot(page, result, 'partial-import'); const datasets = assertSources(imported, healthy, baseline);
    for (const file of healthy) {
      const checkbox = dialog.getByLabel(`Select ${file.path}`, { exact: true }); await expect(checkbox).toBeDisabled();
      await expect(checkbox.locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," import-candidate ")][1]').locator('.import-outcome')).toHaveText(`Ready · ${file.rows} rows`);
    }
    const bad = fixtures.files.find((file) => file.invalid);
    const badRow = dialog.getByLabel(`Select ${bad.path}`, { exact: true }).locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," import-candidate ")][1]');
    assert.ok((await badRow.locator('.import-outcome').textContent()).length > 0); assert.equal(await badRow.locator('.import-outcome').textContent().then((text) => text.startsWith('Ready')), false);
    await dialog.getByRole('button', { name: 'Import selected', exact: true }).click();
    await expect(dialog.getByText(/^0 imported, 1 failed in this run\./)).toBeVisible({ timeout: 45000 });
    const retried = await snapshot(page, result, 'failed-only-retry'); assertSources(retried, healthy, baseline);
    assert.deepEqual(retried.files, imported.files); assert.equal(retried.workspaceRaw, imported.workspaceRaw);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await reloadPage(page, context, 'folder-reload');
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({ timeout: 60000 }); await persistReady(page, 4);
    const restored = await snapshot(page, result, 'reload'); assertSources(restored, healthy, baseline); assert.deepEqual(restored.files, imported.files);
    assert.deepEqual(restored.workspace.datasets, imported.workspace.datasets);

    if (profile === 'narrow') await page.getByRole('button', { name: 'Open navigation', exact: true }).tap();
    await page.getByRole('button', { name: 'Create a view', exact: true }).click();
    let editor = page.getByRole('dialog', { name: 'new-view', exact: true });
    const viewName = `Authored folder ${profile}`; const panelName = `Selected-file aggregate ${profile}`;
    await editor.getByLabel('View name', { exact: true }).fill(viewName); await editor.getByRole('button', { name: 'Create view', exact: true }).click();
    const closeNavigation = page.getByRole('button', { name: 'Close navigation', exact: true });
    if (await closeNavigation.isVisible()) await closeNavigation.tap();
    await page.getByRole('button', { name: 'Add panel', exact: true }).click(); editor = page.getByRole('dialog', { name: 'panel', exact: true });
    const sql = `SELECT SUM(amount) AS total_amount, COUNT(*) AS row_count FROM (${datasets.map((dataset) => `SELECT amount FROM "${dataset.table}"`).join(' UNION ALL ')}) AS selected_files`;
    await editor.getByLabel('Title', { exact: true }).fill(panelName);
    await editor.locator('select').first().selectOption('table');
    await editor.locator('select[multiple]').selectOption(datasets.map((dataset) => dataset.id));
    await editor.getByLabel('Read-only SQL', { exact: true }).fill(sql);
    await editor.getByRole('button', { name: 'Run & add panel', exact: true }).click();
    await expect(editor).toBeHidden({ timeout: 30000 });
    await page.getByRole('button', { name: `Inspect ${panelName}`, exact: true }).click();
    const inspection = page.getByRole('dialog', { name: panelName, exact: true });
    await expect(inspection.locator('.data-preview thead th')).toHaveText(['total_amount', 'row_count']);
    await expect(inspection.locator('.data-preview tbody tr')).toHaveCount(1);
    await expect(inspection.locator('.data-preview tbody tr td')).toHaveText(['49', '6']);
    assert.match(await inspection.locator('.evidence-meta').textContent(), /1 rows · complete result/);
    result.aggregate = { sql, columns: ['total_amount', 'row_count'], expectedRow: ['49', '6'], datasetIds: datasets.map((dataset) => dataset.id), sourceNames: healthy.map((file) => file.path) };
    await inspection.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const final = await snapshot(page, result, 'manual-sql'); assert.deepEqual(final.files, imported.files);
    assert.equal(final.workspace.datasets.filter((dataset) => dataset.kind === 'file').length, 4);
    assert.equal(final.workspace.views.length, baseline.workspace.views.length + 1);
    assert.deepEqual(final.workspace.views.filter((item) => item.name !== viewName), baseline.workspace.views);
    const ownView = final.workspace.views.find((item) => item.name === viewName); assert.equal(ownView.panels.length, 1);
    assert.equal(ownView.panels[0].sql, sql); assert.deepEqual(ownView.panels[0].datasetIds, datasets.map((dataset) => dataset.id));
    assert.equal(Object.hasOwn(ownView.panels[0], 'result'), false);
    await page.screenshot({ path: path.join(PROOF, `${profile}.png`), fullPage: false });
    result.checks = { folderInputRealDirectory: true, sixInitiallyUncheckedMetadataRows: true, explicitSubsetOnly: true, nestedBasenamesDistinct: true, malformedJSONPartialFailure: true, retryPreservesSuccesses: true, indexedDBDurableAfterReload: true, localSQLAggregate49AcrossSixRows: true, sharingRemainsOff: true };
  } finally { await closeContext(context, result); }
}
async function commitRace(result) {
  const { context, page } = await fresh('desktop', result, true); result.snapshots = [];
  try {
    const baseline = await snapshot(page, result, 'baseline'); const dialog = await sources(page, 'desktop');
    await dialog.getByLabel('Choose a data folder', { exact: true }).setInputFiles(raceFixture.directory);
    for (const file of raceFixture.files) await dialog.getByLabel(`Select ${file.path}`, { exact: true }).check();
    await dialog.getByRole('button', { name: 'Import selected', exact: true }).click();
    await expect(dialog.getByText(/^Import stopped\. 1 imported, 0 failed in this run\./)).toBeVisible({ timeout: 60000 });
    await persistReady(page, 1);
    const stopped = await snapshot(page, result, 'stop-after-native-commit'); assertSources(stopped, [raceFixture.files[0]], baseline);
    const fault = await page.evaluate(() => ({ ...window.__siftImportCommitFault }));
    assert.equal(fault.intercepted, 1); assert.equal(fault.complete, 1); assert.equal(fault.stopButtons, 1); assert.equal(fault.stopClicked, true);
    assert.equal(fault.abortCalls, 1); assert.equal(fault.abortThrows, 1); assert.equal(fault.nativeAbortName, 'InvalidStateError'); result.injectedFault = fault;
    await expect(dialog.getByLabel(`Select ${raceFixture.files[0].path}`, { exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Import selected', exact: true }).click();
    await expect(dialog.getByText(/^1 imported, 0 failed in this run\./)).toBeVisible({ timeout: 60000 }); await persistReady(page, 2);
    const retried = await snapshot(page, result, 'remaining-only-retry'); assertSources(retried, raceFixture.files, baseline);
    assert.deepEqual(retried.files.find((file) => file.id === stopped.files[0].id), stopped.files[0]);
    await page.screenshot({ path: path.join(PROOF, 'commit-race.png'), fullPage: false });
    result.checks = { nativeTransactionActuallyCompleted: true, stopClickedByExplicitFaultControl: true, completedFileAcknowledgedDespiteLateAbort: true, queuedFileNotImportedAfterStop: true, retryImportsOnlyRemaining: true };
  } finally { await closeContext(context, result); }
}
async function workbook(result) {
  const { context, page } = await fresh('desktop', result); result.snapshots = [];
  try {
    const baseline = await snapshot(page, result, 'baseline');
    let dialog = await sources(page, 'desktop');
    const waiting = page.waitForEvent('filechooser');
    await dialog.getByLabel('Choose data files', { exact: true }).click();
    await (await waiting).setFiles(workbookPath);
    await expect(dialog.locator('.import-candidate')).toHaveCount(1);
    const select = dialog.getByLabel('Select authored-workbook.xlsx', { exact: true });
    assert.equal(await select.isChecked(), false); await select.check();
    await expect(dialog.getByRole('button', { name: 'Import selected', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Inspect sheets for authored-workbook.xlsx', exact: true }).click();
    const sheets = dialog.getByLabel('Sheet for authored-workbook.xlsx', { exact: true });
    await expect(sheets.locator('option')).toHaveText(['North', 'South']);
    await sheets.selectOption('South'); await dialog.getByRole('button', { name: 'Import selected', exact: true }).click();
    await expect(dialog.getByText(/^1 imported, 0 failed in this run\./)).toBeVisible({ timeout: 60000 }); await persistReady(page, 1);
    const imported = await snapshot(page, result, 'chosen-sheet-import');
    const file = { path: 'authored-workbook.xlsx', text: null, bytes: workbookBytes.length, sha256: sha(workbookBytes), rows: 1 };
    assert.equal(imported.files.length, 1); assert.equal(imported.files[0].name, file.path); assert.equal(imported.files[0].sheet, 'South');
    assert.equal(imported.files[0].bytes, file.bytes); assert.equal(imported.files[0].sha256, file.sha256);
    assert.ok(Buffer.from(imported.files[0].originalBase64, 'base64').equals(workbookBytes));
    const dataset = imported.workspace.datasets.find((item) => item.id === imported.files[0].id);
    assert.equal(dataset.name, `${file.path} · South`); assert.equal(dataset.rowCount, 1);
    assert.equal(imported.workspace.shareSchema, false); assert.equal(imported.workspace.shareResults, false);
    assert.deepEqual(imported.workspace.views, baseline.workspace.views);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const title = 'Authored South sheet'; const sql = `SELECT amount FROM "${dataset.table}"`;
    await page.getByRole('button', { name: 'Add panel', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'panel', exact: true });
    await dialog.getByLabel('Title', { exact: true }).fill(title); await dialog.locator('select').first().selectOption('table');
    await dialog.locator('select[multiple]').selectOption([dataset.id]); await dialog.getByLabel('Read-only SQL', { exact: true }).fill(sql);
    await dialog.getByRole('button', { name: 'Run & add panel', exact: true }).click(); await expect(dialog).toBeHidden({ timeout: 30000 });
    await page.getByRole('button', { name: `Inspect ${title}`, exact: true }).click(); dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog.locator('.data-preview tbody td')).toHaveText(['9']);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await reloadPage(page, context, 'workbook-reload'); await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({ timeout: 60000 }); await persistReady(page, 1);
    const restored = await snapshot(page, result, 'chosen-sheet-reload'); assert.deepEqual(restored.files, imported.files);
    assert.deepEqual(restored.workspace.datasets, imported.workspace.datasets);
    await page.getByRole('button', { name: `Inspect ${title}`, exact: true }).click(); dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog.locator('.data-preview tbody td')).toHaveText(['9'], { timeout: 45000 });
    await page.screenshot({ path: path.join(PROOF, 'workbook.png'), fullPage: false });
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    // Explicit missing-metadata fault control; this is not a normal persistence step.
    await page.evaluate(() => localStorage.removeItem('sift.workspace.v1'));
    await reloadPage(page, context, 'missing-metadata-reload'); await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({ timeout: 60000 }); await persistReady(page, 1);
    const withoutMetadata = await snapshot(page, result, 'injected-missing-workspace-metadata');
    assert.deepEqual(withoutMetadata.files, imported.files);
    assert.equal(withoutMetadata.workspace.shareSchema, false); assert.equal(withoutMetadata.workspace.shareResults, false);
    assert.equal(withoutMetadata.workspace.datasets.find((item) => item.id === dataset.id).name, `${file.path} · South`);
    result.workbook = { bytes: file.bytes, sha256: file.sha256, sheets: ['North', 'South'], selected: 'South', unselectedControlAmount: 99, actualSouthAmount: '9', sql };
    result.checks = { realFileChooser: true, importGatedUntilSheetInspection: true, twoNativeSheetsObserved: true, selectedSouthImported: true, localSQLReturns9Not99: true, chosenSheetAndBytesPersistAfterReload: true, injectedMissingMetadataKeepsSharingOffAndFileIntact: true };
  } finally { await closeContext(context, result); }
}
try {
  for (const [id, title, action] of [
    ['L01', 'desktop explicit folder subset persists and queries with real DuckDB', (result) => ordinary('desktop', result)],
    ['L02', 'narrow touch explicit folder subset persists and queries with real DuckDB', (result) => ordinary('narrow', result)],
    ['L03', 'native IndexedDB completion before Stop preserves the committed file and retries only the queue', commitRace],
    ['L04', 'actual XLSX sheet selection imports South and restores its chosen sheet after reload', workbook],
  ]) {
    const result = { id, title, status: 'running' }; report.cases.push(result);
    try {
      await action(result);
      assert.deepEqual(result.boundary.violations, []); assert.deepEqual(result.boundary.failures, []); assert.deepEqual(result.boundary.console, []);
      assert.ok(result.boundary.sessionResponses.length >= 1 && result.boundary.sessionResponses.every((status) => status === 503));
      assert.ok(result.boundary.sessionRequests.length >= 1 && result.boundary.sessionRequests.every((row) => row.status === 503 && row.finishedResolvedNull && row.requestFinishedAt !== null && row.failedAt === null && row.completionError === null && row.responseTimeoutAt === null && row.checkpointTimeoutAt === null));
      assert.ok(result.boundary.sessionCheckpoints.every((checkpoint) => checkpoint.completed));
      assert.ok(result.boundary.expectedSessionConsole <= result.boundary.sessionResponses.length);
      assert.equal(result.boundary.pagesCreated, 1); assert.equal(result.boundary.websockets, 0);
      assert.ok(result.cleanup.contextClosed && result.cleanup.pageClosed && result.cleanup.sessionsCompletedBeforeClose); result.status = 'passed';
    } catch (error) { result.status = 'failed'; result.error = String(error.stack ?? error).slice(0, 12000); }
    await writeFile(path.join(PROOF, 'browser.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
} finally {
  for (const context of live) await closeContext(context, sessionControls.get(context).result).catch(() => globalFailures.push('unclosed_context'));
  browserClosing = true; await browser.close();
  report.fixtureUnchanged = await verifyFixture(fixtures) && await verifyFixture(raceFixture);
  report.globalFailures = globalFailures;
  report.passed = report.cases.length === 4 && report.cases.every((result) => result.status === 'passed') && globalFailures.length === 0 && report.fixtureUnchanged;
  await writeFile(path.join(PROOF, 'browser.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
