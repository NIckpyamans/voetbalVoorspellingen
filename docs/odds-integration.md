# Odds integration plan

Doel: ROI en CLV alleen berekenen op echte bookmaker odds die voor de wedstrijd zijn vastgelegd.

## Status

- Historische football-data.co.uk marktprofielen zijn gekoppeld voor calibratie.
- Echte `odds_at_prediction` staan nog niet in de dataset.
- `roiStatus` en `clvStatus` voorkomen dat ontbrekende odds als meetbare performance worden gezien.

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

## Environment

Ondersteunde voorbereidende env vars:

- `ODDS_API_KEY`
- `THE_ODDS_API_KEY`
- `FOOTBALL_DATA_TOKEN`

Zonder provider blijft `oddsStatus` bewust `historical_market_profile_only` of `missing`.
