// T2: actual persistence helper, actual installed native SDK converter/fold,
// authored localStorage double. No DOM, transport, model or user data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as events from 'eve/events';
import * as legacy from 'eve/internal/legacy-events';
import { loadTypescript, memoryStorage } from '../support/load-typescript.mjs';

const { createChatArchive, planReceipt } = loadTypescript('lib/chat-archive.ts', { 'eve/events': events, 'eve/internal/legacy-events': legacy });
const raw = readFileSync(new URL('../../scripts/fixtures/legacy-chat.json', import.meta.url), 'utf8').trim();
const old = JSON.parse(raw);
const converted = legacy.convertLegacyEvents(old.events);
const snapshot = { session: { ...old.session, inbox: 'authored-opaque-inbox' }, events: converted };
const native = () => JSON.stringify({ version: 2, ...snapshot });
const wire = value => JSON.parse(JSON.stringify(value));

test('actual 0.81.1 captured cache converts with native 0.88.1 metadata and cursor intact', () => {
  const storage = memoryStorage({ 'sift-chat': raw });
  const cache = createChatArchive(storage);
  assert.equal(cache.warning, '');
  assert.deepEqual(wire(cache.initial.events), converted);
  assert.deepEqual(wire(cache.initial.session), old.session);
  assert.equal(cache.legacyReceiptSessionId(), old.session.sessionId);
  assert.equal(storage.getItem('sift-chat'), raw, 'Reading is not a write');
  assert.equal(events.activeTurn(events.foldEvents(events.emptySessionView(), cache.initial.events)), undefined);
});
test('first native save keeps exact old bytes, opaque session state and scoped legacy receipt', () => {
  const storage = memoryStorage({ 'sift-chat': raw });
  const cache = createChatArchive(storage); cache.save(snapshot);
  assert.equal(storage.getItem('sift-chat-before-v27'), raw);
  const saved = JSON.parse(storage.getItem('sift-chat'));
  assert.equal(saved.version, 2); assert.equal(saved.session.inbox, 'authored-opaque-inbox');
  assert.equal(saved.session.streamIndex, old.session.streamIndex);
  assert.deepEqual(saved.events, converted);
  const restored = createChatArchive(storage);
  assert.equal(restored.warning, ''); assert.equal(restored.legacyReceiptSessionId(), old.session.sessionId);
});
test('bad, unknown, mixed-session and missing-prefix caches stay recoverable without replacement', () => {
  for (const damaged of ['{', JSON.stringify({ version: 9, ...old }), JSON.stringify({ ...old, events: [...old.events, old.events[0]] }), JSON.stringify({ ...old, events: old.events.slice(1) }), JSON.stringify({ ...old, session: { sessionId: '../other', streamIndex: 1 } }), JSON.stringify({ version: 2, ...snapshot, events: [...converted].reverse() })]) {
    const storage = memoryStorage({ 'sift-chat': damaged }); const cache = createChatArchive(storage);
    assert.ok(cache.warning); assert.equal(cache.initial, undefined);
    assert.throws(() => cache.save(snapshot)); assert.equal(storage.getItem('sift-chat'), damaged);
    assert.equal(JSON.parse(cache.recovery()).conversation, damaged);
  }
});
test('empty saved event prefixes preserve valid session state for native replay', () => {
  for (const version of [undefined, 2]) {
    const storage = memoryStorage({ 'sift-chat': JSON.stringify({ version, session: old.session, events: [] }) });
    const cache = createChatArchive(storage); assert.equal(cache.warning, ''); assert.equal(cache.initial.session.streamIndex, old.session.streamIndex);
  }
});
test('backup quota and conflicting backups never overwrite the original cache', () => {
  for (const conflict of [false, true]) {
    const storage = memoryStorage({ 'sift-chat': raw, ...(conflict ? { 'sift-chat-before-v27': 'earlier authored recovery' } : {}) });
    if (!conflict) storage.setItem = () => { throw new Error('QuotaExceededError'); };
    const cache = createChatArchive(storage); assert.throws(() => cache.save(snapshot));
    assert.equal(storage.getItem('sift-chat'), raw);
    if (conflict) assert.equal(storage.getItem('sift-chat-before-v27'), 'earlier authored recovery');
  }
});
test('a failed primary write retains the old cache and its recovery copy', () => {
  const storage = memoryStorage({ 'sift-chat': raw }); const set = storage.setItem;
  storage.setItem = (key, value) => { if (key === 'sift-chat') throw new Error('QuotaExceededError'); set(key, value); };
  assert.throws(() => createChatArchive(storage).save(snapshot));
  assert.equal(storage.getItem('sift-chat'), raw); assert.equal(storage.getItem('sift-chat-before-v27'), raw);
});
test('stale tabs cannot save or clear another tab’s newer cache', () => {
  const storage = memoryStorage({ 'sift-chat': native() }); const first = createChatArchive(storage); const stale = createChatArchive(storage);
  first.save({ ...snapshot, session: { ...snapshot.session, inbox: 'newer-authored-inbox' } });
  const latest = storage.getItem('sift-chat');
  assert.throws(() => stale.save(snapshot), /Another tab/); assert.throws(() => stale.clear(), /Another tab/);
  assert.equal(storage.getItem('sift-chat'), latest);
});
test('a lower native durable position or cursor cannot replace fuller same-session history', () => {
  const storage = memoryStorage({ 'sift-chat': native() }); const cache = createChatArchive(storage);
  cache.save({ session: snapshot.session, events: converted.slice(0, 1) }); assert.equal(storage.getItem('sift-chat'), native());
  cache.save({ session: { ...snapshot.session, streamIndex: 0 }, events: converted }); assert.equal(storage.getItem('sift-chat'), native());
});
test('explicit New removes before resetting and late snapshots cannot resurrect its old session', () => {
  const storage = memoryStorage({ 'sift-chat': raw }); const cache = createChatArchive(storage);
  cache.clear(); assert.equal(storage.getItem('sift-chat'), null); assert.equal(cache.legacyReceiptSessionId(), undefined);
  cache.save(snapshot); assert.equal(storage.getItem('sift-chat'), null);
  cache.save({ session: { sessionId: 'new-session', streamIndex: 0 }, events: [] });
  assert.equal(JSON.parse(storage.getItem('sift-chat')).session.sessionId, 'new-session');
  assert.equal(JSON.parse(storage.getItem('sift-chat')).legacyReceiptSessionId, undefined);
});
test('undefined snapshots are not deletion commands and failed removal preserves current state', () => {
  const storage = memoryStorage({ 'sift-chat': native() }); const cache = createChatArchive(storage);
  cache.save({ events: [] }); assert.equal(storage.getItem('sift-chat'), native());
  storage.removeItem = () => { throw new Error('Removal denied'); };
  assert.throws(() => cache.clear()); assert.equal(cache.initial.session.sessionId, old.session.sessionId);
});
test('receipts preserve only the restored legacy session and qualify every new session', () => {
  assert.equal(planReceipt('legacy', 'same-call', 'legacy'), 'same-call');
  assert.equal(planReceipt('new', 'same-call', 'legacy'), 'new:same-call');
  assert.notEqual(planReceipt('first', 'same-call'), planReceipt('second', 'same-call'));
});
