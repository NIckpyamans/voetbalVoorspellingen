#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import {
  loadSnapshotLedger,
  mergeSnapshotLedgers,
  persistLocalSnapshotLedger,
  persistSnapshotLedger,
} from "../shared/predictionSnapshotLedger.js";
import { evaluateImmutableSnapshot, normalizeEvaluationResult } from "./worker/snapshot-evaluation.js";
import {
  addEvaluationResult,
  createEvaluationResultIndex,
  resolveEvaluationResult,
} from "./worker/evaluation-result-matching.js";

const ROOT = process.cwd();
const REPORT_FILE = path.join(ROOT, "monitor", "prediction-evaluation-report.json");
const limit = Math.max(1, Number(process.env.PREDICTION_EVALUATION_LIMIT || 5000));

function readStaticResults() {
  const results = createEvaluationResultIndex();
  const daysDir = path.join(ROOT, "data", "days");
  if (!fs.existsSync(daysDir)) return results;
  for (const fileName of fs.readdirSync(daysDir).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))) {
    try {
      const day = JSON.parse(fs.readFileSync(path.join(daysDir, fileName), "utf8"));
      for (const match of day.matches || []) {
        if (!normalizeEvaluationResult(match)) continue;
        addEvaluationResult(results, match.id, {
          ...match,
          date: match.date || fileName.slice(0, 10),
          kickoff: match.kickoff || null,
        });
      }
      for (const [matchId, review] of Object.entries(day.reviews || {})) {
        if (normalizeEvaluationResult(review)) addEvaluationResult(results, matchId, review);
      }
    } catch (error) {
      console.warn(`[prediction-evaluation] kon ${fileName} niet lezen: ${error?.message || error}`);
    }
  }
  return results;
}

async function evaluateNeon(sql) {
  const status = { configured: !!sql, available: false, candidates: 0, evaluated: 0, error: null };
  if (!sql) return status;
  try {
    const rows = await sql.query(`
      select ps.prediction_id, ps.match_id, ps.generated_at, ps.cutoff_at, ps.probabilities, ps.expected_score,
        ps.prediction_payload, m.kickoff_at, mr.final_home_goals, mr.final_away_goals, mr.actual_outcome
      from prediction_snapshots ps
      join matches m on m.match_id=ps.match_id
      join match_results mr on mr.match_id=ps.match_id
      where ps.generated_at <= coalesce(m.kickoff_at, ps.generated_at)
      order by ps.generated_at limit $1
    `, [limit]);
    status.available = true;
    status.candidates = rows.length;
    for (const row of rows) {
      const evaluation = evaluateImmutableSnapshot({
        predictionId: row.prediction_id,
        matchId: row.match_id,
        generatedAt: row.generated_at,
        cutoffAt: row.cutoff_at,
        kickoff: row.kickoff_at,
        probabilities: row.probabilities,
        expectedScore: row.expected_score,
        prediction: row.prediction_payload,
        oddsAtPrediction: row.prediction_payload?.oddsAtPrediction || null,
      }, row, { evaluationSource: "scheduled-database-evaluator" });
      if (!evaluation) continue;
      await sql.query(`
        insert into prediction_evaluations
          (prediction_id,match_id,exact_hit,outcome_hit,probability_outcome_hit,brier_score,log_loss,roi,roi_status,clv,clv_status,evaluation_source,evaluated_at)
        values ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,now())
        on conflict (prediction_id) do update set
          match_id=excluded.match_id,exact_hit=excluded.exact_hit,outcome_hit=excluded.outcome_hit,
          probability_outcome_hit=excluded.probability_outcome_hit,brier_score=excluded.brier_score,log_loss=excluded.log_loss,
          roi=excluded.roi,roi_status=excluded.roi_status,clv=excluded.clv,clv_status=excluded.clv_status,
          evaluation_source=excluded.evaluation_source,evaluated_at=now()
      `, [evaluation.predictionId,evaluation.matchId,evaluation.exactHit,evaluation.outcomeHit,evaluation.brierScore,evaluation.logLoss,evaluation.roi,evaluation.roiStatus,evaluation.clv,evaluation.clvStatus,evaluation.evaluationSource]);
      status.evaluated += 1;
    }
  } catch (error) {
    status.error = error?.message || String(error);
  }
  return status;
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  const neon = await evaluateNeon(sql);
  const loaded = await loadSnapshotLedger({ root: ROOT });
  let ledger = loaded.ledger;
  const results = readStaticResults();
  for (const [matchId, review] of Object.entries(ledger.postMatchReviews || {})) {
    if (normalizeEvaluationResult(review)) addEvaluationResult(results, matchId, review);
  }

  let r2Evaluated = 0;
  let fallbackEvaluated = 0;
  let eligible = 0;
  let directResultMatches = 0;
  let canonicalResultMatches = 0;
  let ambiguousResultMatches = 0;
  const r2PredictionIds = new Set(Object.keys(loaded.sources.r2?.ledger?.predictionSnapshots || {}));
  const snapshots = Object.values(ledger.predictionSnapshots || {})
    .sort((a, b) => Date.parse(a?.generatedAt || "") - Date.parse(b?.generatedAt || ""))
    .slice(-limit);
  for (const snapshot of snapshots) {
    const resolved = resolveEvaluationResult(results, snapshot);
    const result = resolved.result;
    if (resolved.matchType === "ambiguous") ambiguousResultMatches += 1;
    if (!result) continue;
    if (resolved.matchType === "canonical") canonicalResultMatches += 1;
    else directResultMatches += 1;
    eligible += 1;
    const evaluation = evaluateImmutableSnapshot(snapshot, result, {
      evaluationSource: resolved.matchType === "canonical"
        ? "r2-immutable-ledger-canonical-fixture-evaluator"
        : "r2-immutable-ledger-evaluator",
    });
    if (!evaluation) continue;
    ledger.evaluations[evaluation.predictionId] = evaluation;
    if (r2PredictionIds.has(evaluation.predictionId)) r2Evaluated += 1;
    else fallbackEvaluated += 1;
  }

  let r2Write = { ok: false, skipped: true, reason: "no_changes" };
  if (snapshots.length) {
    persistLocalSnapshotLedger(ledger, ROOT);
    r2Write = await persistSnapshotLedger(mergeSnapshotLedgers(ledger), { mergeRemote: true }).catch((error) => ({
      ok: false,
      skipped: false,
      error: error?.message || String(error),
    }));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    status: neon.available || snapshots.length ? "completed" : "failed_no_snapshot_source",
    sources: {
      neon,
      r2: {
        configured: !!loaded.sources.r2?.configured,
        available: !!loaded.sources.r2?.available,
        snapshotsRead: Object.keys(loaded.sources.r2?.ledger?.predictionSnapshots || {}).length,
        evaluated: r2Evaluated,
        persisted: !!r2Write.ok,
        error: loaded.sources.r2?.error || r2Write.error || null,
      },
      fallback: {
        available: !!loaded.sources.local?.available,
        snapshotsRead: Object.keys(loaded.sources.local?.ledger?.predictionSnapshots || {}).length,
        staticResultsRead: results.byId.size,
        evaluated: fallbackEvaluated,
      },
    },
    totals: {
      snapshotsRead: snapshots.length,
      uniqueSnapshotMatches: new Set(snapshots.map((snapshot) => snapshot?.matchId).filter(Boolean)).size,
      eligibleResults: eligible,
      directResultMatches,
      canonicalResultMatches,
      ambiguousResultMatches,
      evaluatedThisRun: neon.evaluated + r2Evaluated + fallbackEvaluated,
      evaluationsStoredInLedger: Object.keys(ledger.evaluations || {}).length,
    },
    outcome:
      neon.evaluated + r2Evaluated + fallbackEvaluated > 0
        ? "evaluated"
        : snapshots.length && eligible === 0
          ? "no_eligible_finished_results"
          : "all_sources_skipped",
  };
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      "## Prediction evaluation",
      `- Status: ${report.status}`,
      `- Neon: ${neon.available ? `beschikbaar (${neon.evaluated} geëvalueerd)` : `fallback (${neon.error || "niet geconfigureerd"})`}`,
      `- R2: ${report.sources.r2.snapshotsRead} snapshots gelezen, ${r2Evaluated} geëvalueerd`,
      `- Lokale fallback: ${report.sources.fallback.snapshotsRead} snapshots, ${fallbackEvaluated} geëvalueerd`,
      `- Totaal werkelijk geëvalueerd: ${report.totals.evaluatedThisRun}`,
      `- Resultaatkoppeling: ${directResultMatches} direct, ${canonicalResultMatches} canoniek, ${ambiguousResultMatches} ambigu overgeslagen`,
      "",
    ].join("\n"));
  }
  if (report.status !== "completed" || (loaded.sources.r2?.configured && snapshots.length && !r2Write.ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
