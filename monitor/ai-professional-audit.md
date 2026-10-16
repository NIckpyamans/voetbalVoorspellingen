# FootyAI professionele AI-audit

Gegenereerd: 2026-10-16T06:39:18.314Z
Bron: https://voetbalvoorspellingen-clean.vercel.app

## Samenvatting
Professionele audit actief. Kritieke opslagvelden lijken aanwezig; blijf kalibratie en bronkwaliteit bewaken.

## Live status
- Wedstrijden vandaag: 15
- Voorspellingen vandaag: 15
- Reviews: 1075
- Prediction snapshotrijen: 25
- Unieke snapshotwedstrijden: 41
- Snapshot-evaluatie: 0/41 unieke fixtures; 41 rijen
- Dagbestanden: 166/172 unieke fixtures; 6 dubbele rijen
- Worker: v25-club-rating
- Auditversheid: fresh
- Feature coverage: 100%
- Echte odds coverage: 15%
- Alleen historisch marktprofiel: 33%
- Gemiddelde datacompleetheid: 93%
- Datacompleetheid-audit: onbekend
- Odds readiness: onbekend

## Recente keten (14 dagen)
- Afgeronde wedstrijden met eindstand: 116/116 (100%)
- Geëvalueerde wedstrijden: 116/116 (100%)
- Snapshot-backed reviews: 0 (0%)
- Uitkomsthit: 59%
- Exacte-scorehit: 7%
- Gemiddelde Brier score: 0.556
- Gemiddelde log loss: 0.941
- Echte odds: 15%
- Confirmed lineups: 0%

## Segmenten
- club_friendlies: 0 reviews, uitkomst onbekend, exact onbekend, Brier onbekend
- european_knockout: 19 reviews, uitkomst 53%, exact 0%, Brier 0.577
- domestic_competitions: 97 reviews, uitkomst 60%, exact 8%, Brier 0.552

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

## Open verbeteringen
1. P1 Vul opening-, prematch- en closing odds. Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
2. P1 Herstel Neon-quota of verlaag datatransfer. R2 houdt de leerlijn beschikbaar, maar relationele writes en monitors blijven beperkt zolang Neon HTTP 402 geeft.
3. P2 Kalibreer league en fase in shadow mode. Gebruik de volwassen club-only set, vergelijk Brier/log loss per segment en promoveer alleen aantoonbaar betere gewichten.
4. P2 Koppel recente reviews vaker aan immutable snapshots. Verhoog de recente snapshot-backed reviewdekking naar minimaal 80%; gebruik actuele prediction fallback niet voor modelpromotie.

## Volgende actie
Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
