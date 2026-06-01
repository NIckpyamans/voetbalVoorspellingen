# FootyAI professionele AI-audit

Gegenereerd: 2026-06-01T12:22:01.191Z
Bron: https://voorspellingenprive.vercel.app

## Samenvatting
Professionele audit actief, maar live fetch is beperkt: snapshots.

## Live status
- Wedstrijden vandaag: 0
- Voorspellingen vandaag: 0
- Reviews: 682
- Prediction snapshots: 0
- Worker: v23-calibrated-odds-ledger
- Feature coverage: 0%
- Echte odds coverage: 0%
- Alleen historisch marktprofiel: 0%
- Gemiddelde datacompleetheid: onbekend
- Datacompleetheid-audit: onbekend
- Odds readiness: onbekend

## Opslag-audit
- prediction_id: mist (kritiek) - Voeg een stabiele prediction_id toe per voorspelling.
- generated_at / cutoff_at: mist (kritiek) - Sla tijdstip en cutoff expliciet op zodat latere uitslagen geen input kunnen worden.
- featureVector: mist (hoog) - Aanwezig waar predictions gevuld zijn; maak hem immutable per prediction_id.
- model_version: mist (hoog) - Gebruik naast ensembleMeta ook workerVersion en feature_schema_version.
- odds_at_prediction: mist (hoog) - Sla echte bookmaker, markt, odds en timestamp op; historische marktprofielen tellen niet als ROI-basis.
- odds_status / missing_reason: mist (hoog) - Markeer per voorspelling of odds echt, deels, historisch-only of ontbrekend zijn.
- Brier/log loss: mist (kritiek) - Bereken evaluatiemetrics op 1X2 per postMatchReview.
- ROI/CLV met echte odds: mist (hoog) - Bereken ROI/CLV pas wanneer odds_at_prediction en closing_odds echt gevuld zijn.
- leakage_guard: mist (kritiek) - Leg cutoff_before_kickoff, snapshot_backed en source_timestamp dekking vast.
- feature_source_metadata: mist (hoog) - Leg per feature bron, as_of en source_timestamp dekking vast.

## Top verbeteringen
1. Maak pre-match voorspellingen immutable - impact zeer hoog, moeite middel. Sla prediction_id, generated_at, cutoff_at, model_version, feature_schema_version, input_snapshot_hash en result_status op. Overschrijf deze records nooit bij latere worker-runs.
2. Dwing data-cutoff voor kickoff af - impact zeer hoog, moeite middel. Filter vorm, H2H, standings, odds, blessures en lineups op informatie die beschikbaar was voor generated_at/cutoff_at. Markeer elk veld met source_timestamp en as_of.
3. Voeg Brier score, log loss, CLV en ROI toe - impact zeer hoog, moeite laag-middel. Bereken per review Brier score en log loss op 1X2. Voeg ROI en closing line value toe zodra odds_at_prediction en closing_odds gevuld zijn.
4. Bereid database-opslag voor - impact hoog, moeite middel. Gebruik JSON/GitHub als exportlaag, maar ontwerp een schema voor matches, predictions, features, results en evaluations in Postgres of Supabase.
5. Splits de worker in domeinmodules - impact hoog, moeite middel. Splits data sources, normalisatie, feature builder, model, evaluation en storage. Dit maakt competities, bronnen en modellen makkelijker uitbreidbaar.

## Volgende actie
Verbeter nu odds-inname en source_timestamp dekking; train pas zwaarder wanneer ROI/CLV op echte odds gebaseerd zijn.
