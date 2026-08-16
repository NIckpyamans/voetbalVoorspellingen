# FootyAI professionele AI-audit

Gegenereerd: 2026-08-16T12:03:35.963Z
Bron: https://voetbalvoorspellingen-clean.vercel.app

## Samenvatting
Professionele audit actief. Kritieke opslagvelden lijken aanwezig; blijf kalibratie en bronkwaliteit bewaken.

## Live status
- Wedstrijden vandaag: 18
- Voorspellingen vandaag: 18
- Reviews: 1068
- Prediction snapshots: 25
- Worker: v23-calibrated-odds-ledger
- Feature coverage: 37%
- Echte odds coverage: 0%
- Alleen historisch marktprofiel: 22%
- Gemiddelde datacompleetheid: 75%
- Datacompleetheid-audit: onbekend
- Odds readiness: onbekend

## Recente keten (14 dagen)
- Afgeronde wedstrijden met eindstand: 32/32 (100%)
- Geëvalueerde wedstrijden: 32/32 (100%)
- Snapshot-backed reviews: 22 (69%)
- Uitkomsthit: 25%
- Exacte-scorehit: 6%
- Gemiddelde Brier score: 0.757
- Gemiddelde log loss: 1.240
- Echte odds: 0%
- Confirmed lineups: 0%

## Segmenten
- club_friendlies: 23 reviews, uitkomst 30%, exact 9%, Brier 0.740
- european_knockout: 1 reviews, uitkomst 0%, exact 0%, Brier 0.624
- domestic_competitions: 8 reviews, uitkomst 13%, exact 0%, Brier 0.823

## Opslag-audit
- prediction_id: aanwezig; gate voldaan
- generated_at / cutoff_at: aanwezig; gate voldaan
- featureVector: aanwezig; gate voldaan
- model_version: aanwezig; gate voldaan
- odds_at_prediction: mist (hoog) - Sla echte bookmaker, markt, odds en timestamp op; historische marktprofielen tellen niet als ROI-basis.
- odds_status / missing_reason: aanwezig; gate voldaan
- Brier/log loss: aanwezig; gate voldaan
- ROI/CLV met echte odds: mist (hoog) - Bereken ROI/CLV pas wanneer odds_at_prediction en closing_odds echt gevuld zijn.
- leakage_guard: aanwezig; gate voldaan
- feature_source_metadata: aanwezig; gate voldaan

## Aantoonbaar afgerond
- Recente eindstanden en evaluaties zijn vrijwel volledig opgeslagen.
- Professionele snapshotgate gehaald met 392 unieke geëvalueerde wedstrijden.

## Open verbeteringen
1. P1 Vul opening-, prematch- en closing odds. Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
2. P1 Verhoog confirmed-lineupdekking. Haal alleen rond T-75, T-45 en T-20 op en rapporteer dekking per competitie en provider.
3. P1 Herstel Neon-quota of verlaag datatransfer. R2 houdt de leerlijn beschikbaar, maar relationele writes en monitors blijven beperkt zolang Neon HTTP 402 geeft.
4. P2 Kalibreer league en fase in shadow mode. Gebruik de volwassen club-only set, vergelijk Brier/log loss per segment en promoveer alleen aantoonbaar betere gewichten.
5. P2 Koppel recente reviews vaker aan immutable snapshots. Verhoog de recente snapshot-backed reviewdekking naar minimaal 80%; gebruik actuele prediction fallback niet voor modelpromotie.

## Volgende actie
Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn.
