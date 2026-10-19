# FootyAI professionele AI-audit

Gegenereerd: 2026-10-19T13:24:26.262Z
Bron: https://voetbalvoorspellingen-clean.vercel.app

## Samenvatting
Professionele audit actief. Kritieke opslagvelden lijken aanwezig; blijf kalibratie en bronkwaliteit bewaken.

## Live status
- Wedstrijden vandaag: 5
- Voorspellingen vandaag: 5
- Reviews: 1114
- Prediction snapshotrijen: 25
- Unieke snapshotwedstrijden: 35
- Snapshot-evaluatie: 0/35 unieke fixtures; 35 rijen
- Dagbestanden: 220/226 unieke fixtures; 6 dubbele rijen
- Worker: v25-club-rating
- Auditversheid: fresh
- Feature coverage: 100%
- Echte odds coverage: 28%
- Alleen historisch marktprofiel: 20%
- Gemiddelde datacompleetheid: 94%
- Datacompleetheid-audit: onbekend
- Odds readiness: onbekend

## Recente keten (14 dagen)
- Afgeronde wedstrijden met eindstand: 180/180 (100%)
- Geëvalueerde wedstrijden: 180/180 (100%)
- Snapshot-backed reviews: 0 (0%)
- Uitkomsthit: 60%
- Exacte-scorehit: 8%
- Gemiddelde Brier score: 0.560
- Gemiddelde log loss: 0.947
- Echte odds: 28%
- Confirmed lineups: 0%

## Segmenten
- club_friendlies: 0 reviews, uitkomst onbekend, exact onbekend, Brier onbekend
- european_knockout: 19 reviews, uitkomst 53%, exact 0%, Brier 0.577
- domestic_competitions: 161 reviews, uitkomst 61%, exact 9%, Brier 0.558

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
