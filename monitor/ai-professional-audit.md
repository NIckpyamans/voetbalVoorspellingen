# FootyAI professionele AI-audit

Gegenereerd: 2026-08-31T06:43:52.123Z
Bron: https://voetbalvoorspellingen-clean.vercel.app

## Samenvatting
Professionele audit actief, maar live fetch is beperkt: matches, predict, history, snapshots.

## Live status
- Wedstrijden vandaag: 0
- Voorspellingen vandaag: 228
- Reviews: 0
- Prediction snapshots: 168
- Worker: unknown
- Feature coverage: 100%
- Echte odds coverage: 6%
- Alleen historisch marktprofiel: 2%
- Gemiddelde datacompleetheid: 86%
- Datacompleetheid-audit: onbekend
- Odds readiness: onbekend

## Recente keten (14 dagen)
- Afgeronde wedstrijden met eindstand: 224/224 (100%)
- Geëvalueerde wedstrijden: 224/224 (100%)
- Snapshot-backed reviews: 80 (36%)
- Uitkomsthit: 50%
- Exacte-scorehit: 8%
- Gemiddelde Brier score: 0.486
- Gemiddelde log loss: 1.023
- Echte odds: 6%
- Confirmed lineups: 29%

## Segmenten
- club_friendlies: 0 reviews, uitkomst onbekend, exact onbekend, Brier onbekend
- european_knockout: 121 reviews, uitkomst 52%, exact 8%, Brier 0.497
- domestic_competitions: 103 reviews, uitkomst 47%, exact 8%, Brier 0.472

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
