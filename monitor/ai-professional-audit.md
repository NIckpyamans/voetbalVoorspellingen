# FootyAI professionele AI-audit

Gegenereerd: 2026-10-26T13:10:00.690Z
Bron: https://voetbalvoorspellingen-clean.vercel.app

## Samenvatting
Professionele audit actief. Kritieke opslagvelden lijken aanwezig; blijf kalibratie en bronkwaliteit bewaken.

## Live status
- Wedstrijden vandaag: 3
- Voorspellingen vandaag: 3
- Reviews: 1116
- Prediction snapshotrijen: 25
- Unieke snapshotwedstrijden: 34
- Snapshot-evaluatie: 0/34 unieke fixtures; 34 rijen
- Dagbestanden: 275/286 unieke fixtures; 11 dubbele rijen
- Worker: v25-club-rating
- Auditversheid: fresh
- Feature coverage: 100%
- Echte odds coverage: 45%
- Alleen historisch marktprofiel: 15%
- Gemiddelde datacompleetheid: 95%
- Datacompleetheid-audit: onbekend
- Odds readiness: onbekend

## Recente keten (14 dagen)
- Afgeronde wedstrijden met eindstand: 242/242 (100%)
- Geëvalueerde wedstrijden: 242/242 (100%)
- Snapshot-backed reviews: 0 (0%)
- Uitkomsthit: 56%
- Exacte-scorehit: 8%
- Gemiddelde Brier score: 0.568
- Gemiddelde log loss: 0.958
- Echte odds: 45%
- Confirmed lineups: 0%

## Segmenten
- club_friendlies: 0 reviews, uitkomst onbekend, exact onbekend, Brier onbekend
- european_knockout: 78 reviews, uitkomst 62%, exact 10%, Brier 0.537
- domestic_competitions: 164 reviews, uitkomst 54%, exact 7%, Brier 0.583

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
2. P1 Verhoog confirmed-lineupdekking. Haal alleen rond T-75, T-45 en T-20 op en rapporteer dekking per competitie en provider.
3. P1 Herstel Neon-quota of verlaag datatransfer. R2 houdt de leerlijn beschikbaar, maar relationele writes en monitors blijven beperkt zolang Neon HTTP 402 geeft.
4. P2 Kalibreer league en fase in shadow mode. Gebruik de volwassen club-only set, vergelijk Brier/log loss per segment en promoveer alleen aantoonbaar betere gewichten.
5. P2 Koppel recente reviews vaker aan immutable snapshots. Verhoog de recente snapshot-backed reviewdekking naar minimaal 80%; gebruik actuele prediction fallback niet voor modelpromotie.

## Volgende actie
Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
