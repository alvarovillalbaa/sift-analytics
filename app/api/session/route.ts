import { browserIdentityCookie, createBrowserIdentity, isSameOriginRequest, readBrowserIdentity } from '../../../lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: 'Open Sift directly to initialize your browser session.' }, { status: 403 });
  }
  try {
    const existing = readBrowserIdentity(request);
    const identity = existing ?? createBrowserIdentity();
    const headers = new Headers({ 'cache-control': 'no-store' });
    if (!existing) headers.append('set-cookie', browserIdentityCookie(request, identity));
    return Response.json({ principalId: identity.principalId, sessionPrefix: '' }, { headers });
  } catch {
    return Response.json({ error: 'The agent session is not configured. Set SIFT_SESSION_SECRET on the server.' }, {
      status: 503, headers: { 'cache-control': 'no-store' },
    });
  }
}

export const POST = GET;
