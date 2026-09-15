# FootyAI professionele AI-audit

Gegenereerd: 2026-09-15T11:50:00.594Z
Bron: https://voetbalvoorspellingen-clean.vercel.app

## Samenvatting
Professionele audit actief. Kritieke opslagvelden lijken aanwezig; blijf kalibratie en bronkwaliteit bewaken.

## Live status
- Wedstrijden vandaag: 3
- Voorspellingen vandaag: 3
- Reviews: 1624
- Prediction snapshots: 25
- Worker: v25-club-rating
- Feature coverage: 100%
- Echte odds coverage: 49%
- Alleen historisch marktprofiel: 1%
- Gemiddelde datacompleetheid: 97%
- Datacompleetheid-audit: onbekend
- Odds readiness: onbekend

## Recente keten (14 dagen)
- Afgeronde wedstrijden met eindstand: 204/204 (100%)
- Geëvalueerde wedstrijden: 204/204 (100%)
- Snapshot-backed reviews: 140 (69%)
- Uitkomsthit: 42%
- Exacte-scorehit: 8%
- Gemiddelde Brier score: 0.562
- Gemiddelde log loss: 1.043
- Echte odds: 49%
- Confirmed lineups: 4%

## Segmenten
- club_friendlies: 0 reviews, uitkomst onbekend, exact onbekend, Brier onbekend
- european_knockout: 18 reviews, uitkomst 44%, exact 11%, Brier 0.650
- domestic_competitions: 186 reviews, uitkomst 42%, exact 8%, Brier 0.553

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
- Shadowkalibratie gecontroleerd op 1 unieke wedstrijdsamples; geen profiel voldeed aan de promotiedrempel.

## Open verbeteringen
1. P1 Vul opening-, prematch- en closing odds. Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
2. P1 Verhoog confirmed-lineupdekking. Haal alleen rond T-75, T-45 en T-20 op en rapporteer dekking per competitie en provider.
3. P1 Herstel Neon-quota of verlaag datatransfer. R2 houdt de leerlijn beschikbaar, maar relationele writes en monitors blijven beperkt zolang Neon HTTP 402 geeft.
4. P2 Koppel recente reviews vaker aan immutable snapshots. Verhoog de recente snapshot-backed reviewdekking naar minimaal 80%; gebruik actuele prediction fallback niet voor modelpromotie.

## Volgende actie
Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
