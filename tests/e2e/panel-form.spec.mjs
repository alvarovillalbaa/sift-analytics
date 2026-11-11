// T2: production React, native DuckDB queries and private browser storage.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { guardRoot, sha } from '../support/fixtures.mjs';

const ROOT = process.env.SIFT_IMPORT_RUN_ROOT;
const PROOF = process.env.SIFT_IMPORT_PROOF_DIR;
const TOOLS = process.env.SIFT_IMPORT_PLAYWRIGHT_DIR;
const SOURCE = process.env.SOURCE_COMMIT;
const ORIGIN = 'http://127.0.0.1:4173';
const CANARY = 'SIFT_PANEL_FORM_';
assert.ok(ROOT && PROOF && TOOLS && /^[a-f0-9]{40}$/.test(SOURCE ?? ''));
assert.equal(process.version, 'v24.22.2');
await guardRoot(ROOT, process.env.SIFT_IMPORT_NONCE);
for (const entry of [PROOF, TOOLS]) assert.ok(path.isAbsolute(entry) && path.relative(ROOT, entry) && !path.relative(ROOT, entry).startsWith('..'));
const require = createRequire(path.join(TOOLS, 'package.json'));
const { chromium, expect } = require('playwright/test');
const browser = await chromium.launch({ headless: true, timeout: 30000 });
const report = { schemaVersion: 1, tier: 'T2', scope: 'panel-form', sourceCommit: SOURCE,
  node: process.version, browser: browser.version(), cases: [], passed: false,
  proofLimits: ['Controlled worker/session delivery with real production components and native query values; no timing-frequency claim.',
    'Disposable sample data and loopback signing secret only. No agent/model, PostgreSQL, hosted or physical-device acceptance.'] };
const live = new Set();
const globalFailures = [];
let closing = false;
browser.on('disconnected', () => { if (!closing) globalFailures.push('unexpected_browser_disconnect'); });
process.once('SIGTERM', () => { globalFailures.push('supervisor_deadline'); closing = true; void browser.close(); });

function installGate({ origin, sentinel }) {
  if (location.origin !== origin) return;
  if (localStorage.getItem('sift-form-unrelated') === null) localStorage.setItem('sift-form-unrelated', sentinel);
  const originalPost = Worker.prototype.postMessage;
  const originalTerminate = Worker.prototype.terminate;
  let armed = null; let held = null; let shell = null; let mounts = 0;
  const ledger = [];
  const observeShell = () => {
    const current = document.querySelector('.app-shell');
    if (current && current !== shell) { shell = current; mounts++; }
  };
  new MutationObserver(observeShell).observe(document, { childList: true, subtree: true });
  Worker.prototype.postMessage = function (...args) {
    const message = args[0];
    if (armed && message?.type === 'RUN_QUERY' && Array.isArray(message.data)
      && typeof message.data[1] === 'string' && message.data[1].includes(armed)) {
      if (held || ledger.length >= 4) throw new Error('query_gate_identity_bound');
      const record = { marker: armed, messageId: message.messageId, statement: message.data[1],
        heldAt: performance.now(), releasedAt: null, terminatedAt: null, nativeCalls: 0,
        responseAt: null, responseType: null, responseBytes: null };
      const worker = this;
      const response = (event) => {
        if (event.data?.requestId !== record.messageId || !['QUERY_RESULT', 'ERROR'].includes(event.data.type)) return;
        record.responseAt = performance.now(); record.responseType = event.data.type;
        record.responseBytes = event.data.data?.byteLength ?? null;
        worker.removeEventListener('message', response);
      };
      worker.addEventListener('message', response);
      ledger.push(record); held = { worker, args, record }; armed = null; return;
    }
    return Reflect.apply(originalPost, this, args);
  };
  Worker.prototype.terminate = function (...args) {
    if (held?.worker === this) { held.record.terminatedAt = performance.now(); held = null; }
    return Reflect.apply(originalTerminate, this, args);
  };
  window.__SIFT_PANEL_GATE__ = {
    arm(marker) {
      if (armed || held || !/^SIFT_PANEL_FORM_F0[1-6]_[A-Z]+$/.test(marker)) throw new Error('query_gate_not_idle');
      armed = marker;
    },
    release() {
      if (!held) throw new Error('query_gate_not_held');
      const next = held; held = null; next.record.releasedAt = performance.now();
      next.record.nativeCalls++; return Reflect.apply(originalPost, next.worker, next.args);
    },
    state() { observeShell(); return { armed, held: Boolean(held), mounts, ledger: JSON.parse(JSON.stringify(ledger)) }; },
  };
}

function allowed(request) {
  const url = new URL(request.url());
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash) return false;
  if (request.method() === 'POST') return url.pathname === '/api/session' && !request.postDataBuffer()?.length;
  return ['GET', 'HEAD'].includes(request.method()) && (['/', '/icon.svg', '/favicon.ico', '/duckdb/duckdb-browser-mvp.worker.js', '/duckdb/duckdb-mvp.wasm'].includes(url.pathname)
    || url.pathname.startsWith('/_next/static/') && !url.pathname.includes('..') && !/%2f|%5c/i.test(url.pathname));
}

async function fresh(result, profile = 'desktop', holdSession = false) {
  const context = await browser.newContext({ viewport: profile === 'narrow' ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    isMobile: profile === 'narrow', hasTouch: profile === 'narrow', serviceWorkers: 'block', acceptDownloads: false });
  const state = { context, result, profile, page: null, releaseSession: null, closing: false };
  live.add(state);
  result.profile = profile; result.snapshots = []; result.boundary = { requests: [], violations: [], sessions: [], console: [], pageErrors: [], websockets: 0, pagesCreated: 0 };
  result.cleanup = { contextClosed: false, pageClosed: false, networkDrained: false };
  const boundary = result.boundary; const requests = new Map(); const jobs = new Set();
  const fail = (code) => { if (boundary.violations.length < 30) boundary.violations.push(code); };
  context.on('page', () => { boundary.pagesCreated++; if (boundary.pagesCreated > 1) fail('extra_page'); });
  let sessionHeld = false;
  await context.addInitScript(installGate, { origin: ORIGIN, sentinel: result.id });
  await context.route('**/*', async (route) => {
    const request = route.request();
    try {
      if (!allowed(request)) { fail('request_outside_finite_loopback_policy'); await route.abort(); return; }
      if (new URL(request.url()).pathname !== '/api/session') { await route.continue(); return; }
      const response = await route.fetch({ timeout: 10000, maxRedirects: 0 });
      assert.equal(response.status(), 200);
      const bytes = await response.body(); assert.ok(bytes.length < 4096);
      const body = JSON.parse(bytes); assert.match(body.principalId, /^[a-f0-9-]{36}$/);
      const row = { status: 200, bytes: bytes.length, sha256: sha(bytes), held: false, forwarded: false };
      boundary.sessions.push(row);
      if (holdSession && !sessionHeld) {
        sessionHeld = true; row.held = true;
        await new Promise((resolve) => { state.releaseSession = resolve; });
        state.releaseSession = null;
      }
      await route.fulfill({ response }); row.forwarded = true; await response.dispose();
    } catch (error) {
      fail(`route_error:${String(error.message).slice(0, 300)}`);
      await route.abort().catch(() => {});
    }
  });
  context.on('request', (request) => {
    if (requests.size >= 200) { fail('request_bound'); return; }
    const row = { ordinal: requests.size + 1, method: request.method(), path: new URL(request.url()).pathname,
      status: null, finished: false, failed: false, bodyFinished: false };
    requests.set(request, row); boundary.requests.push(row);
    if (!allowed(request)) fail('unexpected_request');
    if (`${request.url()}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ''}`.includes(CANARY)) fail('authored_sql_network_leak');
  });
  context.on('requestfinished', (request) => { const row = requests.get(request); if (row) row.finished = true; });
  context.on('requestfailed', (request) => { const row = requests.get(request); if (row) row.failed = true; fail('request_failed'); });
  context.on('response', (response) => {
    const row = requests.get(response.request());
    if (!row) { fail('response_without_request'); return; }
    row.status = response.status(); if (row.status !== 200 && row.status !== 304) fail('unsuccessful_response');
    const job = (async () => {
      let timer;
      try {
        const done = await Promise.race([response.finished(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('response_body_deadline')), 10000);
        })]);
        assert.equal(done, null); row.bodyFinished = true;
        if (row.path === '/api/session') row.bodySha256 = sha(await response.body());
      } catch (error) { fail(`response_error:${error.message}`); }
      finally { clearTimeout(timer); }
    })();
    jobs.add(job); void job.finally(() => jobs.delete(job));
  });
  context.on('close', () => { result.cleanup.contextClosed = true; if (!state.closing) fail('unexpected_context_close'); });
  const page = await context.newPage(); state.page = page;
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(45000);
  page.on('pageerror', (error) => { boundary.pageErrors.push(error.message.slice(0, 500)); fail('page_error'); });
  page.on('console', (message) => { if (message.type() === 'error') { boundary.console.push(message.text().slice(0, 1000)); fail('console_error'); } });
  page.on('websocket', () => { boundary.websockets++; fail('websocket'); });
  page.on('crash', () => fail('page_crash'));
  page.on('close', () => { result.cleanup.pageClosed = true; if (!state.closing) fail('unexpected_page_close'); });
  state.drain = async () => {
    await expect.poll(() => requests.size > 0 && [...requests.values()].every((row) => row.finished && row.bodyFinished && !row.failed), { timeout: 12000 }).toBe(true);
    await Promise.all([...jobs]);
    assert.ok(boundary.sessions.length > 0 && boundary.sessions.every((row) => row.forwarded));
    const bodies = boundary.requests.filter((row) => row.path === '/api/session').map((row) => row.bodySha256);
    assert.equal(bodies.length, boundary.sessions.length);
    assert.deepEqual(bodies.sort(), boundary.sessions.map((row) => row.sha256).sort());
  };
  const response = await page.goto(ORIGIN, { waitUntil: 'load' }); assert.equal(response.status(), 200);
  await ready(state);
  if (holdSession) await expect.poll(() => Boolean(state.releaseSession)).toBe(true);
  else await state.drain();
  await frames(page); await ready(state);
  state.baseline = await snapshot(state, 'startup');
  assert.equal(state.baseline.datasets.length, 1); assert.equal(state.baseline.datasets[0].rowCount, 432);
  return state;
}

const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function ready({ page }) {
  await expect(page.getByRole('button', { name: 'Add panel', exact: true })).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({ timeout: 45000 });
}
async function act(state, locator) { if (state.profile === 'narrow') await locator.tap(); else await locator.click(); }
async function workspace(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('sift.workspace.v1');
    if (!raw || raw.length > 256 * 1024) throw new Error('workspace_snapshot_bound');
    return JSON.parse(raw);
  });
}
async function snapshot(state, stage) {
  const value = await workspace(state.page);
  assert.ok(value.views.every((view) => view.panels.every((panel) => !Object.hasOwn(panel, 'result') && !Object.hasOwn(panel, 'error'))));
  assert.equal(await state.page.evaluate(() => localStorage.getItem('sift-form-unrelated')), state.result.id);
  const gate = await state.page.evaluate(() => window.__SIFT_PANEL_GATE__.state());
  state.result.snapshots.push({ stage, workspace: value, gate }); return value;
}
async function persisted(state, predicate) {
  await expect.poll(async () => predicate(await workspace(state.page)), { timeout: 10000 }).toBe(true);
  return workspace(state.page);
}
async function panel(state, title, marker, type = 'table', count = 432) {
  await act(state, state.page.getByRole('button', { name: 'Add panel', exact: true }));
  const dialog = state.page.getByRole('dialog', { name: 'panel', exact: true });
  await expect(dialog).toBeVisible();
  const sql = count === 432 ? `SELECT '${marker}' AS authored_marker, COUNT(*) AS authored_count FROM demo_revenue`
    : `SELECT '${marker}' AS authored_marker, ${count} AS authored_count FROM demo_revenue LIMIT 1`;
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  const visualization = dialog.locator('select:not([multiple])');
  const datasets = dialog.locator('select[multiple]');
  await expect(visualization).toHaveCount(1); await expect(datasets).toHaveCount(1);
  await visualization.selectOption(type);
  await datasets.selectOption(state.baseline.datasets[0].id);
  await dialog.getByLabel('Read-only SQL', { exact: true }).fill(sql);
  return { dialog, sql, title, marker, type, count };
}
async function submit(state, value, hold = false) {
  if (hold) await state.page.evaluate((marker) => window.__SIFT_PANEL_GATE__.arm(marker), value.marker);
  await act(state, value.dialog.getByRole('button', { name: 'Run & add panel', exact: true }));
  if (hold) {
    await expect.poll(() => state.page.evaluate(() => window.__SIFT_PANEL_GATE__.state().held)).toBe(true);
    await expect(value.dialog.getByRole('button', { name: 'Run & add panel', exact: true })).toBeDisabled();
  } else await expect(value.dialog).toBeHidden();
}
async function release(state) {
  await state.page.evaluate(() => window.__SIFT_PANEL_GATE__.release());
  await expect.poll(() => state.page.evaluate(() => window.__SIFT_PANEL_GATE__.state().ledger.at(-1)?.responseType)).toBe('QUERY_RESULT');
  const gate = await state.page.evaluate(() => window.__SIFT_PANEL_GATE__.state());
  assert.equal(gate.held, false); assert.equal(gate.armed, null); assert.equal(gate.ledger.length, 1);
  const row = gate.ledger[0]; assert.equal(row.nativeCalls, 1); assert.ok(row.responseBytes > 0);
  assert.ok(row.releasedAt >= row.heldAt && row.releasedAt - row.heldAt < 8000);
  assert.equal(row.terminatedAt, null); state.result.releasedQuery = row;
  await ready(state);
}
async function closeDialog(state, dialog) { await act(state, dialog.getByRole('button', { name: 'Close dialog', exact: true })); }
async function openNewView(state, name) {
  const create = state.page.getByRole('button', { name: 'Create a view', exact: true });
  if (state.profile === 'narrow' && !(await state.page.getByRole('button', { name: 'Close navigation', exact: true }).isVisible())) {
    await act(state, state.page.getByRole('button', { name: 'Open navigation', exact: true }));
  }
  await act(state, create);
  const dialog = state.page.getByRole('dialog', { name: 'new-view', exact: true });
  await dialog.getByLabel('View name', { exact: true }).fill(name); return dialog;
}
async function saveView(state, dialog, name) {
  await act(state, dialog.getByRole('button', { name: 'Create view', exact: true }));
  await expect(dialog).toBeHidden();
  const close = state.page.getByRole('button', { name: 'Close navigation', exact: true });
  if (await close.isVisible()) await act(state, close);
  await expect(state.page.getByRole('heading', { level: 1 })).toHaveText(`${name}.`);
  return persisted(state, (w) => w.views.some((v) => v.name === name && w.activeViewId === v.id));
}
async function selectView(state, name) {
  const button = state.page.getByRole('navigation', { name: 'Saved views', exact: true }).getByRole('button', { name, exact: true });
  if (state.profile === 'narrow' && !(await state.page.getByRole('button', { name: 'Close navigation', exact: true }).isVisible())) {
    await act(state, state.page.getByRole('button', { name: 'Open navigation', exact: true }));
  }
  await act(state, button); await ready(state);
}
async function inspect(state, value) {
  await expect(state.page.getByRole('article', { name: value.title, exact: true })).toHaveCount(1);
  await act(state, state.page.getByRole('button', { name: `Inspect ${value.title}`, exact: true }));
  const dialog = state.page.getByRole('dialog', { name: value.title, exact: true });
  await expect(dialog.locator('.data-preview thead th')).toHaveText(['authored_marker', 'authored_count']);
  await expect(dialog.locator('.data-preview tbody tr')).toHaveCount(1);
  await expect(dialog.locator('.data-preview tbody td')).toHaveText([value.marker, String(value.count)]);
  assert.match(await dialog.locator('.evidence-meta').textContent(), /1 rows · complete result/);
  await closeDialog(state, dialog);
  const saved = await persisted(state, (w) => w.views.some((v) => v.panels.some((p) => p.title === value.title && p.sql === value.sql && p.type === value.type)));
  assert.equal(saved.views.flatMap((v) => v.panels).filter((p) => p.title === value.title).length, 1);
}
async function screenshot(state) {
  await state.page.screenshot({ path: path.join(PROOF, `panel-form-${state.result.id}.png`), fullPage: true, animations: 'disabled' });
  state.result.screenshot = `panel-form-${state.result.id}.png`;
}
async function reload(state) {
  await state.drain(); await snapshot(state, 'before-reload');
  const response = await state.page.reload({ waitUntil: 'load' }); assert.equal(response.status(), 200);
  await ready(state); await state.drain(); await frames(state.page); await ready(state);
  const value = await snapshot(state, 'after-reload');
  assert.deepEqual(value.metrics, state.baseline.metrics);
  assert.equal(value.shareSchema, state.baseline.shareSchema); assert.equal(value.shareResults, state.baseline.shareResults);
  return value;
}

async function ordinary(result) {
  const state = await fresh(result);
  const value = await panel(state, 'Authored normal panel', 'SIFT_PANEL_FORM_F01_ORDINARY');
  await submit(state, value); await inspect(state, value); await screenshot(state); await reload(state); await inspect(state, value);
}
async function replacementPanel(result) {
  const state = await fresh(result);
  const old = await panel(state, 'Authored submitted panel', 'SIFT_PANEL_FORM_F02_OLD');
  await submit(state, old, true); await closeDialog(state, old.dialog);
  const draft = await panel(state, 'Authored replacement draft', 'SIFT_PANEL_FORM_F02_NEW', 'bar', 7);
  await release(state);
  await expect(draft.dialog).toBeVisible(); await expect(draft.dialog.getByLabel('Title', { exact: true })).toHaveValue(draft.title);
  await expect(draft.dialog.getByLabel('Read-only SQL', { exact: true })).toHaveValue(draft.sql);
  await expect(draft.dialog.locator('select:not([multiple])')).toHaveValue('bar');
  await persisted(state, (w) => w.views.flatMap((v) => v.panels).filter((p) => p.title === old.title).length === 1);
  await snapshot(state, 'replacement-preserved'); await screenshot(state);
  await submit(state, draft); await inspect(state, old); await inspect(state, draft);
  await reload(state); await inspect(state, old); await inspect(state, draft);
}
async function replacementView(result) {
  const state = await fresh(result, 'narrow');
  const old = await panel(state, 'Authored narrow panel', 'SIFT_PANEL_FORM_F03_OLD');
  await submit(state, old, true); await closeDialog(state, old.dialog);
  const name = 'Authored preserved view'; const dialog = await openNewView(state, name);
  await release(state); await expect(dialog).toBeVisible(); await expect(dialog.getByLabel('View name', { exact: true })).toHaveValue(name);
  await snapshot(state, 'view-draft-preserved'); await screenshot(state);
  const value = await saveView(state, dialog, name); const next = value.views.find((v) => v.name === name);
  assert.deepEqual(next.panels, []);
  await selectView(state, state.baseline.views[0].name); await inspect(state, old);
  await reload(state); await inspect(state, old);
  assert.ok((await workspace(state.page)).views.some((v) => v.id === next.id && v.panels.length === 0));
}
async function deletedDestination(result) {
  const state = await fresh(result);
  const survivor = 'Authored surviving view'; await saveView(state, await openNewView(state, survivor), survivor);
  await selectView(state, state.baseline.views[0].name);
  const old = await panel(state, 'Authored deleted destination panel', 'SIFT_PANEL_FORM_F04_OLD');
  await submit(state, old, true); await closeDialog(state, old.dialog);
  await act(state, state.page.getByRole('button', { name: 'Delete current view', exact: true }));
  const draft = await panel(state, 'Authored survivor draft', 'SIFT_PANEL_FORM_F04_NEW');
  await release(state); await expect(draft.dialog).toBeVisible(); await expect(draft.dialog.getByLabel('Title', { exact: true })).toHaveValue(draft.title);
  const value = await snapshot(state, 'deleted-destination-remains-deleted');
  assert.equal(value.views.length, 1); assert.equal(value.views[0].name, survivor); assert.deepEqual(value.views[0].panels, []);
  assert.notEqual(value.views[0].id, state.baseline.activeViewId);
  await screenshot(state); await closeDialog(state, draft.dialog);
  const restored = await reload(state); assert.equal(restored.views.length, 1); assert.deepEqual(restored.views[0].panels, []);
}
async function editedDraft(result) {
  const state = await fresh(result);
  const old = await panel(state, 'Authored original snapshot', 'SIFT_PANEL_FORM_F05_OLD');
  await submit(state, old, true);
  const draft = { ...old, title: 'Authored edited draft', marker: 'SIFT_PANEL_FORM_F05_EDITED', type: 'bar', count: 7 };
  draft.sql = `SELECT '${draft.marker}' AS authored_marker, 7 AS authored_count FROM demo_revenue LIMIT 1`;
  await draft.dialog.getByLabel('Title', { exact: true }).fill(draft.title);
  await draft.dialog.locator('select:not([multiple])').selectOption('bar');
  await draft.dialog.getByLabel('Read-only SQL', { exact: true }).fill(draft.sql);
  await release(state); await expect(draft.dialog).toBeVisible(); await expect(draft.dialog.getByLabel('Title', { exact: true })).toHaveValue(draft.title);
  await expect(draft.dialog.getByLabel('Read-only SQL', { exact: true })).toHaveValue(draft.sql);
  await snapshot(state, 'in-place-edit-preserved'); await screenshot(state);
  await submit(state, draft); await inspect(state, old); await inspect(state, draft);
  await reload(state); await inspect(state, old); await inspect(state, draft);
}
async function remount(result) {
  const state = await fresh(result, 'narrow', true);
  const before = await state.page.evaluate(() => window.__SIFT_PANEL_GATE__.state().mounts);
  const old = await panel(state, 'Authored disposed request', 'SIFT_PANEL_FORM_F06_OLD');
  await submit(state, old, true); assert.ok(state.releaseSession); state.releaseSession();
  await expect.poll(() => state.page.evaluate(() => window.__SIFT_PANEL_GATE__.state().mounts)).toBe(before + 1);
  await expect(old.dialog).toBeHidden(); await ready(state); await state.drain();
  const gate = await state.page.evaluate(() => window.__SIFT_PANEL_GATE__.state());
  assert.equal(gate.held, false); assert.equal(gate.ledger.length, 1);
  const row = gate.ledger[0]; assert.equal(row.nativeCalls, 0); assert.equal(row.releasedAt, null); assert.equal(row.responseAt, null);
  assert.ok(row.terminatedAt >= row.heldAt && row.terminatedAt - row.heldAt < 8000);
  result.remount = { before, after: gate.mounts, cancelledQuery: row };
  const value = await snapshot(state, 'auth-remount');
  assert.deepEqual(value.views, state.baseline.views);
  const cookies = await state.context.cookies();
  assert.ok(cookies.some((cookie) => cookie.name === 'sift_identity' && cookie.httpOnly && cookie.sameSite === 'Strict'));
  const next = await panel(state, 'Authored live lifetime panel', 'SIFT_PANEL_FORM_F06_NEW');
  await submit(state, next); await inspect(state, next); await screenshot(state); await reload(state); await inspect(state, next);
  assert.ok((await workspace(state.page)).views.every((view) => view.panels.every((p) => p.title !== old.title)));
}

async function closeState(state) {
  try {
    if (state.releaseSession) state.releaseSession();
    await state.drain(); state.result.cleanup.networkDrained = true;
  } finally {
    state.closing = true; await state.context.close(); live.delete(state);
  }
}
try {
  for (const [id, title, action] of [
    ['F01', 'normal submit, real aggregate and reload', ordinary],
    ['F02', 'older query preserves replacement panel draft', replacementPanel],
    ['F03', 'narrow touch preserves replacement view draft', replacementView],
    ['F04', 'deleted destination is not recreated', deletedDestination],
    ['F05', 'in-place edits survive submitted snapshot', editedDraft],
    ['F06', 'narrow auth remount disposes old request', remount],
  ]) {
    const result = { id, title, status: 'running' }; report.cases.push(result);
    try { await action(result); result.status = 'passed'; }
    catch (error) {
      result.status = 'failed'; result.error = String(error.stack ?? error).slice(0, 12000);
      const state = [...live].find((value) => value.result === result);
      if (state) await screenshot(state).catch(() => {});
    } finally {
      for (const state of [...live].filter((value) => value.result === result)) {
        try { await closeState(state); }
        catch (error) { result.status = 'failed'; result.cleanup.error = String(error.message).slice(0, 1000); }
      }
    }
    try {
      assert.deepEqual(result.boundary.violations, []); assert.deepEqual(result.boundary.console, []); assert.deepEqual(result.boundary.pageErrors, []);
      assert.equal(result.boundary.websockets, 0);
      assert.equal(result.boundary.pagesCreated, 1);
      assert.ok(result.cleanup.contextClosed && result.cleanup.pageClosed && result.cleanup.networkDrained);
    } catch (error) { result.status = 'failed'; result.boundaryError = String(error.message).slice(0, 2000); }
    await writeFile(path.join(PROOF, 'browser.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
} finally {
  for (const state of live) await closeState(state).catch(() => globalFailures.push('unclosed_context'));
  closing = true; await browser.close(); report.globalFailures = globalFailures;
  report.passed = report.cases.length === 6 && report.cases.every((row) => row.status === 'passed') && globalFailures.length === 0;
  await writeFile(path.join(PROOF, 'browser.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
