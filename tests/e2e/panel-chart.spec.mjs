// T2: actual production React, native DuckDB, rendered chart geometry and private storage.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { guardRoot } from '../support/fixtures.mjs';

const ROOT = process.env.SIFT_IMPORT_RUN_ROOT, PROOF = process.env.SIFT_IMPORT_PROOF_DIR;
const TOOLS = process.env.SIFT_IMPORT_PLAYWRIGHT_DIR, SOURCE = process.env.SOURCE_COMMIT;
const ORIGIN = 'http://127.0.0.1:4173';
assert.ok(ROOT && PROOF && TOOLS && /^[a-f0-9]{40}$/.test(SOURCE ?? ''));
assert.equal(process.version, 'v24.22.2');
await guardRoot(ROOT, process.env.SIFT_IMPORT_NONCE);
for (const value of [PROOF, TOOLS]) assert.ok(path.isAbsolute(value) && path.relative(ROOT, value) && !path.relative(ROOT, value).startsWith('..'));
const require = createRequire(path.join(TOOLS, 'package.json'));
const { chromium, expect } = require('playwright/test');
const browser = await chromium.launch({ headless: true, timeout: 30000 });
const report = { schemaVersion: 1, scope: 'panel-chart', tier: 'T2', sourceCommit: SOURCE,
  node: process.version, browser: browser.version(), cases: [], globalFailures: [], passed: false,
  proofLimits: ['Loopback production build, authored sample SQL and ephemeral session secret; no model/provider/PostgreSQL or hosted acceptance.',
    'Native worker messages are observed and forwarded unchanged, without held delivery or substituted results.',
    'SVG geometry/visible data checks are not pixel-perfect visual, screen-reader or physical-device qualification.'] };
const live = new Set(); let closing = false;
browser.on('disconnected', () => { if (!closing) report.globalFailures.push('unexpected_browser_disconnect'); });
process.once('SIGTERM', () => { report.globalFailures.push('supervisor_deadline'); closing = true; void browser.close(); });

function installObserver() {
  const original = Worker.prototype.postMessage; const ledger = [];
  Worker.prototype.postMessage = function (...args) {
    const message = args[0];
    if (message?.type === 'RUN_QUERY') {
      if (ledger.length >= 100) throw new Error('query_observation_bound');
      const row = { id: message.messageId, sql: message.data?.[1], calls: 1, responseType: null, responseBytes: null };
      ledger.push(row);
      const listener = (event) => {
        if (event.data?.requestId !== row.id || !['QUERY_RESULT', 'ERROR'].includes(event.data.type)) return;
        row.responseType = event.data.type; row.responseBytes = event.data.data?.byteLength ?? null;
        this.removeEventListener('message', listener);
      };
      this.addEventListener('message', listener);
    }
    return Reflect.apply(original, this, args);
  };
  window.__SIFT_CHART_QUERIES__ = () => JSON.parse(JSON.stringify(ledger));
}
function allowed(request) {
  const url = new URL(request.url());
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash) return false;
  if (request.method() === 'POST') return url.pathname === '/api/session' && !request.postDataBuffer()?.length;
  return ['GET', 'HEAD'].includes(request.method()) && (['/', '/icon.svg', '/favicon.ico', '/duckdb/duckdb-browser-mvp.worker.js', '/duckdb/duckdb-mvp.wasm'].includes(url.pathname)
    || url.pathname.startsWith('/_next/static/') && !url.pathname.includes('..') && !/%2f|%5c/i.test(url.pathname));
}
async function fresh(result, profile) {
  const context = await browser.newContext({ viewport: profile === 'narrow' ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    isMobile: profile === 'narrow', hasTouch: profile === 'narrow', serviceWorkers: 'block', acceptDownloads: false });
  const state = { context, result, profile, closing: false, jobs: new Set() }; live.add(state);
  result.profile = profile; result.stages = []; result.geometry = []; result.queries = [];
  result.boundary = { requests: [], violations: [], consoleErrors: [], pageErrors: [], websockets: 0, pages: 0 };
  result.cleanup = { contextClosed: false, pageClosed: false, networkDrained: false, originalStorageRestored: false };
  const boundary = result.boundary, requests = new Map();
  const fail = (code) => { if (boundary.violations.length < 30) boundary.violations.push(code); };
  context.on('page', () => { boundary.pages++; if (boundary.pages > 1) fail('extra_page'); });
  await context.addInitScript(installObserver);
  await context.route('**/*', async route => {
    if (allowed(route.request())) await route.continue();
    else { fail('request_outside_loopback_policy'); await route.abort(); }
  });
  context.on('request', request => {
    if (requests.size >= 200) { fail('request_bound'); return; }
    const row = { method: request.method(), path: new URL(request.url()).pathname, status: null, finished: false, bodyFinished: false, failed: false };
    requests.set(request, row); boundary.requests.push(row);
    if (!allowed(request)) fail('unexpected_request');
    if (`${request.url()}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ''}`.includes('SIFT_CHART_PRIVATE_')) fail('authored_data_network_leak');
  });
  context.on('requestfinished', request => { const row = requests.get(request); if (row) row.finished = true; });
  context.on('requestfailed', request => { const row = requests.get(request); if (row) row.failed = true; fail('request_failed'); });
  context.on('response', response => {
    const row = requests.get(response.request());
    if (!row) { fail('response_without_request'); return; }
    row.status = response.status(); if (![200, 304].includes(row.status)) fail('unsuccessful_response');
    const job = (async () => {
      let timer;
      try {
        assert.equal(await Promise.race([response.finished(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('body_deadline')), 10000); })]), null);
        row.bodyFinished = true;
      } catch { fail('response_body_failed'); }
      finally { clearTimeout(timer); }
    })();
    state.jobs.add(job); void job.finally(() => state.jobs.delete(job));
  });
  state.drain = async () => {
    await expect.poll(() => requests.size > 0 && [...requests.values()].every(row => row.finished && row.bodyFinished && !row.failed), { timeout: 12000 }).toBe(true);
    await Promise.all([...state.jobs]);
    assert.ok(boundary.requests.some(row => row.method === 'POST' && row.path === '/api/session' && row.status === 200));
  };
  context.on('close', () => { result.cleanup.contextClosed = true; if (!state.closing) fail('unexpected_context_close'); });
  const page = await context.newPage(); state.page = page;
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(45000);
  page.on('console', message => { if (message.type() === 'error') boundary.consoleErrors.push(message.text().slice(0, 1000)); });
  page.on('pageerror', error => boundary.pageErrors.push(error.message.slice(0, 1000)));
  page.on('websocket', () => { boundary.websockets++; fail('websocket'); });
  page.on('crash', () => fail('page_crash'));
  page.on('close', () => { result.cleanup.pageClosed = true; if (!state.closing) fail('unexpected_page_close'); });
  assert.equal((await page.goto(ORIGIN, { waitUntil: 'load' })).status(), 200);
  await ready(state); await state.drain(); await ready(state);
  state.baseline = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  assert.equal(JSON.parse(state.baseline['sift.workspace.v1']).datasets[0].rowCount, 432);
  await page.evaluate(id => localStorage.setItem('sift-chart-unrelated', `SIFT_CHART_PRIVATE_${id}`), result.id);
  return state;
}
async function ready({ page }) { await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({ timeout: 45000 }); }
async function activate(state, locator) { if (state.profile === 'narrow') await locator.tap(); else await locator.click(); }
async function closeDialog(state, dialog) { await activate(state, dialog.getByRole('button', { name: 'Close dialog', exact: true })); }
async function newView(state) {
  if (state.profile === 'narrow') await activate(state, state.page.getByRole('button', { name: 'Open navigation', exact: true }));
  await activate(state, state.page.getByRole('button', { name: 'Create a view', exact: true }));
  const dialog = state.page.getByRole('dialog', { name: 'new-view', exact: true });
  await dialog.getByLabel('View name', { exact: true }).fill(`Authored chart ${state.result.id}`);
  await activate(state, dialog.getByRole('button', { name: 'Create view', exact: true })); await expect(dialog).toBeHidden();
  const close = state.page.getByRole('button', { name: 'Close navigation', exact: true });
  if (await close.isVisible()) await activate(state, close);
}
async function add(state, type, sql, suffix = type) {
  const title = `Authored ${state.result.id} ${suffix}`;
  await activate(state, state.page.getByRole('button', { name: 'Add panel', exact: true }));
  const dialog = state.page.getByRole('dialog', { name: 'panel', exact: true });
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.locator('select:not([multiple])').selectOption(type);
  await dialog.locator('select[multiple]').selectOption('demo-revenue');
  await dialog.getByLabel('Read-only SQL', { exact: true }).fill(sql);
  await activate(state, dialog.getByRole('button', { name: 'Run & add panel', exact: true }));
  await expect(dialog).toBeHidden(); await ready(state);
  return { title, type, sql, card: state.page.getByRole('article', { name: title, exact: true }) };
}
async function inspect(state, value, cells) {
  await activate(state, value.card.getByRole('button', { name: `Inspect ${value.title}`, exact: true }));
  const dialog = state.page.getByRole('dialog', { name: value.title, exact: true });
  await expect(dialog.locator('.sql-block')).toHaveText(value.sql);
  await expect(dialog.locator('.data-preview tbody td')).toHaveText(cells);
  await expect(dialog.locator('.evidence-meta')).toContainText('complete result');
  assert.ok((await dialog.locator('.evidence-meta').textContent()).includes('SaaS revenue'));
  await closeDialog(state, dialog);
}
async function saved(state, stage) {
  const workspace = await state.page.evaluate(() => JSON.parse(localStorage.getItem('sift.workspace.v1')));
  assert.ok(workspace.views.every(view => view.panels.every(panel => !Object.hasOwn(panel, 'result') && !Object.hasOwn(panel, 'error'))));
  const baseline = JSON.parse(state.baseline['sift.workspace.v1']);
  assert.deepEqual(workspace.datasets, baseline.datasets); assert.deepEqual(workspace.metrics, baseline.metrics);
  assert.deepEqual(workspace.views.find(view => view.id === 'overview'), baseline.views.find(view => view.id === 'overview'));
  assert.equal(workspace.shareSchema, baseline.shareSchema); assert.equal(workspace.shareResults, baseline.shareResults);
  assert.equal(await state.page.evaluate(() => localStorage.getItem('sift-chart-unrelated')), `SIFT_CHART_PRIVATE_${state.result.id}`);
  state.result.stages.push({ stage, workspace }); return workspace;
}
async function geometry(state, value, stage) {
  const selectors = { bar: 'path.recharts-rectangle', line: 'path.recharts-line-curve', area: 'path.recharts-area-area', donut: 'path.recharts-sector' };
  const image = value.card.locator('.panel-chart[role="img"]'); await expect(image).toBeVisible();
  const selector = selectors[value.type];
  let previous = '', stableSince = 0, latest;
  await expect.poll(async () => {
    latest = await image.evaluate((element, shape) => ({ label: element.getAttribute('aria-label'),
      box: { width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
        left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, viewport: innerWidth },
      ticks: [...element.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick-value')].map(node => node.textContent),
      shapes: [...element.querySelectorAll(shape)].map(node => {
        const box = node.getBBox(); return { d: node.getAttribute('d'), x: box.x, y: box.y, width: box.width, height: box.height };
      }) }), selector);
    const count = ['bar', 'donut'].includes(value.type) ? 3 : 1;
    if (latest.box.width <= 100 || latest.box.height <= 80 || latest.shapes.length !== count
      || latest.shapes.some(shape => !shape.d || /NaN|Infinity/.test(shape.d) || ![shape.x, shape.y, shape.width, shape.height].every(Number.isFinite) || shape.width <= 0 || shape.height <= 0)) return false;
    const key = JSON.stringify(latest);
    if (key !== previous) { previous = key; stableSince = performance.now(); }
    return performance.now() - stableSince >= 300;
  }, { timeout: 8000, intervals: [50, 100] }).toBe(true);
  if (value.type !== 'donut') { assert.ok(latest.ticks.length > 0); assert.ok(latest.ticks.every(tick => ['Starter', 'Growth', 'Enterprise'].includes(tick))); }
  assert.ok(latest.box.left >= -1 && latest.box.right <= latest.box.viewport + 1, 'The chart must fit the current horizontal viewport');
  if (value.type === 'bar') {
    const heights = latest.shapes.map(shape => shape.height);
    assert.ok(Math.abs(heights[1] / heights[0] - 2) < 0.02 && Math.abs(heights[2] / heights[0] - 3) < 0.02, 'Bar geometry must preserve the native 1:2:3 values');
  }
  if (value.type === 'donut') {
    await expect(value.card.locator('.donut-legend strong')).toHaveText(['12.5', '25', '37.5']);
    await expect(value.card.locator('.donut-center strong')).toHaveText('3');
  }
  state.result.geometry.push({ stage, title: value.title, ...latest }); return latest;
}
const SQL = "SELECT plan AS category, CAST(CASE plan WHEN 'Starter' THEN 12.5 WHEN 'Growth' THEN 25.0 ELSE 37.5 END AS DOUBLE) AS amount FROM demo_revenue GROUP BY plan ORDER BY amount";
const CELLS = ['Starter', '12.5', 'Growth', '25', 'Enterprise', '37.5'];
async function verifyFamily(state, values, stage) {
  for (const value of values) {
    await expect(value.card).toHaveAttribute('aria-busy', 'false');
    if (value.type === 'table') await expect(value.card.locator('tbody td')).toHaveText(CELLS);
    else if (value.type === 'metric') await expect(value.card.locator('.metric-value')).toHaveText('75');
    else await geometry(state, value, stage);
    await inspect(state, value, value.type === 'metric' ? ['75'] : CELLS);
  }
  await saved(state, stage);
}
async function capture(state) {
  const name = `panel-chart-${state.result.id}.png`;
  await state.page.screenshot({ path: path.join(PROOF, name), fullPage: true, animations: 'disabled' }); state.result.screenshot = name;
}
async function reload(state) {
  await state.drain(); await saved(state, 'before-reload');
  state.result.queries.push({ phase: 'before-reload', rows: await state.page.evaluate(() => window.__SIFT_CHART_QUERIES__()) });
  assert.equal((await state.page.reload({ waitUntil: 'load' })).status(), 200);
  await ready(state); await state.drain(); await ready(state);
}
async function family(result, profile) {
  const state = await fresh(result, profile); await newView(state); const values = [];
  for (const type of ['table', 'metric', 'bar', 'line', 'area', 'donut']) values.push(await add(state, type,
    type === 'metric' ? 'SELECT CAST(75.0 AS DOUBLE) AS amount FROM demo_revenue LIMIT 1' : SQL));
  await verifyFamily(state, values, 'first-render');
  await activate(state, state.page.getByRole('button', { name: 'Refresh', exact: true })); await ready(state);
  await verifyFamily(state, values, 'refresh'); await reload(state); await verifyFamily(state, values, 'reload');
  await capture(state);
}
async function precision(result) {
  const state = await fresh(result, 'desktop'); await newView(state);
  const exact = "SELECT 'SIFT_CHART_PRIVATE_exact' AS category, CAST('9007199254740993' AS BIGINT) AS amount FROM demo_revenue LIMIT 1";
  const table = await add(state, 'table', exact, 'exact-table');
  await expect(table.card.locator('tbody td')).toHaveText(['SIFT_CHART_PRIVATE_exact', '9,007,199,254,740,993']);
  await inspect(state, table, ['SIFT_CHART_PRIVATE_exact', '9007199254740993']);
  const unsafe = await add(state, 'bar', exact, 'exact-chart');
  await expect(unsafe.card).toContainText('These values exceed chart precision'); await expect(unsafe.card.locator('.panel-chart')).toHaveCount(0);
  await inspect(state, unsafe, ['SIFT_CHART_PRIVATE_exact', '9007199254740993']);
  const textSql = "SELECT plan AS category, CAST('0012' AS VARCHAR) AS amount FROM demo_revenue LIMIT 1";
  const text = await add(state, 'line', textSql, 'text-measure');
  await expect(text.card).toContainText('This chart needs a numeric column'); await expect(text.card.locator('.panel-chart')).toHaveCount(0);
  const textTable = await add(state, 'table', textSql, 'text-table');
  await expect(textTable.card.locator('tbody td').nth(1)).toHaveText('0012');
  await reload(state);
  await expect(unsafe.card).toContainText('These values exceed chart precision'); await expect(text.card).toContainText('This chart needs a numeric column');
  await expect(table.card.locator('tbody td').nth(1)).toHaveText('9,007,199,254,740,993');
  await expect(textTable.card.locator('tbody td').nth(1)).toHaveText('0012'); await capture(state);
}
async function empty(result) {
  const state = await fresh(result, 'narrow'); await newView(state);
  const blank = await add(state, 'bar', 'SELECT plan AS category, revenue AS amount FROM demo_revenue WHERE 1 = 0', 'empty');
  await expect(blank.card).toContainText('No matching data'); await expect(blank.card.locator('.panel-chart')).toHaveCount(0);
  await inspect(state, blank, []); await reload(state); await expect(blank.card).toContainText('No matching data');
  const value = await add(state, 'bar', SQL, 'recovered'); await geometry(state, value, 'recovery'); await inspect(state, value, CELLS);
  await activate(state, blank.card.getByRole('button', { name: `Remove ${blank.title}`, exact: true })); await expect(blank.card).toHaveCount(0);
  await activate(state, state.page.getByRole('button', { name: 'Refresh', exact: true })); await ready(state);
  await geometry(state, value, 'refresh'); await reload(state); await expect(blank.card).toHaveCount(0);
  await geometry(state, value, 'reload'); await inspect(state, value, CELLS); await capture(state);
}
async function dispose(state) {
  try {
    await state.drain(); state.result.cleanup.networkDrained = true;
    state.result.queries.push({ phase: 'final', rows: await state.page.evaluate(() => window.__SIFT_CHART_QUERIES__()) });
    for (const phase of state.result.queries) {
      assert.ok(phase.rows.length > 0);
      assert.ok(phase.rows.every(row => row.calls === 1 && row.responseType === 'QUERY_RESULT' && row.responseBytes > 0));
    }
    if (state.baseline) {
      const restored = await state.page.evaluate(baseline => { localStorage.clear(); for (const [key, value] of Object.entries(baseline)) localStorage.setItem(key, value); return Object.fromEntries(Object.entries(localStorage)); }, state.baseline);
      assert.deepEqual(restored, state.baseline); state.result.cleanup.originalStorageRestored = true;
    }
  } finally { state.closing = true; await state.context.close(); live.delete(state); }
}
try {
  for (const [id, title, action] of [
    ['C01', 'desktop six native renderers, refresh and reload', result => family(result, 'desktop')],
    ['C02', 'narrow touch six native renderers, refresh and reload', result => family(result, 'narrow')],
    ['C03', 'exact integer and text-measure refusals preserve raw data', precision],
    ['C04', 'narrow empty result and later chart recovery survive reload', empty],
  ]) {
    const result = { id, title, status: 'running' }; report.cases.push(result);
    try { await action(result); result.status = 'passed'; }
    catch (error) { result.status = 'failed'; result.error = String(error.stack ?? error).slice(0, 12000); const state = [...live].find(value => value.result === result); if (state) await capture(state).catch(() => {}); }
    finally { for (const state of [...live].filter(value => value.result === result)) { try { await dispose(state); } catch (error) { result.status = 'failed'; result.cleanup.error = String(error.stack ?? error).slice(0, 2000); } } }
    try {
      assert.deepEqual(result.boundary.violations, []); assert.deepEqual(result.boundary.consoleErrors, []); assert.deepEqual(result.boundary.pageErrors, []);
      assert.equal(result.boundary.websockets, 0); assert.equal(result.boundary.pages, 1);
      assert.ok(Object.values(result.cleanup).every(value => value === true));
    } catch (error) { result.status = 'failed'; result.boundaryError = String(error.stack ?? error).slice(0, 2000); }
    await writeFile(path.join(PROOF, 'browser.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
} finally {
  for (const state of live) await dispose(state).catch(() => report.globalFailures.push('unclosed_context'));
  closing = true; await browser.close();
  report.passed = report.cases.length === 4 && report.cases.every(row => row.status === 'passed') && report.globalFailures.length === 0;
  await writeFile(path.join(PROOF, 'browser.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
