# Ruflo-style AI monitor

Datum: 2026-05-10

Ruflo draait als extra agentlaag naast de app: hij leest monitor/data/reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te wijzigen.

## Agents
- Data: Datalaag: H2H 57%, bookmakers 100%, refs 0%.
- Leren: Leerlaag: 326 reviews, exact 10%, winnaar/gelijk 45%, top-5 exact 4%.
- Controle: Ontwikkelcontrole: 0 actieve monitorissues op 2026-05-10; digest 2026-04-21 t/m 2026-05-04.

## Gratis acties
1. [medium] H2H-backfill verder vullen (data) - Gebruik openfootball en football-data rows per competitie als historische H2H fallback voordat de UI 'leeg' toont.

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
