#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const SNAPSHOT_FILE = path.join(ROOT, "training", "training-snapshot.json");
const EXPORT_FILE = path.join(ROOT, "training", "catboost-ready.json");
const EXPORT_CSV_FILE = path.join(ROOT, "training", "catboost-ready.csv");
const CONFIG_FILE = path.join(ROOT, "training", "ensemble-config.json");
const MIN_SNAPSHOT_ROWS = Number(process.env.SNAPSHOT_MIN_TRAINING_ROWS || 50);
const NEXT_SNAPSHOT_TARGET_ROWS = Number(process.env.SNAPSHOT_NEXT_TARGET_ROWS || 150);

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

const DB_FEATURES = [
  "db_has_match_stats",
  "db_has_team_match_stats",
  "db_historical_odds_samples",
  "db_historical_home_implied",
  "db_historical_draw_implied",
  "db_historical_away_implied",
  "db_home_xg",
  "db_away_xg",
  "db_home_shots",
  "db_away_shots",
  "db_home_corners",
  "db_away_corners",
  "db_weather_available",
  "db_weather_temperature",
  "db_weather_wind_speed",
  "db_weather_precipitation",
  "db_h2h_edge_played",
  "db_h2h_edge_balance",
  "db_style_profile_available",
  "db_alias_matched",
  "db_feature_source_count",
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

function hasUsableOdds(row) {
  const review = row?.review || {};
  const odds = row?.oddsAtPrediction || review?.oddsAtPrediction || row?.odds || review?.odds || null;
  if (!odds || typeof odds !== "object") return false;
  return ["home", "draw", "away", "homeOdds", "drawOdds", "awayOdds"].some((field) => {
    const value = Number(odds[field]);
    return Number.isFinite(value) && value > 1.01;
  });
}

function hasUsableClosingLine(row) {
  const review = row?.review || {};
  const market = row?.marketCalibration || review?.marketCalibration || row?.modelEdges?.marketCalibration || review?.modelEdges?.marketCalibration || null;
  const closing = row?.closingOdds || review?.closingOdds || row?.closingLine || review?.closingLine || market;
  if (!closing || typeof closing !== "object") return false;
  if (Number(closing.closingCoverage || 0) > 0.4) return true;
  return ["closingHome", "closingDraw", "closingAway", "closing_home", "closing_draw", "closing_away"].some((field) => {
    const value = Number(closing[field]);
    return Number.isFinite(value) && value > 1.01;
  });
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

function impliedProbability(decimalOdd) {
  const value = Number(decimalOdd);
  return Number.isFinite(value) && value > 1 ? 1 / value : 0;
}

function firstTeamMatchStat(context, side) {
  const rows = Array.isArray(context?.teamMatchStats) ? context.teamMatchStats : [];
  return rows.find((row) => String(row?.side || "").toLowerCase() === side) || {};
}

function buildDatabaseFeatures(row) {
  const sourceVector = row?.featureVector && typeof row.featureVector === "object" ? row.featureVector : {};
  const context = row?.dbFeatureContext && typeof row.dbFeatureContext === "object" ? row.dbFeatureContext : {};
  const matchStats = context.matchStats || {};
  const homeTeamStats = firstTeamMatchStat(context, "home");
  const awayTeamStats = firstTeamMatchStat(context, "away");
  const odds = context.historicalOdds || {};
  const weather = context.weather || context.weatherPayload || {};
  const h2h = context.h2hEdge || {};
  const styleRows = Array.isArray(context.teamSeasonStyle) ? context.teamSeasonStyle : [];
  const sourceCount = Array.isArray(context.featureSources) ? context.featureSources.length : 0;

  const features = {
    db_has_match_stats: boolFeature(matchStats.statsSource || sourceVector.db_has_match_stats),
    db_has_team_match_stats: boolFeature((context.teamMatchStats || []).length || sourceVector.db_has_team_match_stats),
    db_historical_odds_samples: numberFeature(odds.samples ?? sourceVector.db_historical_odds_samples),
    db_historical_home_implied: numberFeature(sourceVector.db_historical_home_implied || impliedProbability(odds.avgHome)),
    db_historical_draw_implied: numberFeature(sourceVector.db_historical_draw_implied || impliedProbability(odds.avgDraw)),
    db_historical_away_implied: numberFeature(sourceVector.db_historical_away_implied || impliedProbability(odds.avgAway)),
    db_home_xg: numberFeature(sourceVector.home_db_xg ?? sourceVector.db_home_xg ?? matchStats.homeXg ?? homeTeamStats.xg),
    db_away_xg: numberFeature(sourceVector.away_db_xg ?? sourceVector.db_away_xg ?? matchStats.awayXg ?? awayTeamStats.xg),
    db_home_shots: numberFeature(sourceVector.home_db_shots ?? sourceVector.db_home_shots ?? matchStats.homeShots ?? homeTeamStats.shots),
    db_away_shots: numberFeature(sourceVector.away_db_shots ?? sourceVector.db_away_shots ?? matchStats.awayShots ?? awayTeamStats.shots),
    db_home_corners: numberFeature(sourceVector.home_db_corners ?? sourceVector.db_home_corners ?? matchStats.homeCorners ?? homeTeamStats.corners),
    db_away_corners: numberFeature(sourceVector.away_db_corners ?? sourceVector.db_away_corners ?? matchStats.awayCorners ?? awayTeamStats.corners),
    db_weather_available: boolFeature(
      sourceVector.db_weather_temperature || weather.temperature_2m_mean || weather.temperature || context.weatherAvailable
    ),
    db_weather_temperature: numberFeature(sourceVector.db_weather_temperature ?? weather.temperature_2m_mean ?? weather.temperature),
    db_weather_wind_speed: numberFeature(sourceVector.db_weather_wind_speed ?? weather.wind_speed_10m_max ?? weather.windSpeed),
    db_weather_precipitation: numberFeature(sourceVector.db_weather_precipitation ?? weather.precipitation_sum ?? weather.precipitation),
    db_h2h_edge_played: numberFeature(h2h.played ?? sourceVector.db_h2h_edge_played),
    db_h2h_edge_balance: numberFeature(h2h.weighted_recent_balance ?? sourceVector.db_h2h_edge_balance),
    db_style_profile_available: boolFeature(styleRows.some((item) => item?.style_profile) || sourceVector.db_style_profile_available),
    db_alias_matched: boolFeature(context.aliasMatched),
    db_feature_source_count: numberFeature(sourceCount),
  };

  const hasSignal = Object.values(features).some((value) => Number(value) !== 0);
  return hasSignal ? features : null;
}

function buildFeaturePayload(row, primaryFeatures) {
  const sourceVector = row?.featureVector && typeof row.featureVector === "object" ? row.featureVector : null;
  const derived = buildDerivedReviewFeatures(row);
  const databaseFeatures = buildDatabaseFeatures(row);
  if (!sourceVector && !derived && !databaseFeatures) return null;

  const features = {};
  for (const key of primaryFeatures || []) {
    features[key] = numberFeature(sourceVector?.[key]);
  }
  for (const key of DERIVED_REVIEW_FEATURES) {
    features[key] = numberFeature(derived?.[key]);
  }
  for (const key of DB_FEATURES) {
    features[key] = numberFeature(databaseFeatures?.[key]);
  }

  return {
    features,
    featureSource: sourceVector
      ? databaseFeatures
        ? "snapshot_feature_vector_plus_db_context"
        : "snapshot_feature_vector"
      : databaseFeatures
        ? "db_context_fallback"
        : "review_prediction_fallback",
    snapshotBacked: !!(row?.predictionId && row?.generatedAt && row?.cutoffAt && sourceVector),
  };
}

function buildTrainingPolicy(snapshotBackedRows) {
  const mature = snapshotBackedRows >= MIN_SNAPSHOT_ROWS;
  const nextTargetGap = Math.max(0, NEXT_SNAPSHOT_TARGET_ROWS - snapshotBackedRows);
  return {
    minSnapshotRows: MIN_SNAPSHOT_ROWS,
    nextTargetRows: NEXT_SNAPSHOT_TARGET_ROWS,
    nextTargetGap,
    snapshotBackedRows,
    maturity: mature ? "mature" : "warming_up",
    snapshotBoostActive: mature,
    snapshotWeight: mature ? 1 : 0.65,
    fallbackWeight: mature ? 0.25 : 0.35,
    qualityGate:
      snapshotBackedRows >= NEXT_SNAPSHOT_TARGET_ROWS
        ? "expert_sample"
        : mature
          ? "mature_but_growing"
          : "warming_up",
    note: mature
      ? `Snapshot-backed rows zijn voldoende aanwezig en mogen zwaarder meewegen dan fallback rows. Volgende expert-target: ${NEXT_SNAPSHOT_TARGET_ROWS} rows.`
      : `Snapshot-backed rows blijven conservatief gewogen tot minimaal ${MIN_SNAPSHOT_ROWS} afgeronde snapshotvoorspellingen beschikbaar zijn.`,
  };
}

function main() {
  const snapshot = readJsonSafe(SNAPSHOT_FILE, { rows: [] });
  const config = readJsonSafe(CONFIG_FILE, { primaryFeatures: [] });
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const featureNames = [...(config.primaryFeatures || []), ...DERIVED_REVIEW_FEATURES, ...DB_FEATURES];

  const rawExportRows = rows
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
  const snapshotBackedRows = rawExportRows.filter((row) => row.snapshotBacked).length;
  const oddsReadyRows = rows.filter(hasUsableOdds).length;
  const closingLineRows = rows.filter(hasUsableClosingLine).length;
  const trainingPolicy = buildTrainingPolicy(snapshotBackedRows);
  const exportRows = rawExportRows.map((row) => ({
    ...row,
    trainingWeight: row.snapshotBacked ? trainingPolicy.snapshotWeight : trainingPolicy.fallbackWeight,
    trainingGroup: row.snapshotBacked ? "snapshot_backed" : "fallback_review",
    snapshotMaturity: trainingPolicy.maturity,
  }));

  fs.mkdirSync(path.dirname(EXPORT_FILE), { recursive: true });
  fs.writeFileSync(
    EXPORT_FILE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        modelTarget: config.target || "1X2",
        totalRows: exportRows.length,
        snapshotBackedRows,
        fallbackRows: exportRows.filter((row) => !row.snapshotBacked).length,
        oddsReadyRows,
        closingLineRows,
        trainingPolicy,
        trainingExpansion: {
          nextSnapshotTargetRows: trainingPolicy.nextTargetRows,
          nextSnapshotTargetGap: trainingPolicy.nextTargetGap,
          oddsReadyRows,
          closingLineRows,
          recommendation:
            trainingPolicy.nextTargetGap > 0
              ? `Laat scheduled learning doorlopen tot minimaal ${trainingPolicy.nextTargetRows} snapshot-backed rows.`
              : "Snapshotgroep heeft expert-target bereikt; kalibreer nu sterker per league en phase.",
        },
        featureNames,
        leakageNote:
          "snapshotBackedRows zijn lekvrijer. fallbackRows gebruiken alleen opgeslagen prediction/review-signalen en blijven gemarkeerd als fallback tot prediction snapshots met featureVector beschikbaar zijn. trainingWeight voorkomt dat een te kleine snapshotgroep te vroeg dominant wordt.",
        rows: exportRows,
      },
      null,
      2
    )
  );

  const csvLines = [
    [
      "matchId",
      "date",
      "league",
      "label",
      "predictionId",
      "featureSource",
      "snapshotBacked",
      "leakageRisk",
      "trainingWeight",
      "trainingGroup",
      "snapshotMaturity",
      ...featureNames,
    ].join(","),
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
        row.trainingWeight,
        row.trainingGroup,
        row.snapshotMaturity,
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
        snapshotBackedRows,
        trainingPolicy,
        output: EXPORT_FILE,
        csvOutput: EXPORT_CSV_FILE,
      },
      null,
      2
    ) + "\n"
  );
}

main();
