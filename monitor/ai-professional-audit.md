# FootyAI professionele AI-audit

Gegenereerd: 2026-05-26T05:35:55.121Z
Bron: https://voorspellingenprive.vercel.app

## Samenvatting
Professionele audit actief. Kritieke opslagvelden lijken aanwezig; blijf kalibratie en bronkwaliteit bewaken.

## Live status
- Wedstrijden vandaag: 1
- Voorspellingen vandaag: 1
- Reviews: 661
- Prediction snapshots: 2
- Worker: v20-competition-squad-archive
- Feature coverage: 100%
- Odds coverage: 0%
- Gemiddelde datacompleetheid: 74%

## Opslag-audit
- prediction_id: aanwezig (kritiek) - Voeg een stabiele prediction_id toe per voorspelling.
- generated_at / cutoff_at: aanwezig (kritiek) - Sla tijdstip en cutoff expliciet op zodat latere uitslagen geen input kunnen worden.
- featureVector: aanwezig (hoog) - Aanwezig waar predictions gevuld zijn; maak hem immutable per prediction_id.
- model_version: aanwezig (hoog) - Gebruik naast ensembleMeta ook workerVersion en feature_schema_version.
- odds_at_prediction: aanwezig (hoog) - Sla bookmaker, markt, odds en timestamp op.
- Brier/log loss/ROI/CLV: aanwezig (kritiek) - Voeg evaluatiemetrics toe aan postMatchReviews en /api/history.

## Top verbeteringen
1. Maak pre-match voorspellingen immutable - impact zeer hoog, moeite middel. Sla prediction_id, generated_at, cutoff_at, model_version, feature_schema_version, input_snapshot_hash en result_status op. Overschrijf deze records nooit bij latere worker-runs.
2. Dwing data-cutoff voor kickoff af - impact zeer hoog, moeite middel. Filter vorm, H2H, standings, odds, blessures en lineups op informatie die beschikbaar was voor generated_at/cutoff_at. Markeer elk veld met source_timestamp en as_of.
3. Voeg Brier score, log loss, CLV en ROI toe - impact zeer hoog, moeite laag-middel. Bereken per review Brier score en log loss op 1X2. Voeg ROI en closing line value toe zodra odds_at_prediction en closing_odds gevuld zijn.
4. Bereid database-opslag voor - impact hoog, moeite middel. Gebruik JSON/GitHub als exportlaag, maar ontwerp een schema voor matches, predictions, features, results en evaluations in Postgres of Supabase.
5. Splits de worker in domeinmodules - impact hoog, moeite middel. Splits data sources, normalisatie, feature builder, model, evaluation en storage. Dit maakt competities, bronnen en modellen makkelijker uitbreidbaar.

## Volgende actie
Start met immutable prediction snapshots en Brier/log loss. Pas daarna zwaarder trainen of modelgewichten aanpassen.
