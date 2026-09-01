# FootyAI professionele AI-audit

Gegenereerd: 2026-09-01T11:43:49.890Z
Bron: https://voetbalvoorspellingen-clean.vercel.app

## Samenvatting
Professionele audit actief, maar live fetch is beperkt: snapshots.

## Live status
- Wedstrijden vandaag: 8
- Voorspellingen vandaag: 8
- Reviews: 1042
- Prediction snapshots: 274
- Worker: v24-monte-carlo-average
- Feature coverage: 100%
- Echte odds coverage: 7%
- Alleen historisch marktprofiel: 3%
- Gemiddelde datacompleetheid: 85%
- Datacompleetheid-audit: onbekend
- Odds readiness: onbekend

## Recente keten (14 dagen)
- Afgeronde wedstrijden met eindstand: 242/242 (100%)
- Geëvalueerde wedstrijden: 242/242 (100%)
- Snapshot-backed reviews: 178 (74%)
- Uitkomsthit: 50%
- Exacte-scorehit: 8%
- Gemiddelde Brier score: 0.305
- Gemiddelde log loss: 1.026
- Echte odds: 7%
- Confirmed lineups: 30%

## Segmenten
- club_friendlies: 0 reviews, uitkomst onbekend, exact onbekend, Brier onbekend
- european_knockout: 121 reviews, uitkomst 52%, exact 8%, Brier 0.335
- domestic_competitions: 121 reviews, uitkomst 49%, exact 8%, Brier 0.275

## Opslag-audit
- prediction_id: aanwezig; gate voldaan
- generated_at / cutoff_at: aanwezig; gate voldaan
- featureVector: aanwezig; gate voldaan
- model_version: aanwezig; gate voldaan
- odds_at_prediction: aanwezig; gate voldaan
- odds_status / missing_reason: aanwezig; gate voldaan
- Brier/log loss: aanwezig; gate voldaan
- ROI/CLV met echte odds: aanwezig; gate voldaan
- leakage_guard: aanwezig; gate voldaan
- feature_source_metadata: aanwezig; gate voldaan

## Aantoonbaar afgerond
- Recente eindstanden en evaluaties zijn vrijwel volledig opgeslagen.
- Professionele snapshotgate gehaald met 523 unieke geëvalueerde wedstrijden.
- Shadowkalibratie gecontroleerd op 81 unieke wedstrijdsamples; geen profiel voldeed aan de promotiedrempel.

## Open verbeteringen
1. P1 Vul opening-, prematch- en closing odds. Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
2. P1 Herstel Neon-quota of verlaag datatransfer. R2 houdt de leerlijn beschikbaar, maar relationele writes en monitors blijven beperkt zolang Neon HTTP 402 geeft.
3. P2 Koppel recente reviews vaker aan immutable snapshots. Verhoog de recente snapshot-backed reviewdekking naar minimaal 80%; gebruik actuele prediction fallback niet voor modelpromotie.

## Volgende actie
Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
