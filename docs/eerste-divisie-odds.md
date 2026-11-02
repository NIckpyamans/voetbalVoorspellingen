# Odds voor de Nederlandse Eerste Divisie

Stand van 2 november 2026. De Eerste Divisie is de enige competitie in de
`leagueCoverage` van `monitor/critical-odds-capture.json` die structureel op 0
staat, terwijl de rest van de dekking rond de 77% zit. Dat is geen quotum- of
coderingsprobleem maar een catalogusprobleem.

## Wat niet werkt

| Bron | Waarom niet |
| --- | --- |
| The Odds API | Geen sportkey voor de Eerste Divisie, ook niet in `inactiveSoccerSportKeys` (gecontroleerd met `catalogIncludesInactive: true`). |
| Sportmonks | Odds-endpoint werkt, maar het abonnement dekt vier competities in twee landen. |
| API-Football | Account is `suspended`; de `.com`-variant dekt alleen England Championship en France Ligue 2. |
| Football-Data.co.uk | Nederlandse bestanden bevatten alleen de Eredivisie. |
| SportsGameOdds | Gratis tier is acht leagues; de Eerste Divisie zit zelfs niet in het betaalde plan. |
| GoalApi | Zit in het project, maar `goalApiFeatureEnabled("odds")` geeft hard `false` en er is geen odds-client. |

Sportbooks die de competitie wél aanbieden (BetOnline, BetUS, FanDuel,
DraftKings, OddsPortal, Oddschecker) hebben geen publieke API; ze uitlezen is
scraping en valt buiten de bronnen die dit project mag gebruiken.

## Wat werkt: OddsPapi

`https://api.oddspapi.io/v4`, authenticatie met `apiKey` als queryparameter.
Hun eigen meting van een Eerste Divisie-fixture (Helmond Sport - VVV Venlo,
`tournamentId` 131) telt 254 bookmakers, 231 complete actieve 1X2-quotes en 67
onafhankelijke prijzen. Daarmee is dit de enige realistische route naar echte
marktprijzen voor deze competitie.

Beschikbare endpoints:

- `GET /tournaments?sportId=10` — lijst competities met `tournamentId`.
- `GET /odds-by-tournaments?bookmaker=pinnacle&tournamentIds=131` — fixtures én
  odds in één call per bookmaker (geen losse call per fixture).
- `GET /odds?fixtureId=...` — volledige board voor één fixture.

1X2 zit op markt `101` met outcomes `101` (thuis), `102` (gelijk), `103` (uit).
Twee vlaggen moeten allebei mee: `bookmakerIsActive` op bookmaker-niveau en
`active` op prijsniveau.

## Wat er nu in de code zit

- `scripts/providers/oddspapi-provider.js` — 1X2-uitlezen, dedupliceren op
  prijstuple, mediaan-aggregatie en request-schatting.
- `scripts/oddspapi-dry-run.js` — droogrun die alleen meet: hoeveel requests een
  meting kost, welke fixtures odds hebben en wat de geaggregeerde 1X2 wordt.
  Schrijft niets weg.
- `quota-budget.js` heeft een `oddspapi`-provider; zonder auditcijfers is
  `spendable` 0 en gebruikt de droogrun `ODDSPAPI_DRYRUN_MAX_REQUESTS`
  (standaard 5) als expliciete bovengrens.

## Key instellen

Lokaal (aanbevolen): zet `ODDSPAPI_API_KEY=...` in `.env` in de projectmap. Dat
bestand staat in `.gitignore`; `.env.example` is het lege voorbeeld. De droogrun
roept `loadLocalEnv` aan, dus de key uit `.env` wordt gebruikt zonder dat je iets
in je shell hoeft te zetten.

Alleen voor die ene cmd-sessie: `set ODDSPAPI_API_KEY=...`. Permanente
gebruikersvariabele: `setx ODDSPAPI_API_KEY "..."` (werkt pas in een nieuw
venster).

Voor GitHub Actions: repo -> Settings -> Secrets and variables -> Actions ->
New repository secret, naam `ODDSPAPI_API_KEY`. De workflow moet die naam nog
doorgeven zodra de provider in de capture hangt.

```cmd
npm run odds:oddspapi:dryrun
npm run odds:oddspapi:dryrun -- --bookmakers=bet99,bpremium --limit=4
npm run odds:oddspapi:dryrun -- --tournament=131
```

Het gratis plan heeft 250 requests per maand en geeft alleen toegang tot de
bookmakers die onder Availability -> Bookmakers Access een groen vinkje bij
Pregame hebben. Staat jouw standaardbook (pinnacle) daar niet bij, kies dan een
slug uit die lijst via `--bookmakers`. De droogrun blijft met
`ODDSPAPI_DRYRUN_MAX_REQUESTS` (standaard 5) ruim binnen dat budget.

Kosten: het prijsmodel is (boekmakers + sporten) × requests, met een minimum van
dertien requests per maand. Een meting met één bookmaker en één competitie is
daarmee één request; de droogrun print het werkelijke aantal.

## Automatische capture en het maandbudget

`scripts/capture-critical-odds-to-r2.js` haalt OddsPapi hooguit één keer per run
op, en alleen als er een Eerste Divisie-duel in het capture-venster staat
waarvoor de oddsrol (opening/prematch/closing) nog ontbreekt. Eén
`odds-by-tournaments`-call bevat alle fixtures van de competitie, dus het verbruik
is één request per run in plaats van één per wedstrijd.

| Variabele | Default | Effect |
| --- | --- | --- |
| `ODDSPAPI_TOURNAMENT_ID` | `131` | Eerste Divisie; vast, zodat er geen toernooilookup per run nodig is |
| `ODDSPAPI_BOOKMAKERS` | `pinnacle,bet99,bpremium` | Wordt in volgorde geprobeerd; de bookmaker die data gaf wordt onthouden |
| `ODDSPAPI_MONTHLY_LIMIT` | `250` | Gratis plan |
| `ODDSPAPI_MONTHLY_RESERVE` | `25` | Blijft altijd vrij voor handmatige metingen |
| `ODDSPAPI_MAX_REQUESTS_PER_RUN` | `2` | Bovengrens per run, ook bij het proberen van meerdere bookmakers |

De teller staat in R2 onder `oddspapi/usage.json` (`month`, `requests`, `runs`,
`preferredBookmaker`) en reset bij een maandwissel. Bij 120 runs per maand (cron
elke 6 uur) en één request per run blijft het verbruik rond 120 van de 225
beschikbare requests. Staan er geen divisieduels in het venster, dan kost de run
nul requests. Het resultaat staat als `oddspapi` in
`monitor/critical-odds-capture.json`, inclusief `monthlyUsed` en
`monthlyRemaining`.

Zolang OddsPapi geen data levert, valt de capture terug op de bestaande
providers en blijft de dekking gelijk; er wordt niets overschreven.

Workflow-gedrag (`free-prematch-odds.yml`):

- `cancel-in-progress` staat uit. Een afgebroken run kan requests hebben gedaan
  zonder dat de maandteller is opgeslagen; een lopende run moet dus afmaken.
- De herberekening (`worker.yml`) start alleen als de capture-stap zelf is
  geslaagd én `captured > 0` rapporteert. Een oud rapport uit de repo triggert
  dus geen extra worker-run.

## Nog te doen

De provider is bewust nog niet in `capture-critical-odds-to-r2.js` gehangen.
Eerst meten hoeveel van de vier Eerste Divisie-duels per ronde een board hebben
en hoe groot de afwijking met The Odds API is op competities die beide bronnen
dekken; daarna pas de capture uitbreiden.
