#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const BASE_URL = (process.env.FOOTYAI_BASE_URL || "https://voorspellingenprive.vercel.app").replace(/\/$/, "");
const OUTPUT_JSON = path.join(ROOT, "monitor", "ai-professional-audit.json");
const OUTPUT_MD = path.join(ROOT, "monitor", "ai-professional-audit.md");

const recommendations = [
  {
    key: "immutable_prediction_snapshots",
    title: "Maak pre-match voorspellingen immutable",
    impact: "zeer hoog",
    difficulty: "middel",
    files: ["scripts/server-worker.js", "data/predictions"],
    advice: "Sla prediction_id, generated_at, cutoff_at, model_version, feature_schema_version, input_snapshot_hash en result_status op. Overschrijf deze records nooit bij latere worker-runs."
  },
  {
    key: "leakage_cutoff",
    title: "Dwing data-cutoff voor kickoff af",
    impact: "zeer hoog",
    difficulty: "middel",
    files: ["scripts/server-worker.js"],
    advice: "Filter vorm, H2H, standings, odds, blessures en lineups op informatie die beschikbaar was voor generated_at/cutoff_at. Markeer elk veld met source_timestamp en as_of."
  },
  {
    key: "evaluation_metrics",
    title: "Voeg Brier score, log loss, CLV en ROI toe",
    impact: "zeer hoog",
    difficulty: "laag-middel",
    files: ["scripts/server-worker.js", "api/history.ts", "components/PredictionHistory.tsx"],
    advice: "Bereken per review Brier score en log loss op 1X2. Voeg ROI en closing line value toe zodra odds_at_prediction en closing_odds gevuld zijn."
  },
  {
    key: "storage_backend",
    title: "Bereid database-opslag voor",
    impact: "hoog",
    difficulty: "middel",
    files: ["api/_dataSource.ts", "scripts/server-worker.js"],
    advice: "Gebruik JSON/GitHub als exportlaag, maar ontwerp een schema voor matches, predictions, features, results en evaluations in Postgres of Supabase."
  },
  {
    key: "modular_worker",
    title: "Splits de worker in domeinmodules",
    impact: "hoog",
    difficulty: "middel",
    files: ["scripts/server-worker.js"],
    advice: "Splits data sources, normalisatie, feature builder, model, evaluation en storage. Dit maakt competities, bronnen en modellen makkelijker uitbreidbaar."
  }
];

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
    "## Opslag-audit",
    ...report.storageAudit.map((item) => `- ${item.field}: ${item.present ? "aanwezig" : "mist"} (${item.importance}) - ${item.advice}`),
    "",
    "## Top verbeteringen",
    ...report.recommendations.map((item, index) => `${index + 1}. ${item.title} - impact ${item.impact}, moeite ${item.difficulty}. ${item.advice}`),
    "",
    "## Volgende actie",
    report.nextAction,
    ""
  ].join("\n");
}

async function main() {
  const [matchesJson, predictJson, historyJson, snapshotsJson] = await Promise.all([
    fetchJson("/api/matches").catch((error) => ({ error: error.message, matches: [] })),
    fetchJson("/api/predict").catch((error) => ({ error: error.message, predictions: [] })),
    fetchJson("/api/history").catch((error) => ({ error: error.message, items: [] })),
    fetchJson("/api/prediction-snapshots?limit=25").catch((error) => ({ error: error.message, items: [] }))
  ]);

  const predictions = Array.isArray(predictJson.predictions) ? predictJson.predictions : [];
  const historyItems = Array.isArray(historyJson.items) ? historyJson.items : [];
  const snapshotItems = Array.isArray(snapshotsJson.items) ? snapshotsJson.items : [];
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
      role: "Wekelijkse senior engineering, data engineering en voetbaldata-analyse review",
      cadence: "weekly",
      owner: "Nick",
      status: "active"
    },
    generatedAt: new Date().toISOString(),
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
    storageAudit,
    recommendations,
    nextAction: "Verbeter nu odds-inname en source_timestamp dekking; train pas zwaarder wanneer ROI/CLV op echte odds gebaseerd zijn."
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
