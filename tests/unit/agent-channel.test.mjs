// T2: real native route inventory and auth errors; actual Sift HMAC and policy.
// Request objects are authored. Allowed requests stop at app policy, not a live
// Eve workflow, model or database. The grant-wrapper fixture stubs dispatch only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as channelApi from 'eve/channels';
import * as eveApi from 'eve/channels/eve';
import * as authApi from 'eve/channels/auth';
import { z } from 'zod';
import { loadTypescript } from '../support/load-typescript.mjs';

const env = { SIFT_SESSION_SECRET: 'authored-test-secret-with-more-than-32-characters', NODE_ENV: 'production' };
const auth = loadTypescript('lib/auth.ts', { 'node:crypto': crypto }, { process: { env } });
const imports = { 'eve/channels/eve': eveApi, 'eve/channels': channelApi, 'eve/channels/auth': authApi, zod: { z }, '../../lib/auth': auth };
const policy = loadTypescript('agent/channels/eve.ts', imports);
const origin = 'https://sift.example'; const sessionId = 'authored-owned-session';
const identity = auth.createBrowserIdentity();
const reference = new Request(origin);
const identityCookie = auth.browserIdentityCookie(reference, identity).split(';')[0];
const grantCookie = auth.agentSessionGrantCookie(reference, identity, sessionId).split(';')[0];
function request(path, body, { method = 'POST', cookie = `${identityCookie}; ${grantCookie}`, headers = {} } = {}) {
  return new Request(`${origin}${path}`, { method, headers: { cookie, origin, ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
const owned = suffix => `/eve/v1/session/${sessionId}${suffix}`;
const denied = request => assert.rejects(policy.browserAuth(request), error => error instanceof authApi.ForbiddenError || error instanceof authApi.UnauthenticatedError);

test('native message, answer and inbox envelopes preserve principal and session ownership', async () => {
  for (const body of [{ message: 'Authored question', clientContext: { shareSchema: false } }, { message: 'Authored continuation', inbox: 'authored-opaque-inbox', turnPolicy: 'queue' }, { answers: [{ interactionId: 'authored-interaction', optionId: 'approve' }], inbox: 'authored-opaque-inbox' }, { answers: [{ interactionId: 'authored-interaction', text: 'Authored answer' }] }]) {
    const result = await policy.browserAuth(request(owned(''), body)); assert.equal(result.principalId, identity.principalId);
  }
});
test('owner-only controls accept native nullable cancellation and end semantics', async () => {
  for (const [suffix, body] of [['/cancel', { turnId: null }], ['/cancel', { turnId: 'authored-turn' }], ['/compact', {}], ['/clear', {}], ['/end', { reason: 'Authored retirement' }]]) await policy.browserAuth(request(owned(suffix), body));
  await policy.browserAuth(request(owned('/stream'), undefined, { method: 'GET' }));
});
test('foreign, missing and tampered grants and cross-origin requests fail closed', async () => {
  await denied(request(owned(''), { message: 'Authored question' }, { cookie: identityCookie }));
  await denied(request('/eve/v1/session/foreign-session', { message: 'Authored question' }));
  await denied(request(owned(''), { message: 'Authored question' }, { cookie: `${identityCookie}; ${grantCookie}tampered` }));
  await denied(request(owned(''), { message: 'Authored question' }, { cookie: grantCookie }));
  await denied(request(owned(''), { message: 'Authored question' }, { headers: { origin: 'https://foreign.example' } }));
  await denied(request(owned(''), { message: 'Authored question' }, { headers: { 'sec-fetch-site': 'cross-site' } }));
});
test('files, legacy inputResponses, unsupported fields and ambiguous answers are refused', async () => {
  for (const body of [{ message: [{ type: 'file', url: 'https://authored.example/private.csv' }] }, { inputResponses: [{ requestId: 'old', optionId: 'approve' }] }, { answers: [{ interactionId: 'authored', optionId: 'yes', text: 'both' }] }, { answers: [{ interactionId: 'authored' }] }, { message: 'Authored question', answers: [{ interactionId: 'authored', text: 'both' }] }, { message: 'Authored question', outputSchema: {} }, { message: 'Authored question', inbox: 42 }]) await denied(request(owned(''), body));
});
test('body and field limits hold for actual bytes, malformed JSON and length headers', async () => {
  for (const body of ['{', { message: 'x'.repeat(12_001) }, { answers: Array.from({ length: 13 }, () => ({ interactionId: 'i', optionId: 'yes' })) }, { message: 'x', clientContext: { oversized: 'é'.repeat(50_001) } }, { message: 'x', inbox: 'x'.repeat(12_001) }]) await denied(request(owned(''), body));
  await denied(request(owned(''), { message: 'x' }, { headers: { 'content-length': '100001' } }));
});
test('native route filtering exposes only the bounded owned HTTP surface', async () => {
  const channel = policy.default;
  assert(channel.routes.some(route => route.path === '/eve/v1/session/:sessionId/end' && route.method === 'POST'));
  assert(channel.routes.some(route => route.path === '/eve/v1/session/:sessionId/stream' && route.method === 'GET'));
  assert(channel.routes.every(route => route.transport !== 'websocket'));
  for (const path of ['/eve/v1/agent', '/eve/v1/session/:sessionId/records', '/eve/v1/session/:sessionId/reset', '/eve/v1/session/:sessionId/files', '/other/eve/v1/session']) {
    assert.equal(policy.isRequiredRoute({ path, method: 'POST', transport: 'http' }), false); await denied(request(path.replace(':sessionId', sessionId), {}));
  }
  const listing = channel.routes.find(route => route.path === '/eve/v1/session' && route.method === 'GET');
  assert.equal((await listing.handler(new Request(`${origin}/eve/v1/session`), {})).status, 403);
});
test('grant cookies remain HttpOnly, Secure, path scoped and expire within 24 hours', () => {
  const cookie = auth.agentSessionGrantCookie(reference, identity, sessionId);
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, new RegExp(`Path=/eve/v1/session/${sessionId};`));
  assert(Number(cookie.match(/Max-Age=(\d+)/)[1]) <= 86400);
});
test('production without the signing secret remains unavailable', async () => {
  const noSecret = loadTypescript('lib/auth.ts', { 'node:crypto': crypto }, { process: { env: { NODE_ENV: 'production', VERCEL: '1' } } });
  const route = loadTypescript('app/api/session/route.ts', { '../../../lib/auth': noSecret });
  assert.equal((await route.POST(new Request(origin))).status, 503);
});
test('the create wrapper binds only successful session IDs from its handler', async () => {
  for (const [status, payload, expected] of [[200, { sessionId }, true], [500, { error: 'authored failure' }, false], [200, {}, false]]) {
    const stub = loadTypescript('agent/channels/eve.ts', { ...imports, 'eve/channels/eve': { ...eveApi, eveChannel: () => ({ routes: [{ method: 'POST', transport: 'http', path: '/eve/v1/session', handler: async () => Response.json(payload, { status }) }] }) } });
    const response = await stub.default.routes[0].handler(request('/eve/v1/session', { message: 'Authored create' }), {});
    assert.equal(Boolean(response.headers.get('set-cookie')), expected);
    if (status === 200 && !expected) assert.equal(response.status, 500);
  }
});
test('the authored onMessage boundary strips schemas and results unless each setting opts in', () => {
  let config;
  loadTypescript('agent/channels/eve.ts', { ...imports, 'eve/channels/eve': { ...eveApi, eveChannel(value) { config = value; return eveApi.eveChannel(value); } } });
  for (const shareSchema of [false, true]) for (const shareResults of [false, true]) {
    const result = config.onMessage({ eve: { caller: { principalId: identity.principalId }, clientContext: { shareSchema, shareResults, datasets: ['authored-schema'], metrics: ['authored-metric'], results: ['authored-result'], activeView: 'Authored view' } } });
    assert.equal(result.auth.principalId, identity.principalId);
    assert.equal('datasets' in result.clientContext, shareSchema); assert.equal('metrics' in result.clientContext, shareSchema);
    assert.equal('results' in result.clientContext, shareResults);
  }
  assert.equal(config.uploadPolicy, 'disabled');
});
