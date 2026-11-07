// Anonymous, bounded public HTTP observation. No app imports or credentials.
import assert from 'node:assert/strict';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const ORIGIN = 'https://sift-analytics.vercel.app';
const ROOT = process.env.SIFT_HOSTED_HTTP_DIR;
const NONCE = process.env.SIFT_HOSTED_HTTP_NONCE;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAX_BODY = 1024 * 1024, MAX_CLIENT_BODY = 4 * MAX_BODY, MAX_TOTAL = 8 * MAX_BODY;
assert.equal(process.version, 'v24.22.2');
assert.ok(ROOT && path.isAbsolute(ROOT) && /^[a-f0-9]{32}$/.test(NONCE ?? ''));
const info = await lstat(ROOT), owner = await lstat(path.join(ROOT, '.owner'));
assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o777) === 0o700);
assert.equal(await realpath(ROOT), ROOT);
assert.ok(owner.isFile() && !owner.isSymbolicLink() && owner.uid === process.getuid() && (owner.mode & 0o777) === 0o600);
assert.equal(await readFile(path.join(ROOT, '.owner'), 'utf8'), NONCE);
const file = (name, bytes) => writeFile(path.join(ROOT, name), bytes, { flag: 'wx', mode: 0o600 });

if (process.argv[2] === '--emit') {
  assert.equal(process.argv.length, 3);
  const allowed = /^(source-(?:before|after)\.json|hosted-http\.json|home\.html|matched-client\.js|worker\.js|session-error\.json)$/;
  let total = 0;
  for (const name of (await readdir(ROOT)).sort()) {
    if (name === '.owner') continue;
    assert.ok(allowed.test(name)); const entry = path.join(ROOT, name), stat = await lstat(entry);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() && stat.size <= (name === 'matched-client.js' ? MAX_CLIENT_BODY : 2 * MAX_BODY));
    total += stat.size; assert.ok(total <= MAX_TOTAL);
    const bytes = await readFile(entry), packed = gzipSync(bytes, { level: 9, mtime: 0 }), encoded = packed.toString('base64');
    console.log(`SIFT_HOSTED_HTTP_FILE ${JSON.stringify({ name, bytes: bytes.length, sha256: sha(bytes), gzipBytes: packed.length, chunks: Math.ceil(encoded.length / 3000) })}`);
    for (let offset = 0; offset < encoded.length; offset += 3000) console.log(`SIFT_HOSTED_HTTP_CHUNK ${JSON.stringify({ name, index: offset / 3000, data: encoded.slice(offset, offset + 3000) })}`);
  }
} else {
  assert.equal(process.argv.length, 2);
  assert.ok(/^[a-f0-9]{40}$/.test(process.env.SOURCE_COMMIT ?? ''));
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
  const started = Date.now(), workEnd = started + 150000;
  let observedBytes = 0;
  const report = { schemaVersion: 1, sourceCommit: process.env.SOURCE_COMMIT, origin: ORIGIN, startedAt: new Date(started).toISOString(),
    ownerSuppliedDeploymentContext: { deployment: 'dpl_J5ZPhyWokYaNF9gYzRE13LqH2L3R', source: '3b06822cf61ad5a18c0029004366f000a5f9db7f', independentlyReattestedHere: false },
    limits: { requestMs: 15000, httpWorkMs: 150000, bodyBytes: MAX_BODY, clientBodyBytes: MAX_CLIENT_BODY, totalReceivedBodyBudget: MAX_TOTAL, maximumChunksFetched: 15 },
    requests: [], retainedBodies: [], matchedAsset: null, passed: false, error: null,
    proofLimits: ['Anonymous HTTP only; no hosted browser, IndexedDB/import/query, model or account proof.', 'A matching public bundle proves the reviewed UI strings are served, not byte equivalence of all assets or a deployment-to-Git attestation.', 'Headers are explicitly sanitized JSON only; cookie/auth values are never retained. No cookie jar, Authorization, redirects, retries or protection bypass.', 'Body hashes cover observed HTTP representation bytes. Incomplete prefixes and missing terminal/socket events remain failures. HTTP work uses Connection: close.'] };
  const safeNames = new Set(['content-type', 'content-length', 'content-encoding', 'cache-control', 'date', 'age', 'etag', 'last-modified', 'server', 'x-vercel-cache']);
  function sanitizedHeaders(response) {
    const safe = {}; let sensitiveCount = 0;
    for (let i = 0; i < response.rawHeaders.length; i += 2) {
      const key = response.rawHeaders[i].toLowerCase();
      if (/^(?:set-cookie|cookie|authorization|proxy-authorization|authentication-info|proxy-authentication-info|x-vercel-protection-bypass)$/.test(key)) sensitiveCount++;
    }
    for (const key of safeNames) {
      const value = response.headers[key];
      if (typeof value === 'string' && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value)) safe[key] = value;
    }
    return { label: 'sanitized parsed headers; whitelist only, never raw header values', totalFieldCount: response.rawHeaders.length / 2, sensitiveFieldsWithheld: sensitiveCount, redirectLocationPresent: response.headers.location !== undefined, safe };
  }
  async function request(label, route, method = 'GET', cap = MAX_BODY) {
    assert.ok(Date.now() < workEnd, 'http_work_deadline');
    const url = new URL(route, ORIGIN);
    assert.equal(url.origin, ORIGIN); assert.equal(url.username + url.password + url.search + url.hash, '');
    const row = { label, url: url.href, method, startedAt: new Date().toISOString(), status: null, headers: null, observedBytes: 0,
      bytes: 0, sha256: null, complete: false, responseEnd: false, responseClose: false, responseMessageComplete: false,
      requestClose: false, socketClose: false, error: null, bodyRetained: null };
    report.requests.push(row);
    const bound = Math.min(cap, MAX_TOTAL - observedBytes); assert.ok(bound >= 0);
    return new Promise((resolve) => {
      let response, socket, ended = false, done = false, retained = 0;
      const pieces = [], hash = createHash('sha256');
      const requestDeadline = Math.min(Date.now() + 15000, workEnd);
      const duration = requestDeadline - Date.now(); row.deadlineAt = new Date(requestDeadline).toISOString();
      let activeTimer, hardTimer;
      const finish = () => {
        if (done) return;
        if (!row.error && !(ended && row.responseClose && row.requestClose && row.socketClose)) return;
        if (row.error && !(row.requestClose && (!socket || row.socketClose))) return;
        if (Date.now() >= requestDeadline) row.error ??= 'request_deadline';
        done = true; clearTimeout(activeTimer); clearTimeout(hardTimer);
        const bytes = Buffer.concat(pieces, retained); row.bytes = bytes.length; row.sha256 = sha(bytes);
        row.observedSha256 = hash.digest('hex'); row.complete = !row.error && ended && row.responseMessageComplete && row.responseClose && row.requestClose && row.socketClose;
        row.finishedAt = new Date().toISOString(); resolve({ row, bytes });
      };
      const fail = (code) => { row.error ??= code; response?.destroy(); request.destroy(); socket?.destroy(); finish(); };
      const request = https.request({ protocol: 'https:', hostname: 'sift-analytics.vercel.app', port: 443, path: url.pathname, method,
        agent: false, rejectUnauthorized: true, maxHeaderSize: 32768,
        headers: { Accept: '*/*', 'Accept-Encoding': 'identity', Connection: 'close', 'User-Agent': 'Sift-Anonymous-Release-Check/1' } }, (incoming) => {
        response = incoming; row.status = incoming.statusCode; row.headers = sanitizedHeaders(incoming);
        incoming.on('data', (chunk) => {
          row.observedBytes += chunk.length; observedBytes += chunk.length; hash.update(chunk);
          const keep = Math.min(chunk.length, Math.max(0, bound - retained));
          if (keep) { pieces.push(chunk.subarray(0, keep)); retained += keep; }
          if (row.observedBytes > bound || observedBytes > MAX_TOTAL) fail('body_size_bound');
        });
        incoming.on('end', () => { ended = true; row.responseEnd = true; row.responseMessageComplete = incoming.complete; finish(); });
        incoming.on('close', () => { row.responseClose = true; if (!ended && !row.error) fail('response_closed_before_end'); else finish(); });
        incoming.on('aborted', () => fail('response_aborted'));
        incoming.on('error', (error) => fail(typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'response_error'));
      });
      request.on('socket', (value) => { socket = value; value.on('close', () => { row.socketClose = true; finish(); }); });
      request.on('close', () => { row.requestClose = true; finish(); });
      request.on('error', (error) => fail(typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'request_error'));
      activeTimer = setTimeout(() => fail('request_deadline'), Math.max(1, duration - 500));
      hardTimer = setTimeout(() => {
        if (done) return; row.error ??= 'terminal_close_deadline'; request.destroy(); response?.destroy(); socket?.destroy();
        // A missing close is retained as failure, never invented as a successful terminal.
        row.requestClose ||= request.closed; row.socketClose ||= socket?.closed === true;
        if (!done) {
          done = true; clearTimeout(activeTimer);
          const bytes = Buffer.concat(pieces, retained); row.bytes = bytes.length; row.sha256 = sha(bytes); row.observedSha256 = hash.digest('hex');
          row.finishedAt = new Date().toISOString(); resolve({ row, bytes });
        }
      }, Math.max(1, duration));
      request.end();
    });
  }
  async function retain(name, result) {
    await file(name, result.bytes); result.row.bodyRetained = name;
    report.retainedBodies.push({ name, bytes: result.bytes.length, sha256: sha(result.bytes), complete: result.row.complete });
  }
  function success(result, status, mime) {
    assert.equal(result.row.status, status, `unexpected_${result.row.label}_status`);
    assert.ok(result.row.complete, `incomplete_${result.row.label}`);
    assert.match(result.row.headers.safe['content-type'] ?? '', mime);
    assert.ok(['identity', ''].includes(result.row.headers.safe['content-encoding'] ?? 'identity'), 'unexpected_content_encoding');
  }
  try {
    const home = await request('homepage', '/');
    if (home.row.status === 200) await retain('home.html', home);
    success(home, 200, /^text\/html(?:;|$)/i);
    const html = new TextDecoder('utf-8', { fatal: true }).decode(home.bytes);
    const candidates = [];
    for (const tag of html.matchAll(/<script\b[^>]*>/gi)) {
      const source = /\bsrc\s*=\s*(["'])([^"']+)\1/i.exec(tag[0]); if (!source) continue;
      const url = new URL(source[2], ORIGIN);
      if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || url.pathname.length > 512
        || !['/_next/static/chunks/', '/_next/static/immutable/chunks/'].some(prefix => url.pathname.startsWith(prefix)) || !url.pathname.endsWith('.js') || /%2f|%5c/i.test(url.pathname)
        || url.pathname.split('/').some((part) => part === '.' || part === '..')) continue;
      if (!candidates.includes(url.pathname)) candidates.push(url.pathname);
    }
    assert.ok(candidates.length > 0); report.chunkCandidates = candidates; report.chunksFetched = 0;
    for (const route of candidates.slice(0, 15)) {
      const available = MAX_TOTAL - observedBytes - MAX_BODY - 65536;
      if (available <= 0) break;
      const chunk = await request(`chunk-${report.chunksFetched + 1}`, route, 'GET', Math.min(MAX_CLIENT_BODY, available)); report.chunksFetched++;
      success(chunk, 200, /^(?:application|text)\/(?:javascript|x-javascript|ecmascript)(?:;|$)/i);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(chunk.bytes);
      const strings = ['Choose a folder', 'Import selected', 'Choose a data folder'];
      const offsets = Object.fromEntries(strings.map((value) => [value, text.indexOf(value)])); chunk.row.uiStringOffsets = offsets;
      if (strings.every((value) => offsets[value] >= 0)) {
        await retain('matched-client.js', chunk); report.matchedAsset = { url: chunk.row.url, bytes: chunk.bytes.length, sha256: sha(chunk.bytes), offsets }; break;
      }
    }
    assert.ok(report.matchedAsset, 'reviewed_local_import_strings_not_found_within_bounds');
    const wasm = await request('wasm', '/duckdb/duckdb-mvp.wasm', 'HEAD', 0); success(wasm, 200, /^application\/wasm(?:;|$)/i); assert.equal(wasm.bytes.length, 0);
    const worker = await request('worker', '/duckdb/duckdb-browser-mvp.worker.js'); if (worker.row.status === 200) await retain('worker.js', worker);
    success(worker, 200, /^(?:application|text)\/(?:javascript|x-javascript|ecmascript)(?:;|$)/i);
    const session = await request('session', '/api/session', 'GET', 65536); success(session, 503, /^application\/json(?:;|$)/i);
    let error;
    try { error = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(session.bytes)); }
    catch { throw new Error('invalid_session_json'); }
    assert.ok(error !== null && typeof error === 'object' && !Array.isArray(error)
      && Object.keys(error).length === 1 && Object.hasOwn(error, 'error'), 'unexpected_session_shape');
    assert.ok(error.error === 'The agent session is not configured. Set SIFT_SESSION_SECRET on the server.', 'unexpected_session_error');
    await retain('session-error.json', session);
    assert.ok(Date.now() <= workEnd); report.passed = true;
  } catch (error) { report.error = String(error?.message ?? error).slice(0, 2000); }
  finally {
    report.observedBodyBytes = observedBytes; report.finishedAt = new Date().toISOString();
    await file('hosted-http.json', Buffer.from(`${JSON.stringify(report, null, 2)}\n`));
    console.log(`SIFT_HOSTED_HTTP_RESULT ${JSON.stringify({ passed: report.passed, requests: report.requests.length, error: report.error, matchedAsset: report.matchedAsset })}`);
    process.exitCode = report.passed ? 0 : 1;
  }
}
