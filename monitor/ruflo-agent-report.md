# Ruflo-style AI monitor

Datum: 2026-06-07

Ruflo draait als extra agentlaag naast de app: hij leest monitor/data/reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te wijzigen.

## Agents
- Data: Datalaag: H2H 0%, bookmakers 0%, refs 0%.
- Leren: Leerlaag: 691 reviews, exact 12%, winnaar/gelijk 41%, top-5 exact 14%.
- Controle: Ontwikkelcontrole: 1 actieve monitorissues op 2026-06-07; digest 2026-05-21 t/m 2026-06-03.

## Gratis acties
1. [high] Wedstrijddag fallbackketen strakker maken (data) - Laat de worker altijd meerdere gratis bronnen proberen: SofaScore -> TheSportsDB -> OpenLigaDB -> football-data/openfootball.
2. [high] Faalsignaal aanpakken: open_lineups (learning) - Laat dit signaal terugkomen als penalty in confidence en als uitleg in de matchkaart.
3. [medium] H2H-backfill verder vullen (data) - Gebruik openfootball en football-data rows per competitie als historische H2H fallback voordat de UI 'leeg' toont.
4. [medium] cupSheets is leeg. (control) - Gebruik bestaande gratis workerdata en maak een reviewbranch-voorstel in plaats van blind live wijzigen.

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
