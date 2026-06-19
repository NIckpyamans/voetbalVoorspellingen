#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUTPUT_JSON = path.join(ROOT, "monitor", "pandaos-workflow-readiness.json");
const OUTPUT_MD = path.join(ROOT, "monitor", "pandaos-workflow-readiness.md");

function readJson(relativePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

function latestDailyRun(findings) {
  const days = findings?.days || {};
  return Object.entries(days)
    .flatMap(([day, value]) => (value?.runs || []).map((run) => ({ day, ...run })))
    .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")))[0] || null;
}

function scorePriority(item) {
  const severityScore = { high: 100, medium: 60, low: 25 };
  const priorityScore = { high: 100, medium: 60, low: 25 };
  return (
    severityScore[String(item.severity || "").toLowerCase()] ||
    priorityScore[String(item.priority || "").toLowerCase()] ||
    Number(item.score || 0) ||
    40
  );
}

function normalizeAction(source, item) {
  if (!item) return null;
  if (typeof item === "string") {
    return {
      source,
      title: item,
      summary: item,
      action: item,
      severity: "medium",
      priority: "medium",
      score: 60,
    };
  }
  const title = item.title || item.key || item.message || item.label || "Aanbeveling";
  const summary = item.summary || item.message || item.detail || item.action || title;
  const action = item.action || item.advice || item.nextAction || summary;
  const normalized = {
    source,
    title,
    summary,
    action,
    severity: item.severity || item.priority || "medium",
    priority: item.priority || item.severity || "medium",
  };
  return { ...normalized, score: scorePriority(normalized) };
}

function uniqueActions(actions) {
  const seen = new Set();
  return actions.filter((item) => {
    const key = `${String(item.title).toLowerCase()}::${String(item.action).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function main() {
  const meta = readJson("data/meta.json");
  const findings = readJson("monitor/daily-findings.json");
  const widgetAudit = readJson("monitor/widget-integration-audit.json");
  const dataQuality = readJson("monitor/data-quality-audit.json");
  const professionalAudit = readJson("monitor/ai-professional-audit.json");
  const qualityAlerts = readJson("monitor/quality-alerts.json", { alerts: [] });
  const latestRun = latestDailyRun(findings);

  const actions = uniqueActions([
    ...(meta.aiAdvice || []).map((item) => normalizeAction("data/meta.aiAdvice", item)),
    ...(meta.sourceCoverage?.coverageImprovementPlan || []).map((item) =>
      normalizeAction("sourceCoverage.coverageImprovementPlan", {
        title: item.label || item.key,
        summary: `${Math.round(Number(item.coverage || 0) * 100)}% dekking, doel ${Math.round(Number(item.target || 0) * 100)}%.`,
        action: item.action,
        priority: item.status === "ok" ? "low" : "high",
      })
    ),
    ...(widgetAudit.opportunities || []).map((item) => normalizeAction("widgetIntegration.opportunities", item)),
    ...(dataQuality.recommendations || []).map((item) => normalizeAction("dataQuality.recommendations", item)),
    ...(professionalAudit.recommendations || []).map((item) => normalizeAction("professionalAudit.recommendations", item)),
    ...(latestRun?.issues || []).map((item) => normalizeAction("dailyFindings.latestIssues", item)),
    ...(qualityAlerts.alerts || []).map((item) => normalizeAction("qualityAlerts", item)),
  ].filter(Boolean)).sort((a, b) => b.score - a.score);

  const topActions = actions.slice(0, 12);
  const report = {
    generatedAt: new Date().toISOString(),
    framing: {
      product: "PandaOS",
      website: "https://pandaos.ai/",
      applicability:
        "PandaOS is vooral nuttig als lokale workflow-orchestrator. Voor deze app passen we hetzelfde principe toe via herbruikbare monitorchecks, projectgeheugen en een centrale prioriteitenlijst.",
    },
    status: {
      totalActions: actions.length,
      highPriority: actions.filter((item) => item.score >= 100).length,
      widgetStatus: widgetAudit.status || "unknown",
      dataCompleteness: meta.sourceCoverage?.averageDataCompleteness ?? null,
      h2hCoverage: meta.sourceCoverage?.h2hCoverage ?? null,
      predictionSnapshots: meta.predictionSnapshotCount || widgetAudit.neon?.predictionSnapshots || 0,
      latestWorkerRun: meta.lastRun || null,
    },
    topActions,
    allActions: actions,
    recommendedWorkflow: [
      "Run npm run monitor:health, monitor:widgets, monitor:data-quality en monitor:regressions als vaste pre-deploy workflow.",
      "Gebruik deze readiness-output als projectgeheugen voor de volgende verbetercyclus.",
      "Koppel PandaOS pas direct wanneer er een publieke API, widgetmanifest of desktop connector beschikbaar is.",
    ],
  };

  const markdown = [
    "# PandaOS Workflow Readiness",
    "",
    `Gegenereerd: ${report.generatedAt}`,
    "",
    "## Conclusie",
    report.framing.applicability,
    "",
    "## Status",
    `- Acties totaal: ${report.status.totalActions}`,
    `- Hoge prioriteit: ${report.status.highPriority}`,
    `- Widgetstatus: ${report.status.widgetStatus}`,
    `- Datacompleetheid: ${Math.round(Number(report.status.dataCompleteness || 0) * 100)}%`,
    `- H2H-dekking: ${Math.round(Number(report.status.h2hCoverage || 0) * 100)}%`,
    `- Prediction snapshots: ${report.status.predictionSnapshots}`,
    "",
    "## Topprioriteiten",
    ...topActions.map((item, index) => `${index + 1}. ${item.title} (${item.priority}) - ${item.action}`),
    "",
    "## Aanbevolen workflow",
    ...report.recommendedWorkflow.map((item) => `- ${item}`),
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(OUTPUT_MD, markdown);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
