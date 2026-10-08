# FootyAI professionele AI-audit

Gegenereerd: 2026-10-08T13:36:59.098Z
Bron: https://voetbalvoorspellingen-clean.vercel.app

## Samenvatting
Professionele audit actief. Kritieke opslagvelden lijken aanwezig; blijf kalibratie en bronkwaliteit bewaken.

## Live status
- Wedstrijden vandaag: 0
- Voorspellingen vandaag: 16
- Reviews: 1742
- Prediction snapshotrijen: 25
- Unieke snapshotwedstrijden: 8
- Snapshot-evaluatie: 8/8 unieke fixtures; 8 rijen
- Dagbestanden: 16/16 unieke fixtures; 0 dubbele rijen
- Worker: v18-score-data-scout
- Auditversheid: fresh
- Feature coverage: 0%
- Echte odds coverage: 0%
- Alleen historisch marktprofiel: 0%
- Gemiddelde datacompleetheid: 97%
- Datacompleetheid-audit: onbekend
- Odds readiness: onbekend

## Recente keten (14 dagen)
- Afgeronde wedstrijden met eindstand: 16/16 (100%)
- Geëvalueerde wedstrijden: 16/16 (100%)
- Snapshot-backed reviews: 8 (50%)
- Uitkomsthit: 56%
- Exacte-scorehit: 6%
- Gemiddelde Brier score: 0.632
- Gemiddelde log loss: 1.053
- Echte odds: 0%
- Confirmed lineups: 0%

## Segmenten
- club_friendlies: 0 reviews, uitkomst onbekend, exact onbekend, Brier onbekend
- european_knockout: 0 reviews, uitkomst onbekend, exact onbekend, Brier onbekend
- domestic_competitions: 16 reviews, uitkomst 56%, exact 6%, Brier 0.632

## Opslag-audit
- prediction_id: aanwezig; gate voldaan
- generated_at / cutoff_at: aanwezig; gate voldaan
- featureVector: mist (hoog) - Aanwezig waar predictions gevuld zijn; maak hem immutable per prediction_id.
- model_version: aanwezig; gate voldaan
- odds_at_prediction: mist (hoog) - Sla echte bookmaker, markt, odds en timestamp op; historische marktprofielen tellen niet als ROI-basis.
- odds_status / missing_reason: aanwezig; gate voldaan
- Brier/log loss: aanwezig; gate voldaan
- ROI/CLV met echte odds: mist (hoog) - Bereken ROI/CLV pas wanneer odds_at_prediction en closing_odds echt gevuld zijn.
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
