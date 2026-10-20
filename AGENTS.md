# Sift

Sift is a Next.js application with an eve agent and browser-local DuckDB analysis.

- Read `README.md` and `docs/architecture.md` before substantial changes.
- Never send uploaded files or rows to a model implicitly. Schema sharing is explicit; result sharing requires the workspace setting.
- Dataset permissions, SQL limits, and session ownership are enforced by code, never by agent instructions alone.
- PostgreSQL connections come from server configuration; do not accept arbitrary connection URLs from public requests.
- Preserve query provenance, freshness, truncation, and metric definitions in views.
- Read the installed `node_modules/eve/docs` before changing eve integration.
- Do not label unimplemented connectors supported.
- Keep dependencies locked and never commit credentials.
- Use targeted static checks. Full builds and browser checks are appropriate when explicitly requested or required for the requested publication.
