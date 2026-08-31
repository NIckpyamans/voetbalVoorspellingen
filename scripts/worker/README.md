# Worker Modules

Deze map is de veilige opsplitsing van `scripts/server-worker.js`.

## Modules
- `data-collection.js`: publieke bronnen, fetch timeouts, rate-limit circuits, OpenFootball, Understat, FBref en source diagnostics.
- `validation.js`: matchstatus, score parsing, result backfill, H2H-contracten en bronconflicten.
- `prediction.js`: pure prediction math, Poisson helpers, scorematrix, ensemble en probability calibration.
- `learning.js`: post-match reviews, modelmetingen, team learning en calibration profiles.
- `archive.js`: JSON split-output, meta-export en competition archive writes.
- `date-window.js`: Amsterdam-datums, bewaartermijnen en configureerbare worker-datumvensters.

## Extractieregels
- Verplaats alleen pure of contractueel afgebakende functies.
- Geen modelgewichten aanpassen tijdens modularisatie.
- Geen nieuwe databronnen toevoegen tijdens extractie.
- Elke extract moet `npm run check`, `npm run monitor:regressions`, `npm run readiness` en `npm run build` halen.
- `server_data.json` en `data/*.json` moeten dezelfde contracten blijven houden.
- BBC en ESPN event-fetchers blijven de volgende data-collection extract, omdat die nog gekoppeld zijn aan logo-cache, minuten en eventstatus-mapping.
# Worker modules

- `data-collection.js`: public source requests, rate limits and source fallbacks.
- `team-identity.js`: canonical team-name normalization and configured provider IDs.
- `../providers/espn-h2h-provider.js`: second H2H source, restricted to matching ESPN team IDs and completed fixtures.
- `critical-captures.js`: immutable pre-kickoff lineup, odds and H2H captures.
- `training-builder.js`: derives training rows from active matches and immutable snapshots.
- `training-snapshot.js`: preserves the highest-quality row for each prediction ID.
- `enrichment-publication-gate.js`: blocks publication when existing fixtures, final scores, H2H, form, lineups, squads or post-match evidence regress.
- `provider-observability.js`: normalizes provider outcomes to found, no coverage, mapping, quota, HTTP, unpublished, acceptance or configuration states.
- `targeted-repair-queue.js`: prioritizes only incomplete fixtures, with upcoming followed competitions first.
- `quota-budget.js`: protects provider reserves and caps targeted spend per run.
- `competition-quality.js`: publishes coverage and leakage-free performance per followed competition.

GOAL API remains shadow-only until its fourteen-day acceptance report is accepted. It may then supply fixtures, H2H, lineups and statistics, never odds. H2H and form first use immutable local/R2 history so provider calls remain fallback work.
- `h2h.js`: merges H2H sources, provenance and coverage without provider I/O.
- `model-promotion.js`: shared 50-match calibration and 150-match live-promotion gates.
- `r2-snapshot-canary.js`: pure R2 write/read/checksum/evaluation canary contract.
- `provider-quota.js`: shared provider 403/429 cooldown decisions for scheduled work.
- `training-recovery.js`: reconstructs leakage-safe training rows from immutable reviews or evaluations.
- `model-calibration-data.js`: builds the immutable local/R2 shadow-calibration fallback.
- `coverage-summary.js`: consistent per-league lineup and odds coverage metrics.
- `fixture-deduplication.js`: canonical stored-fixture selection, merging and prediction relinking.
- `orchestration-policy.js`: provider retry state and the 50/150 calibration and promotion gates.
- `competition-segmentation.js`: one shared regular-league, cup and friendly classification for training and calibration.
- `league-calibration.js`: static/dynamic league probability calibration and review-profile rebuilding.
- `daily-quality-gate.js`: pure fixture, result, provider-freshness and training-growth checks.

`server-worker.js` is the orchestrator: it composes these modules, writes the app state and schedules source work. Provider IDs must remain provider-specific; a canonical match ID must never be sent to a provider endpoint as though it were that provider's team ID.
