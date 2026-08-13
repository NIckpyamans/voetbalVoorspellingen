#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { buildModelPromotionGate } from "./worker/model-promotion.js";
import { trainingCalibrationRows } from "./worker/model-calibration-data.js";
import { publishActiveCalibration } from "./worker/r2-model-profiles.js";

const ROOT = process.cwd();
const APPLY_LIVE = process.argv.includes("--apply-live");
const MIN_ROWS = Math.max(10, Number(process.env.MODEL_RECALIBRATION_MIN_ROWS || 20));
const MIN_VALIDATION_ROWS = Math.max(5, Number(process.env.MODEL_RECALIBRATION_MIN_VALIDATION_ROWS || 8));
const MIN_BRIER_IMPROVEMENT = Number(process.env.MODEL_RECALIBRATION_MIN_BRIER_IMPROVEMENT || 0.001);
const MIN_UNIQUE_COMPLETED_SNAPSHOT_MATCHES = Math.max(10, Number(process.env.MODEL_RECALIBRATION_MIN_UNIQUE_COMPLETED_SNAPSHOTS || 50));
const MIN_UNIQUE_COMPLETED_SNAPSHOT_MATCHES_FOR_LIVE = Math.max(
  MIN_UNIQUE_COMPLETED_SNAPSHOT_MATCHES,
  Number(process.env.MODEL_PROMOTION_MIN_UNIQUE_COMPLETED_SNAPSHOTS || 150)
);
const REPORT_PATH = path.join(ROOT, "monitor", "model-recalibration-report.json");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function slug(value) {
  return String(value || "unknown")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";
}

function normalizeProbabilities(probabilities) {
  const raw = ["home", "draw", "away"].map((key) => Math.max(0, Number(probabilities?.[key] || 0)));
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (!total) return [1 / 3, 1 / 3, 1 / 3];
  return raw.map((value) => value / total);
}

function actualVector(outcome) {
  const index = { H: 0, D: 1, A: 2 }[String(outcome || "")];
  return [0, 1, 2].map((item) => (item === index ? 1 : 0));
}

function brier(probabilities, outcome) {
  const y = actualVector(outcome);
  return probabilities.reduce((sum, value, index) => sum + (value - y[index]) ** 2, 0) / 3;
}

function topHit(probabilities, outcome) {
  const actual = { H: 0, D: 1, A: 2 }[String(outcome || "")];
  return probabilities.indexOf(Math.max(...probabilities)) === actual;
}

function applyBias(probabilities, profile, scale = 1) {
  const homeBias = Number(profile.homeBias || 0) * scale;
  const drawBias = Number(profile.drawBias || 0) * scale;
  const adjusted = [
    clamp(probabilities[0] + homeBias, 0.01, 0.98),
    clamp(probabilities[1] + drawBias, 0.01, 0.98),
    clamp(probabilities[2] - homeBias, 0.01, 0.98),
  ];
  const total = adjusted.reduce((sum, value) => sum + value, 0);
  return adjusted.map((value) => value / total);
}

function average(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function buildProfile(trainRows, validationRows, scale) {
  const trainProbabilities = trainRows.map((row) => normalizeProbabilities(row.probabilities));
  const avgPredicted = {
    home: average(trainProbabilities.map((row) => row[0])) || 1 / 3,
    draw: average(trainProbabilities.map((row) => row[1])) || 1 / 3,
    away: average(trainProbabilities.map((row) => row[2])) || 1 / 3,
  };
  const actualCounts = { H: 1, D: 1, A: 1 };
  for (const row of trainRows) actualCounts[row.actual_outcome] = Number(actualCounts[row.actual_outcome] || 1) + 1;
  const actualTotal = trainRows.length + 3;
  const actualRates = {
    home: actualCounts.H / actualTotal,
    draw: actualCounts.D / actualTotal,
    away: actualCounts.A / actualTotal,
  };
  const rawProfile = {
    homeBias: clamp((actualRates.home - avgPredicted.home - (actualRates.away - avgPredicted.away)) * 0.035, -0.025, 0.025),
    drawBias: clamp((actualRates.draw - avgPredicted.draw) * 0.08, -0.035, 0.035),
  };
  const baselineBrier = average(validationRows.map((row) => brier(normalizeProbabilities(row.probabilities), row.actual_outcome)));
  const calibratedBrier = average(validationRows.map((row) => brier(applyBias(normalizeProbabilities(row.probabilities), rawProfile, scale), row.actual_outcome)));
  const baselineOutcomeHitRate = average(validationRows.map((row) => Number(topHit(normalizeProbabilities(row.probabilities), row.actual_outcome)))) || 0;
  const calibratedOutcomeHitRate = average(validationRows.map((row) => Number(topHit(applyBias(normalizeProbabilities(row.probabilities), rawProfile, scale), row.actual_outcome)))) || 0;
  const confidenceBias = clamp((calibratedOutcomeHitRate - 0.52) * 0.04, -0.025, 0.025);
  return {
    scale,
    homeBias: Number((rawProfile.homeBias * scale).toFixed(4)),
    drawBias: Number((rawProfile.drawBias * scale).toFixed(4)),
    confidenceBias: Number(confidenceBias.toFixed(4)),
    baselineBrier: Number((baselineBrier ?? 0).toFixed(6)),
    calibratedBrier: Number((calibratedBrier ?? 0).toFixed(6)),
    improvement: Number(((baselineBrier ?? 0) - (calibratedBrier ?? 0)).toFixed(6)),
    baselineOutcomeHitRate: Number(baselineOutcomeHitRate.toFixed(4)),
    calibratedOutcomeHitRate: Number(calibratedOutcomeHitRate.toFixed(4)),
    actualRates,
    avgPredicted,
  };
}

async function writeRootSegment(sql, key, payload) {
  await sql.query(
    `insert into app_state_segments(segment_group, segment_key, payload, payload_bytes, updated_at)
     values('root',$1,$2::jsonb,$3,now())
     on conflict(segment_group, segment_key) do update set
       payload=excluded.payload,
       payload_bytes=excluded.payload_bytes,
       updated_at=excluded.updated_at`,
    [key, JSON.stringify(payload), Buffer.byteLength(JSON.stringify(payload), "utf8")]
  );
}

function uniqueCompletedSnapshotMatches() {
  const trainingPath = path.join(ROOT, "training", "training-snapshot.json");
  if (!fs.existsSync(trainingPath)) return 0;
  try {
    const training = JSON.parse(fs.readFileSync(trainingPath, "utf8"));
    return new Set(
      (Array.isArray(training?.rows) ? training.rows : [])
        .filter((row) => row?.snapshotBacked)
        .filter((row) => /^(FT|AET|PEN)$/i.test(String(row?.status || "")))
        .map((row) => String(row?.matchId || "").trim())
        .filter(Boolean)
    ).size;
  } catch (error) {
    console.warn(`[model-recalibration] training snapshot kon niet worden gelezen: ${error?.message || error}`);
    return 0;
  }
}

function localCalibrationRows() {
  const trainingPath = path.join(ROOT, "training", "training-snapshot.json");
  if (!fs.existsSync(trainingPath)) return [];
  try {
    return trainingCalibrationRows(JSON.parse(fs.readFileSync(trainingPath, "utf8")));
  } catch (error) {
    console.warn(`[model-recalibration] lokale shadowset kon niet worden gelezen: ${error?.message || error}`);
    return [];
  }
}

async function main() {
  loadLocalEnv(ROOT);
  const completedSnapshotMatches = uniqueCompletedSnapshotMatches();
  const promotionGate = buildModelPromotionGate(completedSnapshotMatches, {
    calibrationMin: MIN_UNIQUE_COMPLETED_SNAPSHOT_MATCHES,
    promotionMin: MIN_UNIQUE_COMPLETED_SNAPSHOT_MATCHES_FOR_LIVE,
  });
  if (!promotionGate.canCalibrate) {
    const report = {
      ok: true,
      skipped: true,
      generatedAt: new Date().toISOString(),
      reason: "insufficient_unique_completed_snapshot_matches",
      uniqueCompletedSnapshotMatches: completedSnapshotMatches,
      minimumUniqueCompletedSnapshotMatches: MIN_UNIQUE_COMPLETED_SNAPSHOT_MATCHES,
      promotionGate,
      nextAction: `Wacht op ${Math.max(0, MIN_UNIQUE_COMPLETED_SNAPSHOT_MATCHES - completedSnapshotMatches)} extra unieke afgeronde clubwedstrijden met pre-match snapshots voordat league/phase-kalibratie draait.`,
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const sql = getSql();
  const database = { configured: !!sql, available: false, error: null, rows: 0 };
  let rows = [];
  if (sql) {
    try {
      rows = await sql.query(`
    select
      ps.prediction_id,
      ps.match_id,
      ps.model_version,
      ps.probabilities,
      ps.generated_at,
      m.competition_id,
      m.league,
      mr.actual_outcome
    from prediction_evaluations pe
    join prediction_snapshots ps on ps.prediction_id = pe.prediction_id
    join matches m on m.match_id = pe.match_id
    join match_results mr on mr.match_id = pe.match_id
    where mr.actual_outcome in ('H','D','A')
      and ps.probabilities is not null
    order by ps.generated_at asc
      `);
      database.available = true;
      database.rows = rows.length;
    } catch (error) {
      database.error = error?.message || String(error);
    }
  }
  const localRows = localCalibrationRows();
  const calibrationSource = database.available && rows.length ? "neon" : "immutable_training_fallback";
  if (calibrationSource === "immutable_training_fallback") rows = localRows;

  const groups = new Map();
  for (const row of rows) {
    const league = String(row.league || row.competition_id || "").trim();
    if (!league) continue;
    const model = String(row.model_version || "unknown");
    const key = `${league}||${model}`;
    const group = groups.get(key) || { league, model, competitionId: row.competition_id || null, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  const candidates = [];
  const acceptedByLeague = new Map();
  for (const group of groups.values()) {
    if (group.rows.length < MIN_ROWS) continue;
    const split = Math.max(MIN_ROWS - MIN_VALIDATION_ROWS, Math.floor(group.rows.length * 0.7));
    const trainRows = group.rows.slice(0, split);
    const validationRows = group.rows.slice(split);
    if (validationRows.length < MIN_VALIDATION_ROWS) continue;
    const best = [0.25, 0.5, 0.75, 1].map((scale) => buildProfile(trainRows, validationRows, scale)).sort((a, b) => b.improvement - a.improvement)[0];
    const accepted = best.improvement >= MIN_BRIER_IMPROVEMENT;
    const profile = {
      status: accepted ? "accepted_live_candidate" : "candidate_no_improvement",
      adjustmentType: "league_bias_v1",
      modelVersion: group.model,
      league: group.league,
      competitionId: group.competitionId,
      trainRows: trainRows.length,
      validationRows: validationRows.length,
      sampleSize: group.rows.length,
      minimumRows: MIN_ROWS,
      minimumValidationRows: MIN_VALIDATION_ROWS,
      leakageSafe: true,
      method: "time_split_league_probability_bias_v1",
      ...best,
    };
    const calibrationProfileId = `league_bias_${slug(group.league)}_${slug(group.model)}`;
    if (database.available) await sql.query(
      `insert into calibration_profiles(
        calibration_profile_id, competition_id, phase_bucket, sample_size,
        brier_score, probability_shrinkage, confidence_bias, profile, generated_at
      )
      values($1,$2,'league_recalibration_candidate',$3,$4,$5,$6,$7::jsonb,now())
      on conflict(calibration_profile_id) do update set
        competition_id=excluded.competition_id,
        phase_bucket=excluded.phase_bucket,
        sample_size=excluded.sample_size,
        brier_score=excluded.brier_score,
        probability_shrinkage=excluded.probability_shrinkage,
        confidence_bias=excluded.confidence_bias,
        profile=excluded.profile,
        generated_at=now()`,
      [
        calibrationProfileId,
        group.competitionId,
        validationRows.length,
        best.calibratedBrier,
        best.scale,
        best.confidenceBias,
        JSON.stringify(profile),
      ]
    );
    const candidate = { calibrationProfileId, accepted, ...profile };
    candidates.push(candidate);
    if (accepted) {
      const current = acceptedByLeague.get(group.league);
      if (!current || candidate.improvement > current.improvement) acceptedByLeague.set(group.league, candidate);
    }
  }

  const liveProfiles = Object.fromEntries(
    [...acceptedByLeague.entries()].map(([league, row]) => [
      league,
      {
        matches: row.sampleSize,
        windowDays: null,
        selectedWindow: "time_split_unique_matches",
        stabilityScore: Number(Math.min(0.95, row.validationRows / 60 + Math.max(0, row.improvement) * 20).toFixed(3)),
        confidenceBias: row.confidenceBias,
        drawBias: row.drawBias,
        homeBias: row.homeBias,
        updatedAt: new Date().toISOString(),
        source: `${calibrationSource}_recalibration`,
        calibrationProfileId: row.calibrationProfileId,
        validationRows: row.validationRows,
        baselineBrier: row.baselineBrier,
        calibratedBrier: row.calibratedBrier,
        improvement: row.improvement,
      },
    ])
  );

  const acceptedCount = Object.keys(liveProfiles).length;
  let r2Promotion = { ok: false, skipped: true, reason: "not_requested" };
  if (APPLY_LIVE && promotionGate.canPromote && acceptedCount > 0) {
    r2Promotion = await publishActiveCalibration({
      profiles: liveProfiles,
      promotionGate,
      source: `${calibrationSource}_recalibration`,
    }).catch((error) => ({ ok: false, skipped: false, error: error?.message || String(error) }));
  }
  const neonPromotionApplied = APPLY_LIVE && promotionGate.canPromote && database.available && acceptedCount > 0;
  if (neonPromotionApplied) {
    await writeRootSegment(sql, "leagueCalibrationProfiles", liveProfiles);
    await writeRootSegment(sql, "modelRecalibrationSummary", {
      generatedAt: new Date().toISOString(),
      candidates: candidates.length,
      accepted: Object.keys(liveProfiles).length,
      minRows: MIN_ROWS,
      minValidationRows: MIN_VALIDATION_ROWS,
      minBrierImprovement: MIN_BRIER_IMPROVEMENT,
    });
  }
  const livePromotionApplied = neonPromotionApplied || r2Promotion.ok;

  const report = {
    ok: true,
    applyLive: APPLY_LIVE,
    livePromotionApplied,
    promotionTargets: { neon: neonPromotionApplied, r2: r2Promotion },
    promotionGate,
    calibrationSource,
    database,
    calibrationRows: rows.length,
    generatedAt: new Date().toISOString(),
    groups: groups.size,
    candidates: candidates.length,
    accepted: acceptedCount,
    liveProfileKeys: Object.keys(liveProfiles),
    topCandidates: candidates.sort((a, b) => b.improvement - a.improvement).slice(0, 20),
    nextAction: livePromotionApplied
      ? "Shadow-evaluatie draaien en Model Ops controleren op accepted league profiles."
      : APPLY_LIVE && promotionGate.canPromote && !database.available && !r2Promotion.ok
        ? "Live-promotie geblokkeerd: Neon is niet schrijfbaar en R2 kon geen actieve profielversie opslaan."
        : acceptedCount === 0
          ? "Geen profiel promoveren: geen unieke-wedstrijdenkandidaat haalt de minimale Brier-verbetering. Verzamel meer complete wedstrijden en herhaal de shadowrun."
        : APPLY_LIVE
        ? `Live-promotie geblokkeerd; verzamel nog ${promotionGate.promotionGap} unieke afgeronde clubwedstrijden.`
        : promotionGate.canPromote
          ? "Run met --apply-live om accepted profielen in app_state_segments te zetten."
          : `Gebruik de uitkomst alleen experimenteel; nog ${promotionGate.promotionGap} unieke wedstrijden nodig voor live-promotie.`,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
