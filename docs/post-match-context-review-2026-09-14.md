# Post-match context recovery and analysis review — 14 September 2026

## Confirmed cause

Compared `7d7bf5889` (13 September) and `be71f6333` (14 September) with their parents.
The context backfill, after the worker publication gate, removed target-fixture leakage.
However, it preferred a short local-history form reconstruction and only used the
existing provider rows when local history was entirely empty (`||=`). H2H reconstruction
also ignored valid existing provider meetings when removing a contaminated target row.
This was field replacement in the context backfill, not evidence that every match
record was indiscriminately replaced.

## Correction and recovery

Merge existing dated provider rows with local historical rows before summarizing.
Deduplicate meetings; exclude the target, future and date-only same-day evidence.
Process home/away form independently. Preserve untouched fields and valid context.
Regression tests cover sparse archives, contamination, future rows, idempotence and
unchanged prediction/outcome fields.

Recovery reads the two identified Git parents and restores only strictly earlier
context for matching fixture IDs and team names. No scores, prediction records,
immutable snapshots or reviews change. 190 context fields across 112 fixtures were
recovered in 10 day files. This is historical context recovery, not newly available
prematch evidence and not a backtest improvement.

Current local audit (same 730 fixtures): overall H2H 41.1% -> 47.7%; Eredivisie form
41.9% -> 90.3%, H2H 29.0% -> 58.1%. The original 61.3% H2H is intentionally not a
target: contaminated target results must stay excluded. Ledger-specific audit totals
come from the locally available ledger and can differ from the hosted R2 evaluation.

## Existing analyses: priorities supported by evidence

1. **Preserve valid context and exclude leakage — fixed here.** Coverage alone cannot
   distinguish recovered history from the target match being included as history.
2. **Fix oversized Neon evaluation reads.** `prediction-evaluation-report.json`,
   14 September 11:00 UTC: Neon HTTP 507, response >67,108,864 bytes. R2 evaluated
   447 snapshots. Use bounded pagination/projection and verify parity with R2 before
   relying on Neon; this is not the older quota/HTTP 402 issue in the weekly digest.
3. **Make missing monitor input explicit.** `ruflo-agent-report.md` shows 0 reviews
   and 0% coverage while the quality audit and R2 evaluation contain data.
   `ruflo-monitor.js` reads `server_data.json` and defaults missing input to empty
   objects. Add split-data inputs or report unavailable, rather than treating missing
   input as measured zero. Do not tune model weights from these zero summaries.
4. **Increase actual prematch evidence.** Current quality audit: confirmed lineups
   12.3%, timestamped odds 13.7%, complete prematch evidence 2.5%. Prioritize existing
   pre-kickoff collection windows and supported providers. Historical confirmed
   lineups cannot be relabelled as prematch evidence.
5. **Validate club-rating calibration prospectively.** The weekly digest supports
   shadow calibration, but its reporting window ends 8 September, before the new
   club rating. Evaluate immutable pre-kickoff snapshots of the new version, grouped
   by competition/phase, with Brier/log loss and adequate unique-match counts.
   No model weight changes are justified by the context recovery alone.

Items 2–5 are findings and follow-up work, not changes completed by this patch.
