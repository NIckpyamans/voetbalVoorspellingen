#!/usr/bin/env node
// Traint een klein gradient-boosting-ensemble (decision stumps, multiclass softmax
// boostin) op de featurevectoren uit Neon prediction_snapshots en schrijft het model
// als root-segment `mlEnsembleModel` weg. De worker laadt dit automatisch en gebruikt
// het als extra ensemble-lid (`gradient_boosting` slot bestaat al).
//
//   node scripts/train-ml-ensemble.js             # shadow: alleen model + rapport
//   node scripts/train-ml-ensemble.js --apply     # promoveer naar Neon
//
import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { ML_ENSEMBLE_VERSION, ML_FEATURES } from "./worker/ml-ensemble.js";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const REPORT_PATH = path.join(ROOT, "monitor", "ml-ensemble-report.json");
const MIN_ROWS = Math.max(50, Number(process.env.ML_ENSEMBLE_MIN_ROWS || 300));
const MAX_STUMPS = Math.max(10, Number(process.env.ML_ENSEMBLE_MAX_STUMPS || 120));
const LEARNING_RATE = clampEnvNumber(process.env.ML_ENSEMBLE_LEARNING_RATE, 0.06);
const MIN_LEAF = Math.max(5, Number(process.env.ML_ENSEMBLE_MIN_LEAF || 25));

function clampEnvNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const OUTCOME_INDEX = { H: 0, D: 1, A: 2 };
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value || 0)));
const softmax = (values) => {
  const max = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(value - max));
  const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  return exponentials.map((value) => value / total);
};

function loadRows(sql) {
  return sql.query(
    `select ps.prediction_id, ps.features, ps.probabilities, ps.model_version,
            ps.generated_at, m.kickoff_at, m.league, mr.actual_outcome
     from prediction_snapshots ps
     join matches m on m.match_id = ps.match_id
     join match_results mr on mr.match_id = ps.match_id
     where mr.actual_outcome in ('H','D','A')
       and ps.features is not null
       and ps.features <> '{}'::jsonb
       and ps.generated_at < m.kickoff_at
     order by ps.generated_at asc
     limit 30000`
  );
}

function toTrainingRows(dbRows) {
  const rows = [];
  const seen = new Set();
  for (const row of dbRows || []) {
    const outcome = String(row.actual_outcome || "").toUpperCase();
    if (!(outcome in OUTCOME_INDEX)) continue;
    const features = row.features || {};
    const vector = ML_FEATURES.map((feature) => Number(features[feature])).filter(Number.isFinite);
    if (vector.length < Math.ceil(ML_FEATURES.length * 0.6)) continue;
    const key = `${row.prediction_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      values: ML_FEATURES.map((feature) => (Number.isFinite(Number(features[feature])) ? Number(features[feature]) : 0)),
      outcomeIndex: OUTCOME_INDEX[outcome],
    });
  }
  return rows;
}

function meanProbabilities(rows) {
  const sums = [0, 0, 0];
  for (const row of rows) sums[row.outcomeIndex] += 1;
  const total = rows.length || 3;
  return sums.map((value) => value / total);
}

function brier(probabilities, outcomeIndex) {
  let sum = 0;
  for (let index = 0; index < 3; index += 1) {
    const target = index === outcomeIndex ? 1 : 0;
    sum += (probabilities[index] - target) ** 2;
  }
  return sum / 2;
}

// Enkele beste stump per ronde: maximaliseert gewogen afname van cross-entropy.
function bestStump(rows, gradients) {
  let best = null;
  for (let featureIndex = 0; featureIndex < ML_FEATURES.length; featureIndex += 1) {
    const values = [...new Set(rows.map((row) => row.values[featureIndex]))].sort((left, right) => left - right);
    if (values.length < 2) continue;
    const thresholds = [];
    for (let index = 1; index < values.length; index += 1) thresholds.push((values[index - 1] + values[index]) / 2);
    // Bepaalde sparsity: max 24 thresholds per feature per ronde.
    const step = Math.max(1, Math.floor(thresholds.length / 24));
    for (let index = 0; index < thresholds.length; index += step) {
      const threshold = thresholds[index];
      const left = [];
      const right = [];
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        (rows[rowIndex].values[featureIndex] <= threshold ? left : right).push(gradients[rowIndex]);
      }
      if (left.length < MIN_LEAF || right.length < MIN_LEAF) continue;
      const residual = (bucket) => {
        const sums = [0, 0, 0];
        for (const gradient of bucket) for (let index = 0; index < 3; index += 1) sums[index] += gradient[index];
        return sums.map((value) => value / bucket.length);
      };
      const leftResidual = residual(left);
      const rightResidual = residual(right);
      let gain = 0;
      for (let classIndex = 0; classIndex < 3; classIndex += 1) {
        for (const bucket of [left, right]) {
          for (const gradient of bucket) {
            gain -= gradient[classIndex] * (bucket === left ? leftResidual[classIndex] : rightResidual[classIndex]);
          }
        }
      }
      if (!best || gain > best.gain) {
        best = { feature: ML_FEATURES[featureIndex], featureIndex, threshold: Number(threshold.toFixed(4)), left: leftResidual.map((value) => Number(value.toFixed(4))), right: rightResidual.map((value) => Number(value.toFixed(4))), gain };
      }
    }
  }
  return best;
}

function evaluate(rows, base, stumps) {
  let brierSum = 0;
  let correct = 0;
  for (const row of rows) {
    const scores = [...base];
    for (const stump of stumps) {
      const residual = row.values[stump.featureIndex ?? ML_FEATURES.indexOf(stump.feature)] <= stump.threshold ? stump.left : stump.right;
      for (let index = 0; index < 3; index += 1) scores[index] += residual[index] || 0;
    }
    const probabilities = softmax(scores);
    brierSum += brier(probabilities, row.outcomeIndex);
    if (probabilities.indexOf(Math.max(...probabilities)) === row.outcomeIndex) correct += 1;
  }
  const total = rows.length || 1;
  return { brier: Number((brierSum / total).toFixed(5)), outcomeHitRate: Number((correct / total).toFixed(4)), rows: rows.length };
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  if (!sql) {
    console.error("[ml-ensemble] DATABASE_URL ontbreekt; niets te doen.");
    process.exit(1);
  }
  const generatedAt = new Date().toISOString();
  const dbRows = await loadRows(sql);
  const rows = toTrainingRows(dbRows);
  if (rows.length < MIN_ROWS) {
    console.log(`[ml-ensemble] onvoldoende trainingsrijen: ${rows.length} < ${MIN_ROWS}; niets getraind.`);
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify({ ok: true, skipped: true, rows: rows.length, minRows: MIN_ROWS }, null, 2));
    return;
  }
  // Chronologische split: 80% train, 20% validatie (lekvrij).
  const splitIndex = Math.floor(rows.length * 0.8);
  const trainRows = rows.slice(0, splitIndex);
  const validationRows = rows.slice(splitIndex);
  const base = meanProbabilities(trainRows).map((probability) => Math.log(clamp(probability, 0.02, 0.96)));
  const stumps = [];
  let validationBrier = null;
  for (let round = 0; round < MAX_STUMPS; round += 1) {
    const scoresList = trainRows.map((row) => {
      const scores = [...base];
      for (const stump of stumps) {
        const residual = row.values[stump.featureIndex] <= stump.threshold ? stump.left : stump.right;
        for (let index = 0; index < 3; index += 1) scores[index] += residual[index] || 0;
      }
      return scores;
    });
    const gradients = trainRows.map((row, rowIndex) => {
      const probabilities = softmax(scoresList[rowIndex]);
      return probabilities.map((probability, index) => ((index === row.outcomeIndex ? 1 : 0) - probability) * LEARNING_RATE);
    });
    const stump = bestStump(trainRows, gradients);
    if (!stump || stump.gain <= 1e-6) break;
    stumps.push(stump);
    validationBrier = evaluate(validationRows, base, stumps).brier;
  }
  const baseline = evaluate(validationRows, base, []);
  const trained = evaluate(validationRows, base, stumps);
  const accepted = trained.brier < baseline.brier;
  const model = {
    version: ML_ENSEMBLE_VERSION,
    featureSchema: ML_FEATURES,
    classes: ["H", "D", "A"],
    base: base.map((value) => Number(value.toFixed(4))),
    stumps: stumps.map(({ feature, threshold, left, right, gain }) => ({ feature, threshold, left, right, gain: Number(gain.toFixed(5)) })),
    trainingMeta: {
      rows: rows.length,
      trainRows: trainRows.length,
      validationRows: validationRows.length,
      trainedAt: generatedAt,
      validationBrier: trained.brier,
      baselineBrier: baseline.brier,
      brierImprovement: Number((baseline.brier - trained.brier).toFixed(5)),
      outcomeHitRate: trained.outcomeHitRate,
      accepted,
    },
  };
  let promotion = { applied: false, reason: APPLY ? "not_attempted" : "shadow_only" };
  if (APPLY && accepted) {
    try {
      const payload = JSON.stringify(model);
      await sql.query(
        `insert into app_state_segments(segment_group, segment_key, payload, payload_bytes, updated_at)
         values('root','mlEnsembleModel',$1::jsonb,$2,now())
         on conflict(segment_group, segment_key) do update set
           payload = excluded.payload,
           payload_bytes = excluded.payload_bytes,
           updated_at = now()`,
        [payload, Buffer.byteLength(payload, "utf8")]
      );
      promotion = { applied: true };
    } catch (error) {
      promotion = { applied: false, reason: error?.message || String(error) };
    }
  }
  const report = {
    ok: true,
    generatedAt,
    rows: rows.length,
    minRows: MIN_ROWS,
    stumps: stumps.length,
    baseline,
    trained,
    accepted,
    promotion,
    featureImportance: ML_FEATURES.map((feature) => ({
      feature,
      totalGain: Number(stumps.filter((stump) => stump.feature === feature).reduce((sum, stump) => sum + stump.gain, 0).toFixed(5)),
    })).sort((left, right) => right.totalGain - left.totalGain),
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(
    `[ml-ensemble] rows=${rows.length} stumps=${stumps.length} validationBrier=${trained.brier} ` +
      `baseline=${baseline.brier} accepted=${accepted} promotion=${promotion.applied ? "applied" : promotion.reason}`
  );
}

main().catch((error) => {
  console.error(`[ml-ensemble] ${error?.stack || error?.message || error}`);
  process.exit(1);
});
