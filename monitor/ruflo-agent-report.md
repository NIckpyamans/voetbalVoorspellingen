# Ruflo-style AI monitor

Datum: 2026-05-23

Ruflo draait als extra agentlaag naast de app: hij leest monitor/data/reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te wijzigen.

## Agents
- Data: Datalaag: H2H 100%, bookmakers 100%, refs 0%.
- Leren: Leerlaag: 596 reviews, exact 12%, winnaar/gelijk 39%, top-5 exact 16%.
- Controle: Ontwikkelcontrole: 1 actieve monitorissues op 2026-05-23; digest 2026-05-05 t/m 2026-05-18.

## Gratis acties
1. [high] Faalsignaal aanpakken: open_lineups (learning) - Laat dit signaal terugkomen als penalty in confidence en als uitleg in de matchkaart.
2. [high] server_data.json is 887 minuten oud. (control) - Laat GitHub Actions schedule + manual dispatch draaien; geen mail nodig, alleen data committen.

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
