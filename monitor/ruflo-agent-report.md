# Ruflo-style AI monitor

Datum: 2026-10-17

Ruflo bundelt bestaande rapporten en vaste regels tot advies. Dit is geen zelfstandige AI- of internetanalyse; ontbrekende invoer blijft onbekend.

## Agents
- Data: Bronbestand server_data.json ontbreekt of is ongeldig; geen betrouwbare meting beschikbaar.
- Leren: Bronbestand server_data.json ontbreekt of is ongeldig; geen betrouwbare meting beschikbaar.
- Controle: Ontwikkelcontrole: 1 actieve monitorissues op 2026-10-17; digest 2026-10-10 t/m 2026-10-16.

## Gratis acties
1. [high] Workerdata is 851 minuten oud. (control) - Laat GitHub Actions schedule + manual dispatch draaien; geen mail nodig, alleen data committen.

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
