#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const SNAPSHOT_FILE = path.join(ROOT, "training", "training-snapshot.json");
const EXPORT_FILE = path.join(ROOT, "training", "catboost-ready.json");
const EXPORT_CSV_FILE = path.join(ROOT, "training", "catboost-ready.csv");
const CONFIG_FILE = path.join(ROOT, "training", "ensemble-config.json");

const DERIVED_REVIEW_FEATURES = [
  "prob_home_base",
  "prob_draw_base",
  "prob_away_base",
  "prob_home_heuristic",
  "prob_draw_heuristic",
  "prob_away_heuristic",
  "confidence",
  "exact_score_confidence",
  "model_agreement",
  "top_confidence_pick",
  "top_exact_score_pick",
  "risk_low",
  "risk_medium",
  "risk_high",
  "phase_league",
  "phase_cup",
  "phase_knockout",
  "odds_available",
  "source_timestamp_coverage",
];

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function numberFeature(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boolFeature(value) {
  return value ? 1 : 0;
}

function normalizedPhase(value) {
  return String(value || "").toLowerCase();
}

function buildDerivedReviewFeatures(row) {
  const review = row?.review || {};
  const ensemble = row?.ensembleMeta || review?.ensembleMeta || {};
  const base = ensemble?.baseProbabilities || {};
  const heuristic = ensemble?.heuristicProbabilities || {};
  const risk = String(review?.riskProfile || "").toLowerCase();
  const phase = normalizedPhase(review?.phaseBucket || row?.phaseBucket);
  const oddsStatus = String(review?.oddsStatus || row?.oddsStatus || "").toLowerCase();

  const features = {
    prob_home_base: numberFeature(base.homeProb),
    prob_draw_base: numberFeature(base.drawProb),
    prob_away_base: numberFeature(base.awayProb),
    prob_home_heuristic: numberFeature(heuristic.homeProb),
    prob_draw_heuristic: numberFeature(heuristic.drawProb),
    prob_away_heuristic: numberFeature(heuristic.awayProb),
    confidence: numberFeature(review?.confidence ?? row?.confidence),
    exact_score_confidence: numberFeature(review?.exactScoreConfidence ?? row?.exactScoreConfidence),
    model_agreement: numberFeature(review?.modelAgreement ?? ensemble?.agreement),
    top_confidence_pick: boolFeature(review?.topConfidencePick || row?.topConfidencePick),
    top_exact_score_pick: boolFeature(review?.topExactScorePick || row?.topExactScorePick),
    risk_low: boolFeature(risk === "laag" || risk === "low"),
    risk_medium: boolFeature(risk === "middel" || risk === "medium"),
    risk_high: boolFeature(risk === "hoog" || risk === "high"),
    phase_league: boolFeature(phase.includes("league")),
    phase_cup: boolFeature(phase.includes("cup")),
    phase_knockout: boolFeature(phase.includes("knockout")),
    odds_available: boolFeature(["available", "partial"].includes(oddsStatus)),
    source_timestamp_coverage: numberFeature(review?.sourceTimestampCoverage ?? review?.leakageGuard?.sourceTimestampCoverage),
  };

  const hasSignal = Object.values(features).some((value) => Number(value) !== 0);
  return hasSignal ? features : null;
}

function buildFeaturePayload(row, primaryFeatures) {
  const sourceVector = row?.featureVector && typeof row.featureVector === "object" ? row.featureVector : null;
  const derived = buildDerivedReviewFeatures(row);
  if (!sourceVector && !derived) return null;

  const features = {};
  for (const key of primaryFeatures || []) {
    features[key] = numberFeature(sourceVector?.[key]);
  }
  for (const key of DERIVED_REVIEW_FEATURES) {
    features[key] = numberFeature(derived?.[key]);
  }

  return {
    features,
    featureSource: sourceVector ? "snapshot_feature_vector" : "review_prediction_fallback",
    snapshotBacked: !!(row?.predictionId && row?.generatedAt && row?.cutoffAt && sourceVector),
  };
}

function main() {
  const snapshot = readJsonSafe(SNAPSHOT_FILE, { rows: [] });
  const config = readJsonSafe(CONFIG_FILE, { primaryFeatures: [] });
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const featureNames = [...(config.primaryFeatures || []), ...DERIVED_REVIEW_FEATURES];

  const exportRows = rows
    .map((row) => {
      const payload = buildFeaturePayload(row, config.primaryFeatures || []);
      if (!payload || !row.label) return null;
      return {
        matchId: row.matchId,
        date: row.date,
        league: row.league,
        label: row.label,
        predictionId: row.predictionId || null,
        featureSource: payload.featureSource,
        snapshotBacked: payload.snapshotBacked,
        leakageRisk: row?.review?.leakageRisk || row?.leakageGuard?.risk || null,
        features: payload.features,
      };
    })
    .filter(Boolean);

  fs.mkdirSync(path.dirname(EXPORT_FILE), { recursive: true });
  fs.writeFileSync(
    EXPORT_FILE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        modelTarget: config.target || "1X2",
        totalRows: exportRows.length,
        snapshotBackedRows: exportRows.filter((row) => row.snapshotBacked).length,
        fallbackRows: exportRows.filter((row) => !row.snapshotBacked).length,
        featureNames,
        leakageNote:
          "snapshotBackedRows zijn lekvrijer. fallbackRows gebruiken alleen opgeslagen prediction/review-signalen en blijven gemarkeerd als fallback tot prediction snapshots met featureVector beschikbaar zijn.",
        rows: exportRows,
      },
      null,
      2
    )
  );

  const csvLines = [
    ["matchId", "date", "league", "label", "predictionId", "featureSource", "snapshotBacked", "leakageRisk", ...featureNames].join(","),
    ...exportRows.map((row) =>
      [
        row.matchId,
        row.date,
        JSON.stringify(row.league ?? ""),
        row.label,
        row.predictionId || "",
        row.featureSource,
        row.snapshotBacked ? 1 : 0,
        row.leakageRisk || "",
        ...featureNames.map((name) => Number(row.features?.[name] || 0)),
      ].join(",")
    ),
  ];
  fs.writeFileSync(EXPORT_CSV_FILE, csvLines.join("\n"));

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        totalRows: exportRows.length,
        output: EXPORT_FILE,
        csvOutput: EXPORT_CSV_FILE,
      },
      null,
      2
    ) + "\n"
  );
}

main();
