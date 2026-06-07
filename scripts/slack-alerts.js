#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv, readDatabaseCounts } from "../shared/database.js";

const ROOT = process.cwd();

loadLocalEnv(ROOT);

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function collectAlerts() {
  const readiness = readJsonSafe(path.join(ROOT, "monitor", "source-lineage-backfill.json"), {});
  const health = readJsonSafe(path.join(ROOT, "monitor", "health.json"), {});
  const regression = readJsonSafe(path.join(ROOT, "monitor", "regression-assertions.json"), {});
  const alerts = [];

  if (health?.issues?.some((issue) => issue?.severity === "high")) {
    alerts.push({
      key: "worker_high_severity_issue",
      severity: "high",
      message: "Worker health bevat high-severity issues.",
    });
  }

  if (regression?.degraded || regression?.failedHigh > 0) {
    alerts.push({
      key: "model_regression_degraded",
      severity: "high",
      message: "Model/regression monitor meldt degradatie.",
    });
  }

  if (readiness?.applyStatus && readiness.applyStatus !== "applied") {
    alerts.push({
      key: "source_lineage_not_applied",
      severity: "medium",
      message: `Source lineage status is ${readiness.applyStatus}.`,
    });
  }

  if (!process.env.ODDS_API_KEY && !process.env.THE_ODDS_API_KEY) {
    alerts.push({
      key: "odds_credentials_missing",
      severity: "medium",
      message: "Odds credentials ontbreken nog; ROI/CLV blijft niet-live.",
    });
  }

  return alerts;
}

async function postSlack(webhookUrl, payload) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Slack webhook failed: ${response.status}`);
}

const counts = await readDatabaseCounts().catch((error) => ({ error: error.message }));
const alerts = collectAlerts();
const sql = getSql();
if (sql) {
  const qualityAlerts = await sql.query("select severity,message from quality_alerts where status='open' order by detected_at desc limit 20");
  alerts.push(...qualityAlerts.map((alert) => ({ key: "database_quality_degradation", severity: alert.severity, message: alert.message })));
}
const webhookUrl = process.env.SLACK_WEBHOOK_URL || "";
const result = {
  generatedAt: new Date().toISOString(),
  database: counts,
  alerts,
  slackConfigured: Boolean(webhookUrl),
  sent: false,
};

if (webhookUrl && alerts.length) {
  await postSlack(webhookUrl, {
    text: [
      "*Voetbal Intelligence alerts*",
      `Database: ${counts.matches || 0} matches, ${counts.prediction_snapshots || 0} snapshots, ${counts.source_audit || 0} source audit rows`,
      ...alerts.map((alert) => `- [${alert.severity}] ${alert.message}`),
    ].join("\n"),
  });
  result.sent = true;
}

fs.mkdirSync(path.join(ROOT, "monitor"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "monitor", "slack-alerts.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
