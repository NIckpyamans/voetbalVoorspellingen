# Ruflo-style AI monitor

Datum: 2026-06-22

Ruflo draait als extra agentlaag naast de app: hij leest monitor/data/reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te wijzigen.

## Agents
- Data: Datalaag: H2H 0%, bookmakers 0%, refs 0%.
- Leren: Leerlaag: 0 reviews, exact 0%, winnaar/gelijk 0%, top-5 exact 0%.
- Controle: Ontwikkelcontrole: 2 actieve monitorissues op 2026-06-22; digest 2026-05-31 t/m 2026-06-13.

## Gratis acties
1. [medium] H2H-backfill verder vullen (data) - Gebruik openfootball en football-data rows per competitie als historische H2H fallback voordat de UI 'leeg' toont.
2. [medium] Alle wedstrijden van vandaag hebben lege H2H-data. (control) - Vul H2H uit openfootball/football-data competitiebestanden voordat de UI leeg toont.
3. [medium] phaseReliability is leeg. (control) - Gebruik bestaande gratis workerdata en maak een reviewbranch-voorstel in plaats van blind live wijzigen.

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
