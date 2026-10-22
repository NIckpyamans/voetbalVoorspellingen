# Ruflo-style AI monitor

Datum: 2026-10-22

Ruflo bundelt bestaande rapporten en vaste regels tot advies. Dit is geen zelfstandige AI- of internetanalyse; ontbrekende invoer blijft onbekend.

## Agents
- Data: Bronbestand server_data.json ontbreekt of is ongeldig; geen betrouwbare meting beschikbaar.
- Leren: Bronbestand server_data.json ontbreekt of is ongeldig; geen betrouwbare meting beschikbaar.
- Controle: Ontwikkelcontrole: 1 actieve monitorissues op 2026-10-22; digest 2026-10-13 t/m 2026-10-19.

## Gratis acties
1. [medium] Alle wedstrijden van vandaag hebben lege H2H-data. (control) - Vul H2H uit openfootball/football-data competitiebestanden voordat de UI leeg toont.

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
