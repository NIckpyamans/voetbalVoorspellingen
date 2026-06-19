# Ruflo-style AI monitor

Datum: 2026-06-19

Ruflo draait als extra agentlaag naast de app: hij leest monitor/data/reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te wijzigen.

## Agents
- Data: Datalaag: H2H 100%, bookmakers 100%, refs 0%.
- Leren: Leerlaag: 712 reviews, exact 12%, winnaar/gelijk 41%, top-5 exact 14%.
- Controle: Ontwikkelcontrole: 0 actieve monitorissues op 2026-06-19; digest 2026-05-31 t/m 2026-06-13.

## Gratis acties
1. [high] Faalsignaal aanpakken: open_lineups (learning) - Laat dit signaal terugkomen als penalty in confidence en als uitleg in de matchkaart.

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
