# Ruflo-style AI monitor

Datum: 2026-07-22

Ruflo draait als extra agentlaag naast de app: hij leest monitor/data/reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te wijzigen.

## Agents
- Data: Datalaag: H2H 0%, bookmakers 0%, refs 0%.
- Leren: Leerlaag: 0 reviews, exact 0%, winnaar/gelijk 0%, top-5 exact 0%.
- Controle: Ontwikkelcontrole: 0 actieve monitorissues op 2026-07-22; digest 2026-07-03 t/m 2026-07-16.

## Gratis acties
1. [medium] H2H-backfill verder vullen (data) - Gebruik openfootball en football-data rows per competitie als historische H2H fallback voordat de UI 'leeg' toont.

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
