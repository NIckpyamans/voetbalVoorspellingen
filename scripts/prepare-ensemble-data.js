#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv, readDatabaseFeatureContext } from "../shared/database.js";
import { isHiddenInternationalOrWorldCupEntity } from "../shared/competitionVisibility.js";
import { buildModelPromotionGate } from "./worker/model-promotion.js";

const ROOT = process.cwd();
const SNAPSHOT_FILE = path.join(ROOT, "training", "training-snapshot.json");
const EXPORT_FILE = path.join(ROOT, "training", "catboost-ready.json");
const EXPORT_CSV_FILE = path.join(ROOT, "training", "catboost-ready.csv");
const CONFIG_FILE = path.join(ROOT, "training", "ensemble-config.json");
const MIN_SNAPSHOT_ROWS = Number(process.env.SNAPSHOT_MIN_TRAINING_ROWS || 50);
const NEXT_SNAPSHOT_TARGET_ROWS = Number(process.env.SNAPSHOT_NEXT_TARGET_ROWS || 150);
const TRAINING_DB_CONTEXT_LIMIT = Math.max(0, Number(process.env.TRAINING_DB_CONTEXT_LIMIT || 60));
const TRAINING_DB_SNAPSHOT_LIMIT = Math.max(0, Number(process.env.TRAINING_DB_SNAPSHOT_LIMIT || 5000));

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

function predictedOutcomeFromRow(row) {
  const review = row?.review || {};
  const candidates = [
    review.predictedOutcome,
    review.outcomePrediction,
    review.pick,
    row?.predictedOutcome,
    row?.outcomePrediction,
    row?.pick,
    row?.prediction?.predictedOutcome,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").toUpperCase();
    if (["H", "1", "HOME", "THUIS"].includes(value)) return "H";
    if (["D", "X", "DRAW", "GELIJK"].includes(value)) return "D";
    if (["A", "2", "AWAY", "UIT"].includes(value)) return "A";
  }
  const probabilities = review?.probabilities || row?.probabilities || row?.prediction?.probabilities || null;
  if (probabilities) {
    const scored = [
      ["H", Number(probabilities.home ?? probabilities.homeProb)],
      ["D", Number(probabilities.draw ?? probabilities.drawProb)],
      ["A", Number(probabilities.away ?? probabilities.awayProb)],
    ].filter(([, value]) => Number.isFinite(value));
    if (scored.length) return scored.sort((a, b) => Number(b[1]) - Number(a[1]))[0][0];
  }
  return null;
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

function buildTrainingPolicy(snapshotBackedRows, uniqueSnapshotMatches) {
  const promotionGate = buildModelPromotionGate(uniqueSnapshotMatches, {
    calibrationMin: MIN_SNAPSHOT_ROWS,
    promotionMin: NEXT_SNAPSHOT_TARGET_ROWS,
  });
  const mature = promotionGate.canCalibrate;
  const nextTargetGap = promotionGate.promotionGap;
  return {
    minSnapshotRows: MIN_SNAPSHOT_ROWS,
    nextTargetRows: NEXT_SNAPSHOT_TARGET_ROWS,
    nextTargetGap,
    snapshotBackedRows,
    uniqueSnapshotMatches,
    effectiveSnapshotRows: uniqueSnapshotMatches,
    promotionGate,
    maturity: mature ? "mature" : "warming_up",
    snapshotBoostActive: mature,
    snapshotWeight: mature ? 1 : 0.65,
    fallbackWeight: mature ? 0.25 : 0.35,
    qualityGate:
      promotionGate.canPromote
        ? "expert_sample"
        : mature
          ? "mature_but_growing"
          : "warming_up",
    note: mature
      ? `Er zijn voldoende unieke snapshotwedstrijden. Meerdere snapshots van dezelfde wedstrijd delen samen één wedstrijdgewicht. Volgende expert-target: ${NEXT_SNAPSHOT_TARGET_ROWS} unieke wedstrijden.`
      : `Snapshottraining blijft conservatief gewogen tot minimaal ${MIN_SNAPSHOT_ROWS} unieke afgeronde wedstrijden beschikbaar zijn; meerdere snapshots van één wedstrijd tellen niet als extra onafhankelijke waarnemingen.`,
  };
}

function buildQualityByDbFeatureSourceCount(exportRows) {
  const groups = new Map();
  for (const row of exportRows) {
    const count = Math.max(0, Math.round(Number(row.features?.db_feature_source_count || 0)));
    const key = count >= 4 ? "4+" : String(count);
    const group = groups.get(key) || {
      dbFeatureSourceCount: key,
      rows: 0,
      snapshotBackedRows: 0,
      evaluableRows: 0,
      outcomeHits: 0,
      labelDistribution: { H: 0, D: 0, A: 0 },
    };
    group.rows += 1;
    if (row.snapshotBacked) group.snapshotBackedRows += 1;
    if (row.label && group.labelDistribution[row.label] !== undefined) group.labelDistribution[row.label] += 1;
    if (row.predictedOutcome && row.label) {
      group.evaluableRows += 1;
      if (row.predictedOutcome === row.label) group.outcomeHits += 1;
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => String(a.dbFeatureSourceCount).localeCompare(String(b.dbFeatureSourceCount), undefined, { numeric: true }))
    .map((group) => ({
      ...group,
      snapshotBackedPct: group.rows ? Number((group.snapshotBackedRows / group.rows).toFixed(3)) : 0,
      outcomeHitRate: group.evaluableRows ? Number((group.outcomeHits / group.evaluableRows).toFixed(3)) : null,
      note:
        group.evaluableRows > 0
          ? "Hit rate is alleen berekend voor rows met opgeslagen predictedOutcome."
          : "Nog geen opgeslagen predictedOutcome in deze groep; gebruik deze bucket voorlopig voor coverage/learning-prioriteit.",
    }));
}

async function enrichRowsWithDatabaseContext(rows) {
  loadLocalEnv(ROOT);
  if (!TRAINING_DB_CONTEXT_LIMIT) return rows;
  const cache = new Map();
  let attempted = 0;
  const output = [];
  for (const row of rows) {
    if (row?.dbFeatureContext || attempted >= TRAINING_DB_CONTEXT_LIMIT) {
      output.push(row);
      continue;
    }
    const key = [row.matchId, row.date, row.homeTeam, row.awayTeam].join("|");
    if (!cache.has(key)) {
      cache.set(
        key,
        readDatabaseFeatureContext({
          matchId: row.matchId,
          dateKey: row.date,
          homeTeamName: row.homeTeam,
          awayTeamName: row.awayTeam,
        }).catch(() => null)
      );
    }
    attempted += 1;
    const dbFeatureContext = await cache.get(key);
    output.push(dbFeatureContext ? { ...row, dbFeatureContext } : row);
  }
  return output;
}

function normalizeDbPayloadRow(row) {
  const payload = row?.prediction_payload && typeof row.prediction_payload === "object" ? row.prediction_payload : {};
  const generatedAt = row.generated_at || payload.generatedAt || payload.cutoffAt || null;
  const cutoffAt = row.cutoff_at || payload.cutoffAt || generatedAt;
  const kickoffDate = row.kickoff_at ? new Date(row.kickoff_at).toISOString().slice(0, 10) : null;
  const label = String(row.actual_outcome || "").toUpperCase();
  if (!["H", "D", "A"].includes(label)) return null;

  return {
    ...payload,
    matchId: row.match_id || payload.matchId || null,
    date: row.date || payload.date || kickoffDate,
    league: row.league || payload.league || null,
    homeTeam: row.home_team_name || row.payload_home_team || payload.homeTeam || null,
    awayTeam: row.away_team_name || row.payload_away_team || payload.awayTeam || null,
    label,
    predictionId: row.prediction_id || payload.predictionId || null,
    generatedAt,
    cutoffAt,
    featureVector: row.feature_vector || payload.featureVector || null,
    probabilities: row.probabilities || payload.probabilities || null,
    expectedScore: row.expected_score || payload.expectedScore || null,
    predHomeGoals: row.expected_score?.home ?? payload.predHomeGoals ?? payload.expectedScore?.home,
    predAwayGoals: row.expected_score?.away ?? payload.predAwayGoals ?? payload.expectedScore?.away,
    oddsAtPrediction:
      Number(row.odds_home) > 1 || Number(row.odds_draw) > 1 || Number(row.odds_away) > 1
        ? {
            home: Number(row.odds_home) || null,
            draw: Number(row.odds_draw) || null,
            away: Number(row.odds_away) || null,
            capturedAt: row.odds_captured_at || null,
            role: row.odds_role || null,
            availableBeforeKickoff: row.available_before_kickoff === true,
          }
        : payload.oddsAtPrediction || payload.odds || null,
    review: {
      ...payload,
      probabilities: row.probabilities || payload.probabilities || null,
      ensembleMeta: row.ensemble_meta || payload.ensembleMeta || null,
      modelEdges: row.model_edges || payload.modelEdges || null,
      marketCalibration: row.market_calibration || payload.marketCalibration || null,
      leakageGuard: row.leakage_guard || payload.leakageGuard || null,
      confidence: row.confidence ?? payload.confidence,
      exactScoreConfidence: row.exact_score_confidence ?? payload.exactScoreConfidence,
      oddsStatus: row.odds_status || payload.oddsStatus,
      oddsAtPrediction:
        Number(row.odds_home) > 1 || Number(row.odds_draw) > 1 || Number(row.odds_away) > 1
          ? {
              home: Number(row.odds_home) || null,
              draw: Number(row.odds_draw) || null,
              away: Number(row.odds_away) || null,
              capturedAt: row.odds_captured_at || null,
              role: row.odds_role || null,
              availableBeforeKickoff: row.available_before_kickoff === true,
            }
          : payload.oddsAtPrediction || payload.odds || null,
    },
    evaluationSource: row.evaluation_source || "scheduled-database-evaluator",
  };
}

async function readDatabaseSnapshotTrainingRows() {
  loadLocalEnv(ROOT);
  if (!TRAINING_DB_SNAPSHOT_LIMIT) return [];
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = await sql.query(
    `
      select ps.prediction_id, ps.match_id, ps.generated_at,
        ps.prediction_payload->>'date' as date,
        ps.prediction_payload->>'cutoffAt' as cutoff_at,
        ps.prediction_payload->>'homeTeam' as payload_home_team,
        ps.prediction_payload->>'awayTeam' as payload_away_team,
        ps.prediction_payload->'featureVector' as feature_vector,
        ps.prediction_payload->'ensembleMeta' as ensemble_meta,
        ps.prediction_payload->'modelEdges' as model_edges,
        ps.prediction_payload->'marketCalibration' as market_calibration,
        ps.prediction_payload->'leakageGuard' as leakage_guard,
        ps.prediction_payload->>'confidence' as confidence,
        ps.prediction_payload->>'exactProb' as exact_score_confidence,
        ps.prediction_payload->>'oddsStatus' as odds_status,
        ps.probabilities, ps.expected_score,
        os.home odds_home, os.draw odds_draw, os.away odds_away,
        os.captured_at odds_captured_at, os.odds_role, os.available_before_kickoff,
        pe.evaluation_source, mr.actual_outcome, m.home_team_name, m.away_team_name,
        m.league, m.kickoff_at
      from prediction_snapshots ps
      join prediction_evaluations pe on pe.prediction_id = ps.prediction_id
      join matches m on m.match_id = ps.match_id
      join match_results mr on mr.match_id = ps.match_id
      left join lateral (
        select home, draw, away, captured_at, odds_role, available_before_kickoff
        from odds_snapshots
        where prediction_id = ps.prediction_id
        order by captured_at desc nulls last
        limit 1
      ) os on true
      where ps.generated_at <= coalesce(m.kickoff_at, ps.generated_at)
        and mr.actual_outcome in ('H','D','A')
      order by ps.generated_at desc
      limit $1
    `,
    [TRAINING_DB_SNAPSHOT_LIMIT]
  );
    return rows.map(normalizeDbPayloadRow).filter(Boolean);
  } catch (error) {
    console.warn(`[train-prepare] Neon snapshots niet beschikbaar; behouden lokale/R2-herstelset: ${error?.message || error}`);
    return [];
  }
}

function rowKey(row) {
  return String(row?.predictionId || row?.prediction_id || row?.matchId || row?.match_id || "").trim();
}

function mergeTrainingRows(localRows, databaseRows) {
  const merged = [];
  const seen = new Set();
  for (const row of [...databaseRows, ...localRows]) {
    const key = rowKey(row);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(row);
  }
  return merged;
}

async function main() {
  const snapshot = readJsonSafe(SNAPSHOT_FILE, { rows: [] });
  const config = readJsonSafe(CONFIG_FILE, { primaryFeatures: [] });
  const databaseRows = await readDatabaseSnapshotTrainingRows();
  const rows = (await enrichRowsWithDatabaseContext(mergeTrainingRows(Array.isArray(snapshot.rows) ? snapshot.rows : [], databaseRows)))
    .filter((row) => !isHiddenInternationalOrWorldCupEntity(row));
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
        predictedOutcome: predictedOutcomeFromRow(row),
        features: payload.features,
      };
    })
    .filter(Boolean);
  const snapshotBackedRows = rawExportRows.filter((row) => row.snapshotBacked).length;
  const snapshotMatchCounts = new Map();
  for (const row of rawExportRows.filter((item) => item.snapshotBacked)) {
    snapshotMatchCounts.set(row.matchId, (snapshotMatchCounts.get(row.matchId) || 0) + 1);
  }
  const uniqueSnapshotMatches = snapshotMatchCounts.size;
  const oddsReadyRows = rows.filter(hasUsableOdds).length;
  const closingLineRows = rows.filter(hasUsableClosingLine).length;
  const trainingPolicy = buildTrainingPolicy(snapshotBackedRows, uniqueSnapshotMatches);
  const exportRows = rawExportRows.map((row) => ({
    ...row,
    trainingWeight: row.snapshotBacked
      ? Number((trainingPolicy.snapshotWeight / Math.max(1, snapshotMatchCounts.get(row.matchId) || 1)).toFixed(6))
      : trainingPolicy.fallbackWeight,
    trainingGroup: row.snapshotBacked ? "snapshot_backed" : "fallback_review",
    snapshotMaturity: trainingPolicy.maturity,
  }));
  const modelQualityByDbFeatureSourceCount = buildQualityByDbFeatureSourceCount(exportRows);

  fs.mkdirSync(path.dirname(EXPORT_FILE), { recursive: true });
  fs.writeFileSync(
    EXPORT_FILE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        modelTarget: config.target || "1X2",
        totalRows: exportRows.length,
        snapshotBackedRows,
        uniqueSnapshotMatches,
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
        modelQualityByDbFeatureSourceCount,
        featureNames,
        leakageNote:
          "Snapshot-backed rows zijn lekvrijer. Alle snapshots van dezelfde match delen samen maximaal één wedstrijdgewicht, zodat herhaalde snapshots geen labelbias veroorzaken. Fallback rows blijven apart en conservatief gewogen.",
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
      "predictedOutcome",
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
        row.predictedOutcome || "",
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
        uniqueSnapshotMatches,
        trainingPolicy,
        output: EXPORT_FILE,
        csvOutput: EXPORT_CSV_FILE,
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
