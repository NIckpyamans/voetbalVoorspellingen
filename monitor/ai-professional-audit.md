# FootyAI professionele AI-audit

Gegenereerd: 2026-08-13T12:41:58.975Z
Bron: https://voetbalvoorspellingen-clean.vercel.app

## Samenvatting
Professionele audit actief, maar live fetch is beperkt: matches, predict, history, snapshots.

## Live status
- Wedstrijden vandaag: 0
- Voorspellingen vandaag: 228
- Reviews: 0
- Prediction snapshots: 382
- Worker: unknown
- Feature coverage: 16%
- Echte odds coverage: 0%
- Alleen historisch marktprofiel: 16%
- Gemiddelde datacompleetheid: 75%
- Datacompleetheid-audit: onbekend
- Odds readiness: onbekend

## Recente keten (14 dagen)
- Afgeronde wedstrijden met eindstand: 189/189 (100%)
- Geëvalueerde wedstrijden: 189/189 (100%)
- Snapshot-backed reviews: 185 (98%)
- Uitkomsthit: 43%
- Exacte-scorehit: 8%
- Gemiddelde Brier score: 0.230
- Gemiddelde log loss: 1.093
- Echte odds: 0%
- Confirmed lineups: 0%

## Segmenten
- club_friendlies: 129 reviews, uitkomst 40%, exact 7%, Brier 0.232
- european_knockout: 49 reviews, uitkomst 49%, exact 10%, Brier 0.205
- domestic_competitions: 11 reviews, uitkomst 45%, exact 18%, Brier 0.317

## Opslag-audit
- prediction_id: aanwezig; gate voldaan
- generated_at / cutoff_at: aanwezig; gate voldaan
- featureVector: aanwezig; gate voldaan
- model_version: aanwezig; gate voldaan
- odds_at_prediction: mist (hoog) - Sla echte bookmaker, markt, odds en timestamp op; historische marktprofielen tellen niet als ROI-basis.
- odds_status / missing_reason: aanwezig; gate voldaan
- Brier/log loss: aanwezig; gate voldaan
- ROI/CLV met echte odds: mist (hoog) - Bereken ROI/CLV pas wanneer odds_at_prediction en closing_odds echt gevuld zijn.
- leakage_guard: aanwezig; gate voldaan
- feature_source_metadata: aanwezig; gate voldaan

## Aantoonbaar afgerond
- Recente eindstanden en evaluaties zijn vrijwel volledig opgeslagen.
- Professionele snapshotgate gehaald met 227 unieke geëvalueerde wedstrijden.
- Shadowkalibratie gecontroleerd op 283 unieke wedstrijdsamples; geen profiel voldeed aan de promotiedrempel.

## Open verbeteringen
1. P1 Vul opening-, prematch- en closing odds. Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
2. P1 Verhoog confirmed-lineupdekking. Haal alleen rond T-75, T-45 en T-20 op en rapporteer dekking per competitie en provider.
3. P1 Herstel Neon-quota of verlaag datatransfer. R2 houdt de leerlijn beschikbaar, maar relationele writes en monitors blijven beperkt zolang Neon HTTP 402 geeft.

## Volgende actie
Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
