#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSql, loadLocalEnv } from "../shared/database.js";
import {
  loadSnapshotLedger,
  mergeSnapshotLedgers,
  persistSnapshotLedger,
} from "../shared/predictionSnapshotLedger.js";
import { createEvaluationResultIndex, addEvaluationResult, resolveEvaluationResult } from "./worker/evaluation-result-matching.js";
import { normalizeEvaluationResult, evaluateImmutableSnapshot } from "./worker/snapshot-evaluation.js";
import { classifyPredictionSnapshotWindow, snapshotTrainingEligibility } from "./worker/snapshot-policy.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = path.join(ROOT, "monitor", "model-holdout-ledger-enrichment.json");
const MAX_RESULTS = 20_000;
const REVIEWABLE_WINDOWS = new Set(["t24", "t75", "t45", "t20"]);

function readStaticResults() {
  const results = createEvaluationResultIndex();
  const daysDir = path.join(ROOT, "data", "days");
  if (!fs.existsSync(daysDir)) return results;
  for (const fileName of fs.readdirSync(daysDir).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))) {
    try {
      const day = JSON.parse(fs.readFileSync(path.join(daysDir, fileName), "utf8"));
      const dayDate = fileName.slice(0, 10);
      for (const match of day.matches || []) {
        if (normalizeEvaluationResult(match)) addEvaluationResult(results, match.id, { ...match, date: match.date || dayDate, kickoff: match.kickoff || dayDate });
      }
      for (const [matchId, review] of Object.entries(day.reviews || {})) {
        if (normalizeEvaluationResult(review)) addEvaluationResult(results, matchId, { ...review, date: review.date || dayDate });
      }
    } catch (error) {
      console.warn(`[holdout-ledger] kon ${fileName} niet lezen: ${error?.message || error}`);
    }
  }
  const historyPath = path.join(ROOT, "data", "history-summary.json");
  if (fs.existsSync(historyPath)) {
    try {
      const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
      for (const [matchId, review] of Object.entries(history.postMatchReviews || {})) {
        if (normalizeEvaluationResult(review)) addEvaluationResult(results, matchId, review);
      }
    } catch (error) {
      console.warn(`[holdout-ledger] lokale reviewgeschiedenis kon niet worden gelezen: ${error?.message || error}`);
    }
  }
  return results;
}

async function loadDatabaseResults(sql, report, matchIds) {
  if (!sql || !matchIds.length) return new Map();
  const resultByMatch = new Map();
  try {
    const rows = await sql.query(`
      select m.match_id, m.kickoff_at, m.league, m.home_team_name, m.away_team_name,
             mr.final_home_goals, mr.final_away_goals, mr.actual_outcome
      from matches m
      join match_results mr on mr.match_id = m.match_id
      where m.kickoff_at is not null
        and mr.actual_outcome in ('H','D','A')
        and mr.final_home_goals is not null
        and mr.final_away_goals is not null
        and m.match_id = any($1::text[])
      order by m.kickoff_at desc
    `, [matchIds]);
    report.database.available = true;
    report.database.results = rows.length;
    for (const row of rows) {
      if (!row.match_id || !normalizeEvaluationResult(row)) continue;
      resultByMatch.set(String(row.match_id), row);
    }
  } catch (error) {
    report.database.error = error?.message || String(error);
  }
  return resultByMatch;
}

async function main() {
  loadLocalEnv(ROOT);
  const dryRun = process.argv.includes("--dry-run");
  const loaded = await loadSnapshotLedger({ root: ROOT });
  if (!loaded.sources.r2?.available && (!dryRun || !loaded.sources.local?.available)) {
    throw new Error(`Canonical R2 ledger unavailable; refusing enrichment (${loaded.sources.r2?.error || loaded.sources.r2?.reason || "unconfigured"})`);
  }
  const canonicalLedger = loaded.sources.r2?.available ? loaded.sources.r2.ledger : loaded.sources.local.ledger;

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    dryRun,
    source: { kind: loaded.sources.r2?.available ? "r2" : "local_dry_run_only", r2Available: Boolean(loaded.sources.r2?.available), snapshots: Object.keys(canonicalLedger.predictionSnapshots || {}).length },
    database: { configured: false, available: false, results: 0, error: null },
    results: { local: 0, database: 0 },
    evaluations: { new: 0, refreshed: 0, unchanged: 0, noResult: 0, ambiguousResult: 0, ineligible: 0 },
    persistence: { ok: false, skipped: true, reason: process.argv.includes("--dry-run") ? "dry_run" : "not_attempted" },
  };
  const ledger = canonicalLedger;
  const snapshots = Object.values(ledger.predictionSnapshots || {})
    .filter((snapshot) => snapshot?.predictionId && snapshot?.matchId)
    .filter((snapshot) => REVIEWABLE_WINDOWS.has(String(
      snapshot.snapshotWindow || classifyPredictionSnapshotWindow(snapshot.kickoff, snapshot.generatedAt || snapshot.cutoffAt)
    ).toLowerCase()))
    .sort((left, right) => Date.parse(left.kickoff || left.date || "") - Date.parse(right.kickoff || right.date || ""))
    .slice(-MAX_RESULTS);
  const resultMatchIds = [...new Set(snapshots.map((snapshot) => String(snapshot.matchId)))];
  const sql = getSql();
  report.database.configured = Boolean(sql);
  const databaseResults = await loadDatabaseResults(sql, report, resultMatchIds);
  const staticResults = readStaticResults();
  report.results.local = staticResults.byId.size + staticResults.byFixture.size;
  report.results.database = databaseResults.size;

  const mergedResults = createEvaluationResultIndex();
  mergedResults.byId = new Map(staticResults.byId);
  mergedResults.byFixture = new Map(staticResults.byFixture);
  mergedResults.ambiguousFixtures = new Set(staticResults.ambiguousFixtures);
  for (const value of databaseResults.values()) {
    const id = String(value.match_id || "");
    mergedResults.byId.set(id, value);
    addEvaluationResult(mergedResults, id, value);
  }

  for (const snapshot of snapshots) {
    const existing = ledger.evaluations?.[snapshot.predictionId];
    if (existing) {
      report.evaluations.unchanged += 1;
      continue;
    }
    if (!snapshotTrainingEligibility(snapshot).eligible) {
      report.evaluations.ineligible += 1;
      continue;
    }
    const databaseResult = databaseResults.get(String(snapshot.matchId));
    const resolved = databaseResult
      ? { result: databaseResult, matchType: "direct" }
      : resolveEvaluationResult(mergedResults, snapshot);
    if (!resolved.result) {
      if (resolved.matchType === "ambiguous") report.evaluations.ambiguousResult += 1;
      else report.evaluations.noResult += 1;
      continue;
    }
    const evaluation = evaluateImmutableSnapshot(snapshot, resolved.result, {
      evaluationSource: resolved.matchType === "canonical" ? "holdout-ledger-canonical-result" : "holdout-ledger-direct-result",
    });
    if (!evaluation) {
      report.evaluations.ineligible += 1;
      continue;
    }
    ledger.evaluations[evaluation.predictionId] = evaluation;
    report.evaluations.new += 1;
  }

  if (!report.dryRun && (report.evaluations.new || report.evaluations.refreshed)) {
    const result = await persistSnapshotLedger(mergeSnapshotLedgers(ledger), { mergeRemote: true });
    report.persistence = { ok: Boolean(result.ok), skipped: Boolean(result.skipped), months: result.months || 0, evaluations: report.evaluations.new + report.evaluations.refreshed };
    if (!result.ok) throw new Error(`R2 ledger persistence failed: ${result.reason || "unknown"}`);
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`[holdout-ledger] ${error?.stack || error?.message || error}`);
  process.exit(1);
});
