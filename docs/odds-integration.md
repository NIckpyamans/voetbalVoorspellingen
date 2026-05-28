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
