# FootyAI professionele AI-audit

Gegenereerd: 2026-11-02T16:02:17.358Z
Bron: https://voetbalvoorspellingen-clean.vercel.app

## Samenvatting
Professionele audit actief. Kritieke opslagvelden lijken aanwezig; blijf kalibratie en bronkwaliteit bewaken.

## Live status
- Wedstrijden vandaag: 8
- Voorspellingen vandaag: 8
- Reviews: 1913
- Prediction snapshotrijen: 25
- Unieke snapshotwedstrijden: 7
- Snapshot-evaluatie: 0/7 unieke fixtures; 14 rijen
- Dagbestanden: 209/214 unieke fixtures; 5 dubbele rijen
- Worker: v25-club-rating
- Auditversheid: fresh
- Feature coverage: 100%
- Echte odds coverage: 72%
- Alleen historisch marktprofiel: 2%
- Gemiddelde datacompleetheid: 97%
- Datacompleetheid-audit: onbekend
- Odds readiness: onbekend

## Recente keten (14 dagen)
- Afgeronde wedstrijden met eindstand: 206/206 (100%)
- Geëvalueerde wedstrijden: 206/206 (100%)
- Snapshot-backed reviews: 0 (0%)
- Uitkomsthit: 57%
- Exacte-scorehit: 8%
- Gemiddelde Brier score: 0.551
- Gemiddelde log loss: 0.933
- Echte odds: 72%
- Confirmed lineups: 0%

## Segmenten
- club_friendlies: 0 reviews, uitkomst onbekend, exact onbekend, Brier onbekend
- european_knockout: 59 reviews, uitkomst 64%, exact 12%, Brier 0.523
- domestic_competitions: 147 reviews, uitkomst 54%, exact 7%, Brier 0.562

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
- Actuele oddsdekking is voldoende voor gecontroleerde marktevaluatie.

## Open verbeteringen
1. P1 Herstel Neon-quota of verlaag datatransfer. R2 houdt de leerlijn beschikbaar, maar relationele writes en monitors blijven beperkt zolang Neon HTTP 402 geeft.
2. P2 Kalibreer league en fase in shadow mode. Gebruik de volwassen club-only set, vergelijk Brier/log loss per segment en promoveer alleen aantoonbaar betere gewichten.
3. P2 Koppel recente reviews vaker aan immutable snapshots. Verhoog de recente snapshot-backed reviewdekking naar minimaal 80%; gebruik actuele prediction fallback niet voor modelpromotie.

## Volgende actie
R2 houdt de leerlijn beschikbaar, maar relationele writes en monitors blijven beperkt zolang Neon HTTP 402 geeft.
