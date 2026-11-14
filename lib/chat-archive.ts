import type { ClientSessionState, SessionStreamEvent } from 'eve/client';
import { emptySessionView, foldEvents, position } from 'eve/events';
import { convertLegacyEvents } from 'eve/internal/legacy-events';

const key = 'sift-chat';
const backupKey = 'sift-chat-before-v27';
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type ChatSnapshot = { session?: ClientSessionState; events: readonly SessionStreamEvent[] };
type Archive = { version: 2; session: ClientSessionState; events: readonly SessionStreamEvent[]; legacyReceiptSessionId?: string };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function readArchive(raw: string): { archive: Archive; legacy: boolean } {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !record(value.session) || !Array.isArray(value.events)
    || typeof value.session.sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value.session.sessionId)
    || !Number.isSafeInteger(value.session.streamIndex) || (value.session.streamIndex as number) < 0
    || (value.session.inbox !== undefined && typeof value.session.inbox !== 'string')) throw new Error('Invalid saved conversation.');
  const legacy = value.version === undefined;
  if (!legacy && value.version !== 2) throw new Error('This saved conversation uses an unsupported version.');
  const events = legacy && value.events.length ? convertLegacyEvents(value.events) : value.events as SessionStreamEvent[];
  if (events.length) {
    if (events[0].type !== 'session.started' || events.filter(event => event.type === 'session.started').length !== 1) throw new Error('Saved history must start with exactly one session.');
    let previousLine = -1;
    let previousIndex = -1;
    for (const event of events) {
      const meta = event?.meta;
      if (typeof event?.type !== 'string' || !record(event.data) || !meta || typeof meta.at !== 'string'
        || !Number.isSafeInteger(meta.position?.line) || meta.position.line < 0
        || !Number.isSafeInteger(meta.position.index) || meta.position.index < 0
        || (meta.position.line < previousLine || (meta.position.line === previousLine && meta.position.index <= previousIndex))) throw new Error('Invalid saved event order.');
      previousLine = meta.position.line; previousIndex = meta.position.index;
    }
    if (events[0].meta.position.line !== 0) throw new Error('Saved history is missing its beginning.');
  }
  const view = foldEvents(emptySessionView(), events);
  if (position(view) > (value.session.streamIndex as number)) throw new Error('Saved cursor precedes its history.');
  const marker = legacy ? value.session.sessionId : value.legacyReceiptSessionId;
  if (marker !== undefined && marker !== value.session.sessionId) throw new Error('Saved replay identity does not match its session.');
  return { archive: { version: 2, session: value.session as unknown as ClientSessionState, events,
    ...(marker ? { legacyReceiptSessionId: marker as string } : {}) }, legacy };
}

/** Owns only browser persistence. Eve owns event conversion, projection and lifecycle. */
export function createChatArchive(storage: StorageAccess) {
  let expectedRaw: string | null = null;
  let initial: Archive | undefined;
  let warning = '';
  let legacy = false;
  let recoveryRaw: string | null = null;
  const retired = new Set<string>();
  try {
    expectedRaw = storage.getItem(key);
    recoveryRaw = expectedRaw;
    if (expectedRaw !== null) ({ archive: initial, legacy } = readArchive(expectedRaw));
  } catch {
    warning = 'Saved conversation could not be restored. Export a recovery copy before starting a new conversation.';
  }
  function assertCurrent() {
    if (storage.getItem(key) !== expectedRaw) throw new Error('Another tab changed this conversation. Reload to keep its latest history.');
  }
  return {
    initial,
    warning,
    legacyReceiptSessionId: () => initial?.legacyReceiptSessionId,
    recovery() {
      return JSON.stringify({ conversation: storage.getItem(key) ?? recoveryRaw, beforeUpgrade: storage.getItem(backupKey) }, null, 2);
    },
    save(snapshot: ChatSnapshot) {
      if (!snapshot.session || retired.has(snapshot.session.sessionId)) return;
      if (warning) throw new Error(warning);
      assertCurrent();
      if (initial) {
        if (snapshot.session.sessionId !== initial.session.sessionId) throw new Error('Start a new conversation before replacing saved history.');
        if (snapshot.session.streamIndex < initial.session.streamIndex
          || position(foldEvents(emptySessionView(), snapshot.events)) < position(foldEvents(emptySessionView(), initial.events))) return;
      }
      const archive: Archive = { version: 2, session: snapshot.session, events: snapshot.events,
        ...(initial?.legacyReceiptSessionId === snapshot.session.sessionId ? { legacyReceiptSessionId: initial.legacyReceiptSessionId } : {}) };
      const nextRaw = JSON.stringify(archive);
      // Keep the exact original before the first native write; a quota/conflict leaves it intact.
      if (legacy && expectedRaw !== null) {
        const backup = storage.getItem(backupKey);
        if (backup !== null && backup !== expectedRaw) throw new Error('An earlier recovery copy already exists. Export both copies before starting a new conversation.');
        if (backup === null) storage.setItem(backupKey, expectedRaw);
      }
      storage.setItem(key, nextRaw);
      expectedRaw = nextRaw; initial = archive; legacy = false;
    },
    clear() {
      assertCurrent();
      storage.removeItem(key);
      if (initial) retired.add(initial.session.sessionId);
      expectedRaw = null; initial = undefined; legacy = false; warning = '';
    },
  };
}

/** Old receipts retain their meaning only for the session restored from the old cache. */
export function planReceipt(sessionId: string, callId: string, legacySessionId?: string) {
  return sessionId === legacySessionId ? callId : `${sessionId}:${callId}`;
}
