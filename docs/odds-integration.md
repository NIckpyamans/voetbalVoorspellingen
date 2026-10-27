# Odds integration plan

Doel: ROI en CLV alleen berekenen op echte bookmaker odds die voor de wedstrijd zijn vastgelegd.

## Status

- Historische football-data.co.uk marktprofielen zijn gekoppeld voor calibratie.
- De worker heeft nu een provider-adapter voor echte `odds_at_prediction`.
- Zonder geconfigureerde provider registreert de worker bewust `not_configured`; er wordt geen nep-odds gevuld.
- `roiStatus` en `clvStatus` voorkomen dat ontbrekende odds als meetbare performance worden gezien.
- Als de provider `closingHome`, `closingDraw`, `closingAway` en `closingCapturedAt` meegeeft, berekent de evaluatie automatisch CLV op de gespeelde voorspelling.

## Vereiste velden

Elke odds snapshot moet minimaal deze velden hebben:

| Veld | Betekenis |
| --- | --- |
| `provider` | API of bronnaam |
| `bookmaker` | bookmaker of exchange |
| `market` | bijvoorbeeld `1X2` |
| `home`, `draw`, `away` | decimal odds op voorspellingstijdstip |
| `capturedAt` | timestamp waarop odds zijn opgehaald |
| `closingHome`, `closingDraw`, `closingAway` | closing odds |
| `closingCapturedAt` | timestamp van closing odds |

## Pipeline

1. Haal pre-match 1X2 odds op voor kickoff.
2. Sla odds op in de immutable prediction snapshot.
3. Haal closing odds op na market close of na wedstrijdstart.
4. Bereken ROI pas na uitslag.
5. Bereken CLV alleen wanneer pre-match odds en closing odds allebei beschikbaar zijn.
6. Gebruik nooit odds die na `cutoffAt` zijn opgehaald als modelinput.

De adapter accepteert alleen odds waarvan `capturedAt` voor `cutoffAt` en kickoff ligt. Odds na kickoff worden afgewezen met `rejected_after_cutoff`.

## Environment

Ondersteunde voorbereidende env vars:

- `ODDS_PROVIDER_NAME`
- `ODDS_API_URL_TEMPLATE`
- `ODDS_API_KEY`
- `THE_ODDS_API_KEY`
- `FOOTBALL_DATA_TOKEN`

`ODDS_API_URL_TEMPLATE` mag placeholders bevatten:

- `{apiKey}`
- `{homeTeam}`
- `{awayTeam}`
- `{league}`
- `{kickoff}`
- `{matchId}`

Zonder provider blijft `oddsStatus` bewust `historical_market_profile_only` of `missing`, en `oddsProviderStatus` wordt `not_configured`.

Gebruik `npm run readiness` om te controleren of de env vars gezet zijn zonder geheime waarden te loggen.

## Geaccepteerde closing-velden

De provider mag closing odds direct in dezelfde response meesturen met een van deze namen:

- `closingHome`, `closingDraw`, `closingAway`
- `homeClosing`, `drawClosing`, `awayClosing`
- `closeHome`, `closeDraw`, `closeAway`
- `home_close`, `draw_close`, `away_close`

Pre-match odds blijven alleen geldig als `capturedAt <= cutoffAt <= kickoff`. Closing odds worden opgeslagen voor evaluatie/CLV, maar worden niet als pre-match modelinput behandeld.


### FA Cup availability

`England - FA Cup` maps to `soccer_fa_cup`. Discovery and the provider audit
request `/v4/sports/?all=true`, so a supported competition with `active: false`
is recorded as expected seasonal inactivity, rather than a removed key.
The audit exposes `inactiveSoccerSportKeys`, `newlyInactiveSports` and `faCup.status`;
`newlyUnavailableSports` only contains keys absent from a successful full catalogue.
A failed catalogue request must not imply that a competition has disappeared.

Inactive competitions do not trigger paid odds requests. Other configured providers
can still supply odds; without an available snapshot the ensemble excludes the market
component and renormalizes the remaining model weights. No synthetic odds are added.
An inactive provider key describes provider availability, not proof that the actual
competition has no fixtures (qualifying rounds can already be underway).

Source: https://the-odds-api.com/liveapi/guides/v4/#get-sports

## Marktbestand: data/market-odds.json (football-data.co.uk)

De marktbaseline in `shared/modelMetrics.js` rustte alleen op pre-match
`oddsAtPrediction`-captures (~7% van de reviews, marktvergelijking n≈94).
`data/market-odds.json` vult dat gat voor de twaalf competities waarvoor
football-data.co.uk gratis seizoens-CSV's publiceert (E0, E1, D1, D2, I1,
SP1, F1, F2, N1, N2, B1, P1):

1. `scripts/build-market-odds.js` haalt alleen de seizoenen/competities op die
   nodig zijn voor beoordeelde wedstrijden zonder pre-match odds, met een
   7-dagen-drempel. Fair-use van football-data.co.uk: maximaal twee
   geautomatiseerde ophalingen per week voor niet-commercieel priv-gebruik;
   deze drempel houdt de workflow op maximaal één ophaling per week.
2. Koppeling op datum + competitie + einduitslag, met clubnamen als tiebreak;
   bij meerdere evenwaardige kandidaten wordt overgeslagen (nooit gokken op
   de verkeerde wedstrijd). Kolomvolgorde: AvgCH/CD/CA (closing-marktconsensus)
   eerst, dan MarketAvg, dan Bet365/Pinnacle.
3. `buildMatchStore` vult `mk`/`mh` vanuit het bestand wanneer een review geen
   `oddsAtPrediction` heeft, en markeert die records met `mks: "fdc"`.
   Pre-match captures houden altijd voorrang en blijven ongemarkeerd.
4. `marketBaselineReport` telt `nPreMatch` en `nMarketFile` apart, zodat in
   `monitor/model-report.json` zichtbaar blijft hoe groot de steekproef per
   bron is.

Beide bronnen liggen voor de uitslag (closing koersen zijn pre-kickoff), dus
de marktvergelijking blijft lek-vrij. Als modelinput gelden alleen
`oddsAtPrediction`-captures met `capturedAt <= cutoffAt` - de vorige sectie.
