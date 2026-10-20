# Deployment

## Vercel

1. Import this repository into a Vercel project using Node.js 24 and the Next.js preset. The build command is `npm run build`; installation runs `npm ci` and copies the DuckDB worker/WASM into `public/duckdb`.
2. Add `SIFT_SESSION_SECRET` as a secret environment variable with at least 32 random characters. Keep the same value in the frontend and eve services. Without it, browser AI sessions fail closed; local data analysis still works.
3. Enable AI Gateway access and appropriate spending limits for the project. eve's string model ID uses Vercel OIDC. Add `AI_GATEWAY_API_KEY` only if your account requires a separate Gateway credential.
4. Optionally set the private PostgreSQL variables documented in the root README. Do not configure customer credentials on a public shared demo.
5. Deploy. `eve/next` contributes the agent service and routes `/eve/v1/*` in the same project. Keep its workflow callback routes accessible.
6. Verify the page, `/eve/v1/health`, `/api/session`, and a real agent tool turn. A healthy page/agent endpoint does not prove model inference, file imports, or database access.

The app uses no build-time secrets. Database credentials are read only by the server adapter. Vercel production protection should match the intended audience; use a private deployment when enabling internal database sources.

## Complete self-hosting

Use the provided container or a Node.js 24 host. Set `SIFT_SESSION_SECRET` and `AI_GATEWAY_API_KEY` at runtime. The Next/eve integration runs the agent beside Next and proxies its browser transport. Local Workflow callbacks use the eve service's internal port. Uploaded datasets remain in each browser; the server needs no copied customer file directory.

```sh
npm ci
npm run build
npm start
```

Or:

```sh
docker compose up --build -d
```

Create `.env` from `.env.example` for Docker Compose; do not commit it. Provide HTTPS with a reverse proxy and preserve streaming responses. Mount `.eve/.workflow-data` persistently; the Compose service does so. Use one instance with the default local Workflow world. Multi-instance self-hosting requires a compatible shared Workflow world and coordinated storage rather than independent local volumes. If adding external Workflow webhook integrations, explicitly route `/.well-known/workflow/` to the eve service; the current browser-only transport does not expose that public prefix through Next.

For local/private databases, run the deployment where the database is reachable. A private worker, air-gapped installer, local model, and managed SaaS synchronization are not included in this release. Model access can send shared schemas/results outside your network independently of database execution location.

## Release evidence

Current verification and publication receipts are recorded in `docs/release.md`. Do not infer live-provider or database proof from a static check.

Framework references: [Next.js integration](https://eve.dev/docs/guides/frontend/nextjs), [Vercel deployment](https://eve.dev/docs/guides/deployment/vercel), [self-hosting](https://eve.dev/docs/guides/deployment/self-hosting).
