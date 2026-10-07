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
import {
  buildSnapshotBackedReview,
  evaluateImmutableSnapshot,
  normalizeEvaluationResult,
} from "./worker/snapshot-evaluation.js";
import {
  addEvaluationResult,
  createEvaluationResultIndex,
  resolveEvaluationResult,
} from "./worker/evaluation-result-matching.js";
import { summarizeUniqueFixtureEvaluations, assessAuditFreshness } from "./worker/audit-freshness.js";
import { buildMatchDedupeKey } from "../shared/matchNormalization.js";

const ROOT = process.cwd();
const REPORT_FILE = path.join(ROOT, "monitor", "prediction-evaluation-report.json");
const MAX_EVALUATION_LIMIT = 500;
const EVALUATION_PAGE_SIZE = 100;
const requestedLimit = Number(process.env.PREDICTION_EVALUATION_LIMIT || 500);
const limit = Number.isFinite(requestedLimit) ? Math.min(MAX_EVALUATION_LIMIT, Math.max(1, Math.trunc(requestedLimit))) : MAX_EVALUATION_LIMIT;

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
  const status = {
    configured: !!sql,
    available: false,
    candidates: 0,
    evaluated: 0,
    pages: 0,
    queryBudget: { maxRows: limit, pageSize: EVALUATION_PAGE_SIZE, selectedColumns: 15, strategy: "narrow_projection_keyset_pages_unprocessed_only" },
    error: null,
  };
  if (!sql) return status;
  try {
    let cursorGeneratedAt = null;
    let cursorPredictionId = null;
    while (status.candidates < limit) {
      const pageLimit = Math.min(EVALUATION_PAGE_SIZE, limit - status.candidates);
      const rows = await sql.query(`
        select ps.prediction_id, ps.match_id, ps.generated_at, ps.cutoff_at, ps.probabilities, ps.expected_score,
          (ps.features <> '{}'::jsonb) as has_features, ps.input_snapshot_hash,
          ps.prediction_payload->'oddsAtPrediction' as odds_at_prediction,
          ps.prediction_payload->>'predHomeGoals' as payload_pred_home_goals,
          ps.prediction_payload->>'predAwayGoals' as payload_pred_away_goals,
          m.kickoff_at, mr.final_home_goals, mr.final_away_goals, mr.actual_outcome
        from prediction_snapshots ps
        join matches m on m.match_id=ps.match_id
        join match_results mr on mr.match_id=ps.match_id
        left join prediction_evaluations pe on pe.prediction_id=ps.prediction_id
        where m.kickoff_at is not null
          and mr.actual_outcome in ('H','D','A')
          and pe.prediction_id is null
          and ps.input_snapshot_hash is not null
          and ps.features <> '{}'::jsonb
          and ps.probabilities ?& array['home','draw','away']
          and ps.cutoff_at < m.kickoff_at
          and ps.generated_at <= m.kickoff_at
          and (
            floor(extract(epoch from (m.kickoff_at-ps.generated_at))/60) between 1080 and 1800
            or floor(extract(epoch from (m.kickoff_at-ps.generated_at))/60) between 61 and 90
            or floor(extract(epoch from (m.kickoff_at-ps.generated_at))/60) between 31 and 60
            or floor(extract(epoch from (m.kickoff_at-ps.generated_at))/60) between 5 and 30
          )
          and ($1::timestamptz is null or (ps.generated_at,ps.prediction_id)>($1::timestamptz,$2::text))
        order by ps.generated_at,ps.prediction_id
        limit $3
      `, [cursorGeneratedAt, cursorPredictionId, pageLimit]);
      status.available = true;
      status.pages += 1;
      status.candidates += rows.length;
      if (!rows.length) break;
      const last = rows[rows.length - 1];
      cursorGeneratedAt = last.generated_at;
      cursorPredictionId = last.prediction_id;
      for (const row of rows) {
        const evaluation = evaluateImmutableSnapshot({
          predictionId: row.prediction_id,
          matchId: row.match_id,
          generatedAt: row.generated_at,
          cutoffAt: row.cutoff_at,
          kickoff: row.kickoff_at,
          probabilities: row.probabilities,
          expectedScore: row.expected_score,
          features: row.has_features ? {} : null,
          inputSnapshotHash: row.input_snapshot_hash,
          prediction: {
            predHomeGoals: row.payload_pred_home_goals,
            predAwayGoals: row.payload_pred_away_goals,
          },
          oddsAtPrediction: row.odds_at_prediction || null,
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
      if (rows.length < pageLimit) break;
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
  const linkedReviewMatches = new Set();
  const r2PredictionIds = new Set(Object.keys(loaded.sources.r2?.ledger?.predictionSnapshots || {}));
  const allSnapshots = Object.values(ledger.predictionSnapshots || {});
  const snapshots = allSnapshots
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
    const linkedReview = buildSnapshotBackedReview(
      snapshot,
      result,
      evaluation,
      ledger.postMatchReviews?.[snapshot.matchId] || null
    );
    if (linkedReview) {
      ledger.postMatchReviews[snapshot.matchId] = linkedReview;
      linkedReviewMatches.add(snapshot.matchId);
    }
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

  const generatedAt = new Date().toISOString();
  const uniqueEvaluationAccounting = summarizeUniqueFixtureEvaluations(
    allSnapshots,
    Object.values(ledger.evaluations || {}).map((evaluation) => ({ predictionId: evaluation.predictionId })),
  );
  const uniqueSnapshotFixtures = new Set(allSnapshots.map((snapshot) => buildMatchDedupeKey({
    kickoff: snapshot.kickoff || snapshot.date,
    league: snapshot.league,
    homeTeam: snapshot.homeTeam || snapshot.homeTeamName || snapshot.inputSnapshot?.homeTeam,
    awayTeam: snapshot.awayTeam || snapshot.awayTeamName || snapshot.inputSnapshot?.awayTeam,
  })).filter(Boolean)).size;
  const report = {
    generatedAt,
    freshness: assessAuditFreshness({ generatedAt }),
    status: neon.available || snapshots.length ? "completed" : "failed_no_snapshot_source",
    sources: {
      neon: { ...neon, queryBudget: { ...neon.queryBudget, limitApplied: limit } },
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
      evaluationLimit: limit,
      uniqueSnapshotFixturesRead: new Set(snapshots.map((snapshot) => buildMatchDedupeKey({
        kickoff: snapshot.kickoff || snapshot.date,
        league: snapshot.league,
        homeTeam: snapshot.homeTeam || snapshot.homeTeamName || snapshot.inputSnapshot?.homeTeam,
        awayTeam: snapshot.awayTeam || snapshot.awayTeamName || snapshot.inputSnapshot?.awayTeam,
      })).filter(Boolean)).size,
      uniqueSnapshotFixturesInLedger: uniqueSnapshotFixtures,
      repeatedSnapshotRowsInLedger: Math.max(0, allSnapshots.length - uniqueSnapshotFixtures),
      uniqueFixtureEvaluationAccounting: uniqueEvaluationAccounting,
      eligibleResults: eligible,
      directResultMatches,
      canonicalResultMatches,
      ambiguousResultMatches,
      evaluatedThisRun: neon.evaluated + r2Evaluated + fallbackEvaluated,
      evaluationsStoredInLedger: Object.keys(ledger.evaluations || {}).length,
      snapshotBackedReviewsStoredInLedger: Object.values(ledger.postMatchReviews || {})
        .filter((review) => review?.evaluationSource === "prediction_snapshot").length,
      reviewsLinkedThisRun: linkedReviewMatches.size,
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
      `- Snapshot-backed reviews gekoppeld: ${linkedReviewMatches.size} deze run`,
      "",
    ].join("\n"));
  }
  if (report.status !== "completed" || (loaded.sources.r2?.configured && snapshots.length && !r2Write.ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
