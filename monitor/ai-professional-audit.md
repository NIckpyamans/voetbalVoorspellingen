# FootyAI professionele AI-audit

Gegenereerd: 2026-09-28T14:02:34.652Z
Bron: https://voetbalvoorspellingen-clean.vercel.app

## Samenvatting
Professionele audit actief. Kritieke opslagvelden lijken aanwezig; blijf kalibratie en bronkwaliteit bewaken.

## Live status
- Wedstrijden vandaag: 0
- Voorspellingen vandaag: 114
- Reviews: 1734
- Prediction snapshots: 25
- Worker: v18-score-data-scout
- Feature coverage: 0%
- Echte odds coverage: 8%
- Alleen historisch marktprofiel: 0%
- Gemiddelde datacompleetheid: 95%
- Datacompleetheid-audit: onbekend
- Odds readiness: onbekend

## Recente keten (14 dagen)
- Afgeronde wedstrijden met eindstand: 114/114 (100%)
- Geëvalueerde wedstrijden: 114/114 (100%)
- Snapshot-backed reviews: 30 (26%)
- Uitkomsthit: 53%
- Exacte-scorehit: 9%
- Gemiddelde Brier score: 0.566
- Gemiddelde log loss: 0.975
- Echte odds: 8%
- Confirmed lineups: 0%

## Segmenten
- club_friendlies: 0 reviews, uitkomst onbekend, exact onbekend, Brier onbekend
- european_knockout: 18 reviews, uitkomst 61%, exact 6%, Brier 0.528
- domestic_competitions: 96 reviews, uitkomst 51%, exact 9%, Brier 0.573

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
- Shadowkalibratie gecontroleerd op 151 unieke wedstrijdsamples; geen profiel voldeed aan de promotiedrempel.

## Open verbeteringen
1. P1 Vul opening-, prematch- en closing odds. Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
2. P1 Verhoog confirmed-lineupdekking. Haal alleen rond T-75, T-45 en T-20 op en rapporteer dekking per competitie en provider.
3. P1 Herstel Neon-quota of verlaag datatransfer. R2 houdt de leerlijn beschikbaar, maar relationele writes en monitors blijven beperkt zolang Neon HTTP 402 geeft.
4. P2 Koppel recente reviews vaker aan immutable snapshots. Verhoog de recente snapshot-backed reviewdekking naar minimaal 80%; gebruik actuele prediction fallback niet voor modelpromotie.

## Volgende actie
Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
