# Worker Modularisatieplan

Laatst bijgewerkt: 2026-06-03T09:54:08.739Z

## Doel
Splits scripts/server-worker.js zonder voorspelgedrag te veranderen. Iedere stap behoudt dezelfde output in server_data.json en data/*.json.

## Doelmodules
- scripts/worker/data-collection.js: bronnen ophalen, fetch timeouts, rate-limit circuits, OpenFootball, Understat, FBref en source diagnostics. BBC/ESPN volgen apart.
- shared/matchNormalization.js + scripts/worker/validation.js: teamnamen, statussen, score parsing, dedupe, result backfill en H2H-contracten. Eerste stap is actief.
- feature-builder: vorm, H2H, xG, ELO, lineups, injuries, weather, market features.
- scripts/worker/prediction.js: Poisson, Monte Carlo, ensemble, scorematrix, 1X2-calibratie. Eerste pure math-stap is actief.
- scripts/worker/learning.js: post-match reviews, Brier/log loss, ROI/CLV, calibration profiles.
- scripts/worker/archive.js: JSON export, competition archives, standings snapshots en later database writes.

## Veilige volgorde
1. Extract pure helpers zonder side effects.
2. Voeg contracttests toe op bestaande worker-output.
3. Verplaats normalisatie naar shared module. Eerste stap is actief via shared/matchNormalization.js.
4. Verplaats storage/archive-output. Eerste stap is actief via scripts/worker/archive.js.
5. Verplaats prediction-engine pas na snapshot/regression lock. Eerste pure math-stap is actief via scripts/worker/prediction.js.
6. Activeer database writes pas als JSON-output identiek blijft.
7. Verplaats BBC/ESPN event-fetchers apart, inclusief logo-cache en status/minute mapping tests.

## Gedragsregels
- Geen nieuwe databronnen tijdens extractie.
- Geen modelgewicht aanpassen tijdens modularisatie.
- Elke stap moet npm run check, readiness, regressions en build halen.
