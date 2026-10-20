import { eveChannel, type ClientContextValue } from 'eve/channels/eve';
import { GET, type RouteDefinition, type RouteHandlerArgs } from 'eve/channels';
import { ForbiddenError, UnauthenticatedError, type AuthFn } from 'eve/channels/auth';
import { z } from 'zod';
import { agentSessionGrantCookie, isSameOriginRequest, ownsAgentSession, readBrowserIdentity } from '../../lib/auth';

const clientContextSchema = z.record(z.string(), z.unknown());
const responseSchema = z.object({
  requestId: z.string().min(1).max(200),
  optionId: z.string().min(1).max(200).optional(),
  text: z.string().min(1).max(6_000).optional(),
}).strict().refine((value) => Boolean(value.optionId) !== Boolean(value.text));
const messageSchema = z.object({
  message: z.string().min(1).max(12_000).optional(),
  clientContext: clientContextSchema.optional(),
  turnPolicy: z.enum(['steer', 'queue']).optional(),
}).strict();
const continuationSchema = messageSchema.extend({
  inputResponses: z.array(responseSchema).min(1).max(12).optional(),
}).refine((value) => Boolean(value.message) !== Boolean(value.inputResponses));

async function requestBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > 100_000) {
    throw new ForbiddenError({ message: 'The agent request is too large.' });
  }
  const reader = request.clone().body?.getReader();
  if (!reader) return {};
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 100_000) {
        void reader.cancel();
        throw new ForbiddenError({ message: 'The agent request is too large.' });
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text.trim() ? JSON.parse(text) : {};
  } catch (error) {
    if (error instanceof ForbiddenError) throw error;
    throw new ForbiddenError({ message: 'Invalid agent request.' });
  } finally {
    reader.releaseLock();
  }
}

const browserAuth: AuthFn<Request> = async (request) => {
  const identity = readBrowserIdentity(request);
  if (!identity) throw new UnauthenticatedError({ message: 'Initialize your Sift browser session before using the agent.' });
  if (!isSameOriginRequest(request)) throw new ForbiddenError({ message: 'Agent requests must originate from Sift.' });

  const match = new URL(request.url).pathname.match(/\/eve\/v1\/session(?:\/([a-zA-Z0-9_-]{1,200})(?:\/(stream|cancel|compact|clear|reset))?)?$/);
  if (!match || (request.method !== 'POST' && !(request.method === 'GET' && match[2] === 'stream'))) {
    throw new ForbiddenError({ message: 'This agent channel does not expose session lists or unscoped records.' });
  }
  const sessionId = match[1];
  const operation = match[2];
  if (sessionId && !ownsAgentSession(request, identity, sessionId)) {
    throw new ForbiddenError({ message: 'This browser does not own that agent session. Start a new conversation.' });
  }
  if (request.method === 'POST') {
    const schema = operation === 'cancel' ? z.object({ turnId: z.string().min(1).max(200).optional() }).strict()
      : operation === 'reset' ? z.object({ reason: z.string().min(1).max(1_000).optional() }).strict()
      : operation ? z.object({}).strict()
      : sessionId ? continuationSchema : messageSchema;
    if (!schema.safeParse(await requestBody(request)).success) {
      throw new ForbiddenError({ message: 'Use a bounded text message and schema context, or a supported session control.' });
    }
  }
  return {
    authenticator: 'sift-browser',
    principalId: identity.principalId,
    principalType: 'user',
    attributes: { workspaceId: identity.principalId },
  };
};

const channel = eveChannel({
  auth: browserAuth,
  uploadPolicy: 'disabled',
  onMessage(ctx) {
    const context = ctx.eve.clientContext;
    if (context && typeof context === 'object' && !Array.isArray(context)) {
      const { datasets, metrics, shareSchema, shareResults, results, activeView } = context as Extract<ClientContextValue, Record<string, unknown>>;
      return {
        auth: ctx.eve.caller,
        clientContext: {
          shareSchema: shareSchema === true,
          shareResults: shareResults === true,
          ...(shareSchema === true ? { datasets: datasets ?? [], metrics: metrics ?? [] } : {}),
          ...(shareResults === true && results !== undefined ? { results } : {}),
          ...(typeof activeView === 'string' ? { activeView } : {}),
        },
      };
    }
    return { auth: ctx.eve.caller, clientContext: { shareSchema: false, shareResults: false } };
  },
});

function isRequiredRoute(route: RouteDefinition): boolean {
  if (route.transport === 'websocket') return false;
  if (route.path === '/eve/v1/health') return route.method === 'GET' || route.method === 'HEAD';
  // Workflow resumes authenticate their opaque callback token inside eve.
  if (route.path === '/.well-known/workflow/v1/webhook/:token') return true;
  if (route.path === '/eve/v1/session') return route.method === 'POST';
  if (route.path === '/eve/v1/session/:sessionId/stream') return route.method === 'GET';
  return route.method === 'POST'
    && /^\/eve\/v1\/session\/:sessionId(?:\/(?:cancel|compact|clear|reset))?$/.test(route.path);
}

export default {
  ...channel,
  routes: [...channel.routes.filter(isRequiredRoute).map((route) => {
    if (route.transport === 'websocket' || route.method !== 'POST' || route.path !== '/eve/v1/session') return route;
    return {
      ...route,
      async handler(request: Request, context: RouteHandlerArgs) {
        const response = await route.handler(request, context);
        if (!response.ok) return response;
        const identity = readBrowserIdentity(request);
        const payload = await response.clone().json() as { sessionId?: unknown };
        if (!identity || typeof payload.sessionId !== 'string') {
          return Response.json({ error: 'Unable to bind the agent session to this browser.' }, { status: 500 });
        }
        const headers = new Headers(response.headers);
        headers.append('set-cookie', agentSessionGrantCookie(request, identity, payload.sessionId));
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      },
    };
  }), GET('/eve/v1/session', async () => Response.json({ error: 'Session listing is disabled.' }, {
    status: 403, headers: { 'cache-control': 'no-store' },
  }))],
};
