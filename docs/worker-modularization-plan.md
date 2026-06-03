# Worker Modularisatieplan

Laatst bijgewerkt: 2026-06-03T08:28:13.635Z

## Doel
Splits scripts/server-worker.js zonder voorspelgedrag te veranderen. Iedere stap behoudt dezelfde output in server_data.json en data/*.json.

## Doelmodules
- data-collection: bronnen ophalen, rate limits, retries, source diagnostics.
- normalization: teamnamen, statussen, scores, dedupe, result backfill.
- feature-builder: vorm, H2H, xG, ELO, lineups, injuries, weather, market features.
- prediction-engine: Poisson, Monte Carlo, ensemble, scorematrix, 1X2-calibratie.
- evaluation-learning: post-match reviews, Brier/log loss, ROI/CLV, calibration profiles.
- season-archive: competition archives, standings snapshots, season rollover.
- storage-writer: JSON export en later database writes.

## Veilige volgorde
1. Extract pure helpers zonder side effects.
2. Voeg contracttests toe op bestaande worker-output.
3. Verplaats normalisatie naar shared module.
4. Verplaats prediction-engine pas na snapshot/regression lock.
5. Activeer database writes pas als JSON-output identiek blijft.

## Gedragsregels
- Geen nieuwe databronnen tijdens extractie.
- Geen modelgewicht aanpassen tijdens modularisatie.
- Elke stap moet npm run check, readiness, regressions en build halen.
