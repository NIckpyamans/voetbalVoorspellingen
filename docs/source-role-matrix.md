# Source Role Matrix

Deze matrix bepaalt welke bron waarvoor gebruikt wordt. Doel: zo weinig mogelijk dubbele requests, duidelijke fallbackvolgorde en betere voorspellingen door bronvelden gericht te vullen.

| Bron | Primaire rol | Velden | Fallback voor | Niet gebruiken voor |
| --- | --- | --- | --- | --- |
| Sofascore | Live details als publiek bereikbaar | live status, minuut, scores, lineups, basis standings, H2H | ESPN/TheSportsDB bij live-scoregaten | Zware batchimports bij 403/rate-limit |
| ESPN Scoreboard | Fixtures, scores en logos voor gevolgde competities | fixture, kickoff, status, score, team-id, logo | Sofascore, BBC, TheSportsDB | Blessures en diepe teamstats |
| ESPN Team Schedule | Oefenwedstrijden van gevolgde clubs | club friendlies, kickoff, teams, logos | Clubwebsite curated fallback | Competitie-standings |
| Officiele clubsites | Curated oefenwedstrijden | confirmed friendly fixture, venue, source URL | ESPN team schedule | Automatische score-updates |
| TheSportsDB | Gratis fixture/logo backup | fixture, event, logo, basic teamdata | ESPN of Sofascore gaten | Odds, lineups, referee |
| football-data.co.uk | Historie en marktdata | uitslagen, closing odds, shots, cards, referee | H2H en market profiles | Live fixtures en lineups |
| football-data.org | Team/squad metadata met token | teams, squads, competition metadata | provider team-id mapping | Odds en live lineups |
| OpenFootball | Historische H2H en seizoenarchief | oude fixtures, resultaten, H2H-backfill | football-data.co.uk H2H-gaten | Live scores |
| OpenLigaDB | Duitse fixture/result backup | Duitse scores, fixtures, logos | ESPN voor Duitse competities | Niet-Duitse competities |
| API-Football | Betaalde providerlaag wanneer plan actief is | fixtures, H2H, team-id, lineups, odds afhankelijk van plan | Sportmonks of free sources | Free-plan toekomstige fixtures |
| Sportmonks | Betaalde providerlaag wanneer componenten actief zijn | leagues, seasons, teams, fixtures, odds, lineups afhankelijk van plan | API-Football | UEFA/odds zolang plan dit niet teruggeeft |
| The Odds API | Prematch odds | 1X2 odds, bookmakers, odds timestamp | Sportmonks/API-Football odds | Fixtures, lineups, H2H |
| Understat | xG profielsignaal | xG, xGA, shotkwaliteit | FBref/Sofascore stats | Kleine competities/friendlies |
| FBref snapshots | Shots en splits | shots, home/away splits, teamstats | Understat gaten | Live data |
| ClubElo | Clubkracht en trend | Elo-rating, ratingverschil, ratinghistorie | Afgeleide teamsterkte uit resultaten | Nationale teams/friendlies als harde waarheid |
| Open-Meteo | Weercontext | forecast, historische temperatuur/wind/neerslag | Venue climate fallback | Wedstrijdplanning of live score |
| BBC fixtures | Veiligheidsnet voor topfixtures | fixture check, status sanity | ESPN/TheSportsDB gaten | Structurele bulkdata |

## Uitvoeringsregels

- Fixtures: Sofascore indien bereikbaar, daarna ESPN Scoreboard, ESPN Team Schedule voor friendlies, TheSportsDB, OpenLigaDB/BBC/curated afhankelijk van competitie.
- Oefenwedstrijden: ESPN Team Schedule eerst, daarna officiele clubsite curated records. Deze krijgen friendly-kalibratie en lagere confidence claims.
- H2H: OpenFootball en football-data.co.uk primair; API-Football/Sportmonks alleen wanneer plan en quota dit toelaten.
- Odds: The Odds API/Sportmonks/API-Football alleen met echte prematch timestamps. football-data.co.uk is historical/closing proxy, niet live prematch.
- Lineups en blessures: Sofascore/API-Football/Sportmonks vlak voor kickoff; nooit hard high-falen als de wedstrijd nog niet binnen kickoffvenster zit.
- Standings: alleen verplicht voor competitiewedstrijden met actieve standingsbron. Friendlies en lege speeldagen mogen geen high regressie veroorzaken.
- Neon budget: sla ruwe payloads compact op, dedupe op canonical fixture, en gebruik curated records alleen voor bevestigde fixtures.

## Geautomatiseerde veldroutering

De uitvoerbare bronroutering staat in `config/source-field-routing.json`.
Gebruik deze matrix als contract voor worker/API/client:

- Fixtures en scores: ESPN/Sofascore primair; ESPN Team Schedule en officiele clubsites vullen vooral oefenwedstrijden.
- Lineups: alleen Sofascore telt als bevestigd; projected-squad-profile blijft een lagere-confidence fallback.
- Odds: The Odds API/Sportmonks/API-Football primair als echte provider; football-data.co.uk is historische of timestamped fallback, niet automatisch CLV-ready.
- H2H: API-Football/OpenFootball/canonical history vullen aan, maar bij ontbrekende betrouwbare historie wordt geen kunstmatige H2H gemaakt.
- Standen/teamlijsten: competitiecatalogus mag nulstanden tonen totdat providerstanden beschikbaar zijn.
- Clubkracht: ClubElo is een goedkoop primair signaal voor clubwedstrijden, maar krijgt een penalty bij interlands, friendlies en lage aliaszekerheid.
- Weer: Open-Meteo vult alleen context en confidence; ontbrekend weer mag nooit een voorspelling blokkeren.
- Opslag: Neon bewaart hot normalized data en lineage. Ruwe payloads ouder dan de retentieperiode worden gecompact; grotere archieven horen in object storage met alleen hash/URL/pointer in Neon.
