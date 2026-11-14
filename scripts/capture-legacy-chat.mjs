// Capture an authored cache with the installed pre-upgrade SDK. Never attach transport.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

globalThis.fetch = () => { throw new Error('Network is forbidden for this fixture.'); };
const version = JSON.parse(readFileSync('node_modules/eve/package.json', 'utf8')).version;
assert.equal(version, '0.81.1');
const { EveAgentStore, defaultMessageReducer } = await import('eve/client');
const turnId = 'authored-turn';
const plan = { name: 'Authored sample', panels: [{ title: 'Sample total', type: 'table', sql: 'SELECT 1 AS total', datasetIds: ['demo'] }] };
const step = { sequence: 1, stepIndex: 0, turnId };
const records = [
  ['session.started', {}],
  ['turn.started', { sequence: 1, turnId }],
  ['message.received', { sequence: 1, turnId, message: 'Show an authored sample total.' }],
  ['step.started', { ...step, modelId: 'authored-no-provider' }],
  ['actions.requested', { ...step, actions: [{ kind: 'tool-call', callId: 'authored-call', toolName: 'create_view', input: {} }] }],
  ['action.result', { ...step, status: 'completed', result: { kind: 'tool-result', callId: 'authored-call', toolName: 'create_view', output: plan } }],
  ['message.completed', { ...step, message: 'An authored view is ready.', finishReason: 'stop' }],
  ['step.completed', { ...step, finishReason: 'stop', usage: { inputTokens: 12, outputTokens: 8 } }],
  ['turn.completed', { sequence: 1, turnId }],
  ['session.waiting', { continuationToken: 'authored-session', wait: 'next-user-message' }],
].map(([type, data], index) => ({ type, data, meta: { at: '2026-11-14T00:00:00.000Z', id: `authored-${String(index).padStart(3, '0')}` } }));
const store = new EveAgentStore({ initialSession: { sessionId: 'authored-session', streamIndex: records.length }, initialEvents: records, reducer: defaultMessageReducer(), followIdle: false });
const snapshot = store.snapshot;
assert.equal(snapshot.status, 'ready');
assert(snapshot.data.messages.some(message => message.parts.some(part => part.type === 'dynamic-tool' && part.toolCallId === 'authored-call' && part.state === 'output-available')));
const raw = JSON.stringify({ session: snapshot.session, events: snapshot.events });
writeFileSync('scripts/fixtures/legacy-chat.json', `${raw}\n`);
console.log(JSON.stringify({ fixture: 'scripts/fixtures/legacy-chat.json', eve: version, bytes: Buffer.byteLength(raw) + 1, sha256: createHash('sha256').update(`${raw}\n`).digest('hex'), eventCount: snapshot.events.length, messageCount: snapshot.data.messages.length, transportAttached: false, network: false }));
