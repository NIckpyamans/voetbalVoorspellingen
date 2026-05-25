# Ruflo-style AI monitor

Datum: 2026-05-26

Ruflo draait als extra agentlaag naast de app: hij leest monitor/data/reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te wijzigen.

## Agents
- Data: Datalaag: H2H 100%, bookmakers 100%, refs 0%.
- Leren: Leerlaag: 660 reviews, exact 12%, winnaar/gelijk 42%, top-5 exact 15%.
- Controle: Ontwikkelcontrole: 2 actieve monitorissues op 2026-05-26; digest 2026-05-12 t/m 2026-05-25.

## Gratis acties
1. [high] Wedstrijddag fallbackketen strakker maken (data) - Laat de worker altijd meerdere gratis bronnen proberen: SofaScore -> TheSportsDB -> OpenLigaDB -> football-data/openfootball.
2. [high] Faalsignaal aanpakken: open_lineups (learning) - Laat dit signaal terugkomen als penalty in confidence en als uitleg in de matchkaart.
3. [high] server_data.json is 889 minuten oud. (control) - Laat GitHub Actions schedule + manual dispatch draaien; geen mail nodig, alleen data committen.
4. [medium] Er zijn geen wedstrijden voor vandaag in server_data.json. (control) - Gebruik gratis fallbackketen met TheSportsDB/OpenLigaDB/openfootball en toon bronstatus in Instellingen.

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
