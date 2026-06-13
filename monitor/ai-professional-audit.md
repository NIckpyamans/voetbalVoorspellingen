# FootyAI professionele AI-audit

Gegenereerd: 2026-06-13T07:48:16.909Z
Bron: https://voetbalvoorspellingen-clean.vercel.app

## Samenvatting
Professionele audit actief. Kritieke opslagvelden lijken aanwezig; blijf kalibratie en bronkwaliteit bewaken.

## Live status
- Wedstrijden vandaag: 3
- Voorspellingen vandaag: 3
- Reviews: 691
- Prediction snapshots: 25
- Worker: v23-calibrated-odds-ledger
- Feature coverage: 0%
- Echte odds coverage: 0%
- Alleen historisch marktprofiel: 0%
- Gemiddelde datacompleetheid: 44%
- Datacompleetheid-audit: Geen wedstrijden voor datacompleetheid-audit.
- Odds readiness: Maak de odds-secret flow compleet: ODDS_API_URL_TEMPLATE plus ODDS_API_KEY/THE_ODDS_API_KEY zijn samen nodig.

## Opslag-audit
- prediction_id: aanwezig (kritiek) - Voeg een stabiele prediction_id toe per voorspelling.
- generated_at / cutoff_at: aanwezig (kritiek) - Sla tijdstip en cutoff expliciet op zodat latere uitslagen geen input kunnen worden.
- featureVector: aanwezig (hoog) - Aanwezig waar predictions gevuld zijn; maak hem immutable per prediction_id.
- model_version: aanwezig (hoog) - Gebruik naast ensembleMeta ook workerVersion en feature_schema_version.
- odds_at_prediction: mist (hoog) - Sla echte bookmaker, markt, odds en timestamp op; historische marktprofielen tellen niet als ROI-basis.
- odds_status / missing_reason: aanwezig (hoog) - Markeer per voorspelling of odds echt, deels, historisch-only of ontbrekend zijn.
- Brier/log loss: aanwezig (kritiek) - Bereken evaluatiemetrics op 1X2 per postMatchReview.
- ROI/CLV met echte odds: mist (hoog) - Bereken ROI/CLV pas wanneer odds_at_prediction en closing_odds echt gevuld zijn.
- leakage_guard: aanwezig (kritiek) - Leg cutoff_before_kickoff, snapshot_backed en source_timestamp dekking vast.
- feature_source_metadata: aanwezig (hoog) - Leg per feature bron, as_of en source_timestamp dekking vast.

## Top verbeteringen
1. Maak pre-match voorspellingen immutable - impact zeer hoog, moeite middel. Sla prediction_id, generated_at, cutoff_at, model_version, feature_schema_version, input_snapshot_hash en result_status op. Overschrijf deze records nooit bij latere worker-runs.
2. Dwing data-cutoff voor kickoff af - impact zeer hoog, moeite middel. Filter vorm, H2H, standings, odds, blessures en lineups op informatie die beschikbaar was voor generated_at/cutoff_at. Markeer elk veld met source_timestamp en as_of.
3. Voeg Brier score, log loss, CLV en ROI toe - impact zeer hoog, moeite laag-middel. Bereken per review Brier score en log loss op 1X2. Voeg ROI en closing line value toe zodra odds_at_prediction en closing_odds gevuld zijn.
4. Breid Neon-opslag gecontroleerd uit - impact hoog, moeite middel. Neon is actief. Migreer resterende JSON-afhankelijke widgets per contract naar Neon en behoud JSON/GitHub alleen als compatibele export- en fallbacklaag.
5. Splits de worker in domeinmodules - impact hoog, moeite middel. Splits data sources, normalisatie, feature builder, model, evaluation en storage. Dit maakt competities, bronnen en modellen makkelijker uitbreidbaar.

## Volgende actie
Verbeter nu odds-inname en source_timestamp dekking; train pas zwaarder wanneer ROI/CLV op echte odds gebaseerd zijn.
