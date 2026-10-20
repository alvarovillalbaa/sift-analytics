import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const IDENTITY_COOKIE = 'sift_identity';
const COOKIE_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export type BrowserIdentity = { principalId: string; expiresAt: number };
type SessionGrant = BrowserIdentity & { sessionId: string };

function signingSecret(): string {
  const configured = process.env.SIFT_SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1') {
    return 'sift-local-development-only-cookie-secret';
  }
  throw new Error('Set SIFT_SESSION_SECRET to at least 32 characters before using the hosted agent.');
}

function signature(payload: string): string {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

function seal(value: BrowserIdentity | SessionGrant): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

function unseal(value: string | undefined): unknown {
  if (!value || value.length > 6_000) return undefined;
  const parts = value.split('.');
  if (parts.length !== 2) return undefined;
  const [payload, supplied] = parts;
  const expected = signature(payload);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

function cookie(request: Request, name: string): string | undefined {
  const entry = request.headers.get('cookie')?.split(';').find((part) => part.trim().startsWith(`${name}=`));
  return entry?.trim().slice(name.length + 1);
}

function isIdentity(value: unknown): value is BrowserIdentity {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.principalId === 'string'
    && /^[a-f0-9-]{36}$/.test(record.principalId)
    && typeof record.expiresAt === 'number'
    && record.expiresAt > Date.now();
}

export function readBrowserIdentity(request: Request): BrowserIdentity | null {
  const value = unseal(cookie(request, IDENTITY_COOKIE));
  return isIdentity(value) ? value : null;
}

export function createBrowserIdentity(): BrowserIdentity {
  return { principalId: randomUUID(), expiresAt: Date.now() + COOKIE_LIFETIME_SECONDS * 1_000 };
}

function serializeCookie(request: Request, name: string, value: string, expiresAt: number, path = '/'): string {
  const secure = new URL(request.url).protocol === 'https:' || process.env.VERCEL === '1';
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1_000));
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function browserIdentityCookie(request: Request, identity: BrowserIdentity): string {
  return serializeCookie(request, IDENTITY_COOKIE, seal(identity), identity.expiresAt);
}

function grantCookieName(sessionId: string): string {
  return `sift_eve_${createHash('sha256').update(sessionId).digest('hex').slice(0, 24)}`;
}

export function ownsAgentSession(request: Request, identity: BrowserIdentity, sessionId: string): boolean {
  const grant = unseal(cookie(request, grantCookieName(sessionId)));
  return isIdentity(grant) && grant.principalId === identity.principalId
    && (grant as SessionGrant).sessionId === sessionId;
}

// Only call this with the ID returned by the successful eve create handler.
export function agentSessionGrantCookie(request: Request, identity: BrowserIdentity, sessionId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) throw new Error('Invalid agent session identifier.');
  const expiresAt = Math.min(identity.expiresAt, Date.now() + 24 * 60 * 60 * 1_000);
  // A separate path-scoped cookie per session avoids concurrent-tab grant updates racing.
  return serializeCookie(request, grantCookieName(sessionId), seal({ ...identity, expiresAt, sessionId }),
    expiresAt, `/eve/v1/session/${encodeURIComponent(sessionId)}`);
}

export function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const caller = new URL(origin);
    const url = new URL(request.url);
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    return caller.origin === url.origin
      || caller.host === forwardedHost
      || caller.origin === process.env.SIFT_APP_ORIGIN;
  } catch {
    return false;
  }
}
