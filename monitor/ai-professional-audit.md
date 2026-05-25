# FootyAI professionele AI-audit

Gegenereerd: 2026-05-25T18:23:47.429Z
Bron: https://voorspellingenprive.vercel.app

## Samenvatting
Professionele audit actief. Grootste aandachtspunt: prediction_id, generated_at / cutoff_at, Brier/log loss/ROI/CLV.

## Live status
- Wedstrijden vandaag: 1
- Voorspellingen vandaag: 1
- Reviews: 660
- Worker: v20-competition-squad-archive
- Feature coverage: 100%
- Odds coverage: 0%
- Gemiddelde datacompleetheid: 65%
- Exact hitrate: 12.1%
- Uitkomst hitrate: 41.5%
- Topkans hitrate: 46.7%

## Opslag-audit
- prediction_id: mist (kritiek) - Voeg een stabiele prediction_id toe per voorspelling.
- generated_at / cutoff_at: mist (kritiek) - Sla tijdstip en cutoff expliciet op zodat latere uitslagen geen input kunnen worden.
- featureVector: aanwezig (hoog) - Maak de featureVector immutable per prediction_id.
- model_version: aanwezig (hoog) - Gebruik naast ensembleMeta ook workerVersion en feature_schema_version.
- odds_at_prediction: aanwezig (hoog) - Sla bookmaker, markt, odds en timestamp op.
- Brier/log loss/ROI/CLV: mist (kritiek) - Voeg evaluatiemetrics toe aan postMatchReviews en /api/history.

## Top verbeteringen
1. Maak pre-match voorspellingen immutable - impact zeer hoog, moeite middel. Overschrijf voorspellingen nooit bij latere worker-runs.
2. Dwing data-cutoff voor kickoff af - impact zeer hoog, moeite middel. Gebruik alleen data die voor generated_at/cutoff_at beschikbaar was.
3. Voeg Brier score, log loss, CLV en ROI toe - impact zeer hoog, moeite laag-middel. Dit maakt leren en kalibratie meetbaar.
4. Bereid database-opslag voor - impact hoog, moeite middel. Gebruik JSON/GitHub als exportlaag, niet als definitieve prediction store.
5. Splits de worker in domeinmodules - impact hoog, moeite middel. Scheid bronnen, normalisatie, features, model, evaluatie en opslag.

## Volgende actie
Start met immutable prediction snapshots en Brier/log loss. Pas daarna zwaarder trainen of modelgewichten aanpassen.
