# Ruflo-style AI monitor

Datum: 2026-05-09

Ruflo draait als extra agentlaag naast de app: hij leest monitor/data/reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te wijzigen.

## Agents
- Data: Datalaag: H2H 86%, bookmakers 100%, refs 0%.
- Leren: Leerlaag: 291 reviews, exact 10%, winnaar/gelijk 45%, top-5 exact 3%.
- Controle: Ontwikkelcontrole: 0 actieve monitorissues op 2026-05-09; digest 2026-04-21 t/m 2026-05-04.

## Gratis acties

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
