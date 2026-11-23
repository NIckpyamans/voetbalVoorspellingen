# FootyAI professionele AI-audit

Gegenereerd: 2026-11-23T18:16:59.361Z
Bron: https://voetbalvoorspellingen-clean.vercel.app

## Samenvatting
Professionele audit actief. Kritieke opslagvelden lijken aanwezig; blijf kalibratie en bronkwaliteit bewaken.

## Live status
- Wedstrijden vandaag: 6
- Voorspellingen vandaag: 6
- Reviews: 2153
- Prediction snapshotrijen: 25
- Unieke snapshotwedstrijden: 80
- Snapshot-evaluatie: 75/80 unieke fixtures; 160 rijen
- Dagbestanden: 88/89 unieke fixtures; 1 dubbele rijen
- Worker: v25-club-rating
- Auditversheid: fresh
- Feature coverage: 100%
- Echte odds coverage: 8%
- Alleen historisch marktprofiel: 7%
- Gemiddelde datacompleetheid: 99%
- Datacompleetheid-audit: onbekend
- Odds readiness: onbekend

## Recente keten (14 dagen)
- Afgeronde wedstrijden met eindstand: 83/83 (100%)
- Geëvalueerde wedstrijden: 84/83 (101%)
- Snapshot-backed reviews: 76 (90%)
- Uitkomsthit: 56%
- Exacte-scorehit: 7%
- Gemiddelde Brier score: 0.597
- Gemiddelde log loss: 1.002
- Echte odds: 8%
- Confirmed lineups: 0%

## Segmenten
- club_friendlies: 0 reviews, uitkomst onbekend, exact onbekend, Brier onbekend
- european_knockout: 0 reviews, uitkomst onbekend, exact onbekend, Brier onbekend
- domestic_competitions: 84 reviews, uitkomst 56%, exact 7%, Brier 0.597

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
- Shadowkalibratie gecontroleerd op 347 unieke wedstrijdsamples; geen profiel voldeed aan de promotiedrempel.

## Open verbeteringen
1. P1 Vul opening-, prematch- en closing odds. Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
2. P1 Verhoog confirmed-lineupdekking. Haal alleen rond T-75, T-45 en T-20 op en rapporteer dekking per competitie en provider.
3. P1 Herstel Neon-quota of verlaag datatransfer. R2 houdt de leerlijn beschikbaar, maar relationele writes en monitors blijven beperkt zolang Neon HTTP 402 geeft.

## Volgende actie
Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
