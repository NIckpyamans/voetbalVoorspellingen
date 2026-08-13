#!/usr/bin/env node

import fs from "fs";
import path from "path";
import {
  buildAppRecommendations,
  loadRecentDayDocuments,
  summarizeRecentDays,
  values,
} from "./professional-audit-metrics.js";

const ROOT = process.cwd();
const BASE_URL = (process.env.FOOTYAI_BASE_URL || "https://voetbalvoorspellingen-clean.vercel.app").replace(/\/$/, "");
const OUTPUT_JSON = path.join(ROOT, "monitor", "ai-professional-audit.json");
const OUTPUT_MD = path.join(ROOT, "monitor", "ai-professional-audit.md");

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
  } catch {
    return null;
  }
}

async function fetchJson(pathname) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`${pathname} returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function hasField(items, fields) {
  return (items || []).some((item) => fields.some((field) => Object.prototype.hasOwnProperty.call(item || {}, field)));
}

function hasNumericField(items, fields) {
  return (items || []).some((item) =>
    fields.some((field) => item?.[field] != null && item?.[field] !== "" && Number.isFinite(Number(item[field])))
  );
}

function getOddsObject(item) {
  return item?.oddsAtPrediction || item?.odds_at_prediction || item?.odds || null;
}

function hasUsableOdds(item) {
  const odds = getOddsObject(item);
  if (!odds || typeof odds !== "object") return false;
  return ["home", "draw", "away"].some((field) => {
    const value = Number(odds[field]);
    return Number.isFinite(value) && value > 1.01;
  });
}

function hasOddsStatus(items) {
  return (items || []).some((item) => typeof item?.oddsStatus === "string" || typeof item?.odds_status === "string");
}

function summarizePredictions(predictions) {
  const list = Array.isArray(predictions) ? predictions : [];
  const completeness = list.map((item) => Number(item?.dataCompletenessScore ?? item?.dataCompleteness?.score)).filter(Number.isFinite);
  return {
    total: list.length,
    featureCoverage: list.length ? list.filter((item) => item?.featureVector).length / list.length : 0,
    oddsCoverage: list.length ? list.filter(hasUsableOdds).length / list.length : 0,
    historicalMarketOnly: list.length ? list.filter((item) => item?.oddsStatus === "historical_market_profile_only").length / list.length : 0,
    reviewCoverage: list.length ? list.filter((item) => item?.review).length / list.length : 0,
    averageCompleteness: completeness.length ? completeness.reduce((sum, value) => sum + value, 0) / completeness.length : null
  };
}

function buildStorageAudit(historyItems, predictions, snapshots) {
  const snapshotItems = Array.isArray(snapshots) ? snapshots : [];
  const allPredictionRecords = [...(predictions || []), ...(historyItems || []), ...snapshotItems];
  return [
    { field: "prediction_id", present: hasField(predictions, ["predictionId", "prediction_id"]) || hasField(historyItems, ["predictionId"]) || hasField(snapshotItems, ["predictionId"]), importance: "kritiek", advice: "Voeg een stabiele prediction_id toe per voorspelling." },
    { field: "generated_at / cutoff_at", present: hasField(predictions, ["generatedAt", "generated_at", "cutoffAt", "cutoff_at", "timestamp"]) || hasField(historyItems, ["generatedAt", "cutoffAt"]) || hasField(snapshotItems, ["generatedAt", "cutoffAt"]), importance: "kritiek", advice: "Sla tijdstip en cutoff expliciet op zodat latere uitslagen geen input kunnen worden." },
    { field: "featureVector", present: hasField(predictions, ["featureVector"]) || hasField(snapshotItems, ["features"]), importance: "hoog", advice: "Aanwezig waar predictions gevuld zijn; maak hem immutable per prediction_id." },
    { field: "model_version", present: hasField(predictions, ["modelVersion", "model_version", "ensembleMeta"]) || hasField(historyItems, ["modelVersion"]) || hasField(snapshotItems, ["modelVersion"]), importance: "hoog", advice: "Gebruik naast ensembleMeta ook workerVersion en feature_schema_version." },
    { field: "odds_at_prediction", present: allPredictionRecords.some(hasUsableOdds), importance: "hoog", advice: "Sla echte bookmaker, markt, odds en timestamp op; historische marktprofielen tellen niet als ROI-basis." },
    { field: "odds_status / missing_reason", present: hasOddsStatus(allPredictionRecords) || hasField(allPredictionRecords, ["oddsMissingReason"]), importance: "hoog", advice: "Markeer per voorspelling of odds echt, deels, historisch-only of ontbrekend zijn." },
    { field: "Brier/log loss", present: hasNumericField(historyItems, ["brierScore"]) && hasNumericField(historyItems, ["logLoss"]), importance: "kritiek", advice: "Bereken evaluatiemetrics op 1X2 per postMatchReview." },
    { field: "ROI/CLV met echte odds", present: hasNumericField(historyItems, ["roi"]) || hasNumericField(historyItems, ["clv"]), importance: "hoog", advice: "Bereken ROI/CLV pas wanneer odds_at_prediction en closing_odds echt gevuld zijn." },
    { field: "leakage_guard", present: hasField(predictions, ["leakageGuard"]) || hasField(historyItems, ["leakageGuard"]) || hasField(snapshotItems, ["leakageGuard"]), importance: "kritiek", advice: "Leg cutoff_before_kickoff, snapshot_backed en source_timestamp dekking vast." },
    { field: "feature_source_metadata", present: hasField(predictions, ["featureSourceMetadata"]) || hasField(historyItems, ["featureSourceMetadata"]) || hasField(snapshotItems, ["featureSourceMetadata"]), importance: "hoog", advice: "Leg per feature bron, as_of en source_timestamp dekking vast." }
  ];
}

function pct(value) {
  return value == null ? "onbekend" : `${Math.round(Number(value || 0) * 100)}%`;
}

function buildMarkdown(report) {
  return [
    "# FootyAI professionele AI-audit",
    "",
    `Gegenereerd: ${report.generatedAt}`,
    `Bron: ${report.baseUrl}`,
    "",
    "## Samenvatting",
    report.summary,
    "",
    "## Live status",
    `- Wedstrijden vandaag: ${report.live.matchesTotal}`,
    `- Voorspellingen vandaag: ${report.live.predictionsTotal}`,
    `- Reviews: ${report.live.reviewCount}`,
    `- Prediction snapshots: ${report.live.predictionSnapshotCount}`,
    `- Worker: ${report.live.workerVersion || "onbekend"}`,
    `- Feature coverage: ${pct(report.predictions.featureCoverage)}`,
    `- Echte odds coverage: ${pct(report.predictions.oddsCoverage)}`,
    `- Alleen historisch marktprofiel: ${pct(report.predictions.historicalMarketOnly)}`,
    `- Gemiddelde datacompleetheid: ${pct(report.predictions.averageCompleteness)}`,
    `- Datacompleetheid-audit: ${report.live.dataCompletenessAudit?.summary || "onbekend"}`,
    `- Odds readiness: ${report.live.oddsIntegrationReadiness?.nextAction || "onbekend"}`,
    "",
    "## Recente keten (14 dagen)",
    `- Afgeronde wedstrijden met eindstand: ${report.recent.finishedWithScore}/${report.recent.finishedMatches} (${pct(report.recent.resultCoverage)})`,
    `- Geëvalueerde wedstrijden: ${report.recent.reviewedMatches}/${report.recent.finishedMatches} (${pct(report.recent.evaluationCoverage)})`,
    `- Snapshot-backed reviews: ${report.recent.snapshotBackedReviews} (${pct(report.recent.snapshotBackedReviewCoverage)})`,
    `- Uitkomsthit: ${pct(report.recent.performance.outcomeHitRate)}`,
    `- Exacte-scorehit: ${pct(report.recent.performance.exactHitRate)}`,
    `- Gemiddelde Brier score: ${report.recent.performance.averageBrier?.toFixed(3) || "onbekend"}`,
    `- Gemiddelde log loss: ${report.recent.performance.averageLogLoss?.toFixed(3) || "onbekend"}`,
    `- Echte odds: ${pct(report.recent.actualOddsCoverage)}`,
    `- Confirmed lineups: ${pct(report.recent.confirmedLineupCoverage)}`,
    "",
    "## Segmenten",
    ...Object.entries(report.recent.segments).map(([key, item]) => `- ${key}: ${item.reviews} reviews, uitkomst ${pct(item.outcomeHitRate)}, exact ${pct(item.exactHitRate)}, Brier ${item.averageBrier?.toFixed(3) || "onbekend"}`),
    "",
    "## Opslag-audit",
    ...report.storageAudit.map((item) => `- ${item.field}: ${item.present ? "aanwezig; gate voldaan" : `mist (${item.importance}) - ${item.advice}`}`),
    "",
    "## Aantoonbaar afgerond",
    ...(report.completed.length ? report.completed.map((item) => `- ${item}`) : ["- Nog geen gate aantoonbaar afgerond."]),
    "",
    "## Open verbeteringen",
    ...report.recommendations.map((item, index) => `${index + 1}. P${item.priority} ${item.title}. ${item.advice}`),
    "",
    "## Volgende actie",
    report.nextAction,
    ""
  ].join("\n");
}

async function main() {
  const generatedAt = new Date().toISOString();
  const [matchesJson, predictJson, historyJson, snapshotsJson] = await Promise.all([
    fetchJson("/api/matches").catch((error) => ({ error: error.message, matches: [] })),
    fetchJson("/api/predict").catch((error) => ({ error: error.message, predictions: [] })),
    fetchJson("/api/history").catch((error) => ({ error: error.message, items: [] })),
    fetchJson("/api/prediction-snapshots?limit=25").catch((error) => ({ error: error.message, items: [] }))
  ]);

  const recent = summarizeRecentDays(loadRecentDayDocuments(ROOT, generatedAt, 14));
  // The public endpoints intentionally return compact records. Full day exports are
  // the authoritative audit source for feature, review and snapshot contracts.
  const predictions = recent.predictionsList.length ? recent.predictionsList : values(predictJson.predictions);
  const historyItems = recent.reviewsList.length ? recent.reviewsList : values(historyJson.items);
  const snapshotItems = recent.snapshotsList.length ? recent.snapshotsList : values(snapshotsJson.items);
  const snapshotGrowth = readJson("monitor/snapshot-growth-monitor.json");
  const lineupMonitor = readJson("monitor/lineup-availability-monitor.json");
  const recalibrationReport = readJson("monitor/model-recalibration-report.json");
  const databaseAvailable = snapshotGrowth?.database?.available !== false;
  const appRecommendations = buildAppRecommendations({ recent, snapshotGrowth, lineupMonitor, recalibrationReport, databaseAvailable });
  const fetchErrors = {
    matches: matchesJson.error || null,
    predict: predictJson.error || null,
    history: historyJson.error || null,
    snapshots: snapshotsJson.error || null
  };
  const storageAudit = buildStorageAudit(historyItems, predictions, snapshotItems);
  const criticalMissing = storageAudit.filter((item) => item.importance === "kritiek" && !item.present);
  const hasFetchErrors = Object.values(fetchErrors).some(Boolean);

  const report = {
    registeredAi: {
      name: "FootyAI Professional Prediction Audit",
      role: "Tweewekelijkse senior engineering, data engineering en voetbaldata-analyse review",
      cadence: "biweekly",
      owner: "Nick",
      status: "active"
    },
    generatedAt,
    baseUrl: BASE_URL,
    summary: hasFetchErrors
      ? `Professionele audit actief, maar live fetch is beperkt: ${Object.entries(fetchErrors).filter(([, value]) => value).map(([key]) => key).join(", ")}.`
      : criticalMissing.length
        ? `Professionele audit actief. Grootste aandachtspunt: ${criticalMissing.map((item) => item.field).join(", ")}.`
        : "Professionele audit actief. Kritieke opslagvelden lijken aanwezig; blijf kalibratie en bronkwaliteit bewaken.",
    live: {
      matchesTotal: Number(matchesJson.total || (matchesJson.matches || []).length || 0),
      predictionsTotal: Number(predictJson.total || predictions.length || 0),
      reviewCount: Number(matchesJson.reviewCount || predictJson.reviewCount || historyJson.total || 0),
      predictionSnapshotCount: Number(snapshotsJson.total || snapshotItems.length || 0),
      workerVersion: matchesJson.workerVersion || historyJson.workerVersion || "unknown",
      sourceBranch: matchesJson.sourceBranch || predictJson.sourceBranch || historyJson.sourceBranch || snapshotsJson.sourceBranch || "unknown",
      sourceCoverage: matchesJson.sourceCoverage || null,
      featureDiagnostics: matchesJson.featureDiagnostics || null,
      backtestSummary: matchesJson.backtestSummary || null,
      modelPerformance: matchesJson.modelPerformance || null,
      dataCompletenessAudit: matchesJson.dataCompletenessAudit || null,
      oddsIntegrationReadiness: matchesJson.oddsIntegrationReadiness || null,
      fetchErrors
    },
    predictions: summarizePredictions(predictions),
    recent: {
      ...recent,
      matchesList: undefined,
      predictionsList: undefined,
      reviewsList: undefined,
      snapshotsList: undefined,
    },
    storageAudit,
    completed: appRecommendations.completed,
    recommendations: appRecommendations.recommendations,
    nextAction: appRecommendations.recommendations[0]?.advice || "Bewaak de bestaande kwaliteitsgates en herhaal de segmentanalyse."
  };

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
