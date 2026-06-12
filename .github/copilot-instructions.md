# FootyAI repository instructions

FootyAI is a React/Vite dashboard with Vercel serverless APIs, scheduled GitHub Actions workers and PostgreSQL/Neon storage.

## Required approach

- Preserve historical match, prediction and competition data. A season reset creates a new season; it never deletes the previous season.
- Treat `data/competitions/<season>/<competition>.json` as immutable season archives after a season closes.
- Keep AI and search endpoints read-only unless a route explicitly uses `enforceWriteSecurity`.
- Reuse shared normalization, date, logging and database helpers instead of introducing duplicate logic.
- Do not expose secrets, database URLs, write tokens or provider credentials to the browser.
- Never merge or deploy an AI-generated patch without passing the repository checks.

## Required verification

Run these checks for code changes:

```bash
npm run check
npm run build
npm run monitor:regressions
```

For health, worker or season changes also run the relevant script directly and verify generated JSON remains valid.

## High-risk regression areas

- Live matches must have a minute or a clear fallback label.
- H2H, cup sheets and standings must not silently disappear.
- The dashboard must only show the selected match day.
- Logo fallbacks must remain functional.
- Canonical club and fixture merges must preserve foreign-key references.
- Scheduled workflows must limit concurrent database connections.

## Pull requests

- Explain the user-visible behavior and the data contract affected.
- Include verification results.
- Call out migrations, generated season files and deployment impact.
- Prefer a small, reviewable patch over broad refactors.
