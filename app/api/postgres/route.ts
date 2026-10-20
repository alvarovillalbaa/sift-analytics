import { authorize, connections, discover, queryPostgres } from '@/lib/postgres';
export const runtime = 'nodejs';
export const maxDuration = 30;
function error(message: string, status: number) { return Response.json({ error: message }, { status }); }
export async function GET(request: Request) {
  try {
    const configured = connections();
    if (!configured.length) return Response.json({ configured: false, datasets: [], connections: [] });
    if (!authorize(request)) return error('Enter your deployment access token to use private database connections.', 401);
    return Response.json({ configured: true, datasets: await discover(), connections: configured.map(c => ({ id: c.id, name: c.name })) });
  } catch { return error('Could not discover the configured database. Check the server connection and read permissions.', 502); }
}
export async function POST(request: Request) {
  if (!authorize(request)) return error('A valid deployment access token is required.', 401);
  if (Number(request.headers.get('content-length') ?? 0) > 40000) return error('Query request is too large.', 413);
  try {
    const body = await request.json();
    if (typeof body.sql !== 'string' || body.sql.length > 12000 || !Array.isArray(body.datasetIds) || body.datasetIds.length > 20 || body.datasetIds.some((id: unknown) => typeof id !== 'string')) return error('Provide a SQL query and approved dataset IDs.', 400);
    return Response.json(await queryPostgres(body.sql, body.datasetIds));
  } catch { return error('Query could not run. Check the approved datasets and SQL. Only bounded, read-only queries are allowed.', 400); }
}
