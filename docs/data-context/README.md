# Data Context

Doel: een herbruikbare analysehub voor voetbaldata, modelkwaliteit, QA-regels en dashboardcontracten. Dit is geen opslagmotor; Postgres blijft de bron van waarheid zodra `DATABASE_URL` of `POSTGRES_URL` gevuld is.

## Gebruik
- Gebruik `analysis-context.json` als machine-leesbare catalogus voor toekomstige analyses.
- Gebruik `datasets.md` om tabellen, granulariteit en eigenaar per dataset te begrijpen.
- Gebruik `kpis.md` voor vaste definities van model-, data- en business-KPI's.
- Gebruik `quality-rules.md` voor checks die regressies en datavervuiling moeten vangen.
- Gebruik `dashboard-contract.md` als contract tussen database/API en app-dashboard.

## Architectuurrol
1. Database: opslag van wedstrijden, clubs, voorspellingen, odds en bronrecords.
2. Worker: verzamelt, normaliseert, voorspelt en archiveert.
3. Data context: beschrijft betekenis, KPI's, checks en analysevragen.
4. Dashboard: toont alleen metrics die volgens deze context gedefinieerd zijn.

## Geheimen
Bewaar nooit secrets in deze map. `DATABASE_URL`, `POSTGRES_URL`, `ODDS_API_KEY` en `THE_ODDS_API_KEY` horen alleen in Vercel env of lokale `.env.local`.
