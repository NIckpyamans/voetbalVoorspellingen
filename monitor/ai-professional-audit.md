# FootyAI professionele AI-audit

Gegenereerd: 2026-11-09T16:28:54.677Z
Bron: https://voetbalvoorspellingen-clean.vercel.app

## Samenvatting
Professionele audit actief. Kritieke opslagvelden lijken aanwezig; blijf kalibratie en bronkwaliteit bewaken.

## Live status
- Wedstrijden vandaag: 0
- Voorspellingen vandaag: 225
- Reviews: 2069
- Prediction snapshotrijen: 25
- Unieke snapshotwedstrijden: 99
- Snapshot-evaluatie: 99/99 unieke fixtures; 198 rijen
- Dagbestanden: 220/225 unieke fixtures; 5 dubbele rijen
- Worker: v18-score-data-scout
- Auditversheid: fresh
- Feature coverage: 0%
- Echte odds coverage: 75%
- Alleen historisch marktprofiel: 0%
- Gemiddelde datacompleetheid: 98%
- Datacompleetheid-audit: onbekend
- Odds readiness: onbekend

## Recente keten (14 dagen)
- Afgeronde wedstrijden met eindstand: 225/225 (100%)
- Geëvalueerde wedstrijden: 225/225 (100%)
- Snapshot-backed reviews: 99 (44%)
- Uitkomsthit: 57%
- Exacte-scorehit: 9%
- Gemiddelde Brier score: 0.574
- Gemiddelde log loss: 0.970
- Echte odds: 75%
- Confirmed lineups: 0%

## Segmenten
- club_friendlies: 0 reviews, uitkomst onbekend, exact onbekend, Brier onbekend
- european_knockout: 59 reviews, uitkomst 46%, exact 15%, Brier 0.606
- domestic_competitions: 166 reviews, uitkomst 61%, exact 7%, Brier 0.562

## Opslag-audit
- prediction_id: aanwezig; gate voldaan
- generated_at / cutoff_at: aanwezig; gate voldaan
- featureVector: mist (hoog) - Aanwezig waar predictions gevuld zijn; maak hem immutable per prediction_id.
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
- Shadowkalibratie gecontroleerd op 338 unieke wedstrijdsamples; geen profiel voldeed aan de promotiedrempel.
- Actuele oddsdekking is voldoende voor gecontroleerde marktevaluatie.

## Open verbeteringen
1. P1 Verhoog confirmed-lineupdekking. Haal alleen rond T-75, T-45 en T-20 op en rapporteer dekking per competitie en provider.
2. P1 Herstel Neon-quota of verlaag datatransfer. R2 houdt de leerlijn beschikbaar, maar relationele writes en monitors blijven beperkt zolang Neon HTTP 402 geeft.
3. P2 Koppel recente reviews vaker aan immutable snapshots. Verhoog de recente snapshot-backed reviewdekking naar minimaal 80%; gebruik actuele prediction fallback niet voor modelpromotie.

## Volgende actie
Haal alleen rond T-75, T-45 en T-20 op en rapporteer dekking per competitie en provider.
