# Ruflo-style AI monitor

Datum: 2026-05-11

Ruflo draait als extra agentlaag naast de app: hij leest monitor/data/reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te wijzigen.

## Agents
- Data: Datalaag: H2H 75%, bookmakers 100%, refs 0%.
- Leren: Leerlaag: 377 reviews, exact 11%, winnaar/gelijk 46%, top-5 exact 8%.
- Controle: Ontwikkelcontrole: 0 actieve monitorissues op 2026-05-11; digest 2026-04-21 t/m 2026-05-04.

## Gratis acties

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
