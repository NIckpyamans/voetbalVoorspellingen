#!/usr/bin/env node
// Herkalibreert 1X2-kansen per competitie met Platt-scaling op alle lekvrije
// snapshot-rows (Neon first, immutable ledger als fallback) en promoveert
// geaccepteerde profielen naar het root-segment `probabilityCalibrationProfiles`,
// dat de worker automatisch meelaadt via readDatabaseServerStore.
//
//   node scripts/calibrate-probability-profiles.js            # shadow-only
//   node scripts/calibrate-probability-profiles.js --apply-live
//
import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { loadSnapshotLedger } from "../shared/predictionSnapshotLedger.js";
import {
  buildCalibrationRows,
  buildCalibrationProfile,
  PROBABILITY_CALIBRATION_VERSION,
} from "./worker/probability-calibration.js";
import { isRegularCompetitionRow } from "./worker/competition-segmentation.js";

const ROOT = process.cwd();
const APPLY_LIVE = process.argv.includes("--apply-live");
const MIN_ROWS_PER_LEAGUE = Math.max(20, Number(process.env.PROBABILITY_CALIBRATION_MIN_ROWS || 40));
const REPORT_PATH = path.join(ROOT, "monitor", "probability-calibration-report.json");

function slug(value) {
  return (
    String(value || "unknown")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "unknown"
  );
}

function mergeCalibrationRows(...rowSets) {
  const latestByMatchAndModel = new Map();
  for (const rows of rowSets) {
    for (const row of rows || []) {
      const matchId = String(row?.match_id || row?.matchId || "").trim();
      const model = String(row?.model_version || "unknown");
      if (!matchId) continue;
      const key = `${matchId}::${model}`;
      const existing = latestByMatchAndModel.get(key);
      const candidateTime = Date.parse(String(row?.generated_at || row?.generatedAt || "")) || 0;
      const existingTime = Date.parse(String(existing?.generated_at || existing?.generatedAt || "")) || 0;
      if (!existing || candidateTime >= existingTime) latestByMatchAndModel.set(key, row);
    }
  }
  return [...latestByMatchAndModel.values()];
}

async function readLedgerRows() {
  const load = await loadSnapshotLedger({ root: ROOT });
  const ledger = load?.ledger || {};
  const snapshots = ledger.predictionSnapshots || {};
  const evaluations = ledger.evaluations || {};
  const rows = [];
  for (const [predictionId, evaluation] of Object.entries(evaluations)) {
    const snapshot = snapshots[predictionId];
    const actualOutcome = String(evaluation?.actualOutcome || evaluation?.actual_outcome || "").toUpperCase();
    if (!snapshot || !["H", "D", "A"].includes(actualOutcome)) continue;
    const probabilities = snapshot.probabilities || snapshot.prediction?.probabilities || null;
    if (!probabilities) continue;
    rows.push({
      prediction_id: snapshot.predictionId || predictionId,
      match_id: snapshot.matchId,
      model_version: snapshot.modelVersion || "unknown",
      probabilities,
      generated_at: snapshot.generatedAt || snapshot.cutoffAt || null,
      league: snapshot.league || null,
      actual_outcome: actualOutcome,
      status: "FT",
    });
  }
  return rows;
}

async function main() {
  loadLocalEnv(ROOT);
  const generatedAt = new Date().toISOString();
  let databaseAvailable = false;
  let neonRows = [];
  const sql = getSql();
  if (sql) {
    try {
      // Lekvrij: snapshot moet vóór kickoff zijn gegenereerd met een echte uitslag.
      const rows = await sql.query(
        `select ps.prediction_id, ps.match_id, ps.model_version, ps.probabilities,
                ps.generated_at, m.league, mr.actual_outcome
         from prediction_snapshots ps
         join matches m on m.match_id = ps.match_id
         join match_results mr on mr.match_id = ps.match_id
         where mr.actual_outcome in ('H','D','A')
           and ps.probabilities is not null
           and ps.generated_at < m.kickoff_at
         order by ps.generated_at asc
         limit 20000`
      );
      neonRows = rows || [];
      databaseAvailable = true;
    } catch (error) {
      console.warn(`[probability-calibration] Neon query mislukt: ${error?.message || error}`);
    }
  }
  const ledgerRows = databaseAvailable ? [] : await readLedgerRows();
  const mergedRows = mergeCalibrationRows(neonRows, ledgerRows);
  const regularRows = mergedRows.filter(isRegularCompetitionRow);
  const calibrationRows = buildCalibrationRows(regularRows);

  const byLeague = new Map();
  for (const row of calibrationRows) {
    const group = byLeague.get(row.league) || [];
    group.push(row);
    byLeague.set(row.league, group);
  }

  const results = [];
  const acceptedProfiles = {};
  for (const [league, rows] of [...byLeague.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const outcome = buildCalibrationProfile(rows);
    const result = { league, rows: rows.length, ...outcome };
    results.push(result);
    if (outcome.eligible && outcome.accepted && rows.length >= MIN_ROWS_PER_LEAGUE) {
      acceptedProfiles[league] = {
        ...outcome.profile,
        league,
        baselineBrier: outcome.baseline.brier,
        calibratedBrier: outcome.calibrated.brier,
        baselineLogLoss: outcome.baseline.logLoss,
        calibratedLogLoss: outcome.calibrated.logLoss,
        validationBaselineBrier: outcome.validationBaseline.brier,
        validationCalibratedBrier: outcome.validationCalibrated.brier,
        brierImprovement: outcome.brierImprovement,
        logLossImprovement: outcome.logLossImprovement,
        updatedAt: generatedAt,
        source: databaseAvailable ? "neon_snapshot_rows" : "immutable_ledger",
      };
    }
  }

  let promotion = { applied: false, reason: APPLY_LIVE ? "not_attempted" : "shadow_only" };
  if (APPLY_LIVE && Object.keys(acceptedProfiles).length) {
    if (!sql) {
      promotion = { applied: false, reason: "database_url_missing" };
    } else {
      try {
        const payload = JSON.stringify(acceptedProfiles);
        await sql.query(
          `insert into app_state_segments(segment_group, segment_key, payload, payload_bytes, updated_at)
           values('root','probabilityCalibrationProfiles',$1::jsonb,$2,now())
           on conflict(segment_group, segment_key) do update set
             payload = excluded.payload,
             payload_bytes = excluded.payload_bytes,
             updated_at = now()`,
          [payload, Buffer.byteLength(payload, "utf8")]
        );
        promotion = { applied: true, leagues: Object.keys(acceptedProfiles).length };
      } catch (error) {
        promotion = { applied: false, reason: error?.message || String(error) };
      }
    }
  }

  const summary = {
    ok: true,
    generatedAt,
    applyLive: APPLY_LIVE,
    version: PROBABILITY_CALIBRATION_VERSION,
    databaseAvailable,
    sourceRows: mergedRows.length,
    regularRows: regularRows.length,
    calibrationRows: calibrationRows.length,
    leaguesEvaluated: results.length,
    acceptedLeagues: Object.keys(acceptedProfiles),
    promotion,
    minRowsPerLeague: MIN_ROWS_PER_LEAGUE,
    results: results.slice(0, 40),
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2));
  console.log(
    `[probability-calibration] leagues=${results.length} accepted=${Object.keys(acceptedProfiles).length} ` +
      `promotion=${promotion.applied ? "applied" : promotion.reason}`
  );
}

main().catch((error) => {
  console.error(`[probability-calibration] ${error?.stack || error?.message || error}`);
  process.exit(1);
});
