# FootyAI

Gratis voetbaldata-, voorspelling- en kennisapp. De productie-app gebruikt geen betaalde AI-API.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

Voor lokale tests inclusief `/api/*` routes gebruik je `vercel dev`. De gewone Vite-server test alleen de frontend.

## Notes

- **No API keys needed.** Match data is pulled from a public (unofficial) SofaScore JSON feed.
- Predictions run **fully locally** (Elo + Poisson) and the model **learns in your browser** by storing finished results in `localStorage`.
- Vraag FootyAI is volledig gratis: productie gebruikt brongebonden antwoorden en bewaart de vraaggeschiedenis in de browser. Optioneel kan Ollama lokaal antwoorden verbeteren wanneer je eigen computer aanstaat.
- Tailwind draait via de lokale Vite/PostCSS build; de productie-app gebruikt geen `cdn.tailwindcss.com` meer.
- Optionele productiechecks staan in `.env.example` en `npm run readiness`. Zonder odds-key of database URL blijft de app eerlijk in no-key mode.
- Postgres/Supabase is voorbereid via `database/schema.sql`; uitvoeren kan later met `npm run db:schema:apply` zodra er een database URL is.
- `npm run readiness` onderscheidt een echte lege speeldag van ontbrekende wedstrijddatabronnen en toont de snapshot-training drempel.
- Snapshot-backed trainingsrijen krijgen pas extra gewicht zodra minimaal 50 afgeronde snapshotvoorspellingen beschikbaar zijn.

Server-side learning (optional):
- A simple server-side worker and GitHub Action were added to allow scheduled learning and predictions stored in `server_data.json`.
- The app exposes a serverless endpoint at `/api/predict?date=YYYY-MM-DD` which returns server predictions when available.

Deploy to Vercel (quick):
1. Push your repo to GitHub.
2. Go to https://vercel.com and import the repo (or run `vercel` via CLI).
3. Ensure the GitHub Action `Server-side learning` is enabled in `.github/workflows/learn.yml` to run hourly and update `server_data.json` with new predictions.

