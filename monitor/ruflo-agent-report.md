# Ruflo-style AI monitor

Datum: 2026-05-12

Ruflo draait als extra agentlaag naast de app: hij leest monitor/data/reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te wijzigen.

## Agents
- Data: Datalaag: H2H 80%, bookmakers 100%, refs 0%.
- Leren: Leerlaag: 394 reviews, exact 12%, winnaar/gelijk 41%, top-5 exact 10%.
- Controle: Ontwikkelcontrole: 0 actieve monitorissues op 2026-05-12; digest 2026-04-28 t/m 2026-05-11.

## Gratis acties

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
