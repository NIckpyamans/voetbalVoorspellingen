#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const BASE_URL = String(process.env.FOOTYAI_BASE_URL || "https://voetbalvoorspellingen-clean.vercel.app").replace(/\/$/, "");
const OUTPUT_JSON = path.join(ROOT, "monitor", "widget-integration-audit.json");
const OUTPUT_MD = path.join(ROOT, "monitor", "widget-integration-audit.md");

async function fetchJson(pathname) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok && data?.ok !== false, status: response.status, data, error: null };
  } catch (error) {
    return { ok: false, status: null, data: {}, error: error?.message || String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function result(key, label, response, passed, detail) {
  return {
    key,
    label,
    passed: response.ok && passed,
    status: response.status,
    detail: response.ok ? detail : response.error || `HTTP ${response.status}`,
  };
}

async function main() {
  const [health, integrity, matches, standings, history, snapshots, knowledge] = await Promise.all([
    fetchJson("/api/system-check"),
    fetchJson("/api/system-check?detail=integrity"),
    fetchJson("/api/matches"),
    fetchJson("/api/standings"),
    fetchJson("/api/history"),
    fetchJson("/api/prediction-snapshots?limit=1"),
    fetchJson("/api/knowledge?q=Welke%20competities%20zijn%20opgeslagen%3F"),
  ]);

  const checks = [
    result("health", "Systeemstatus", health, health.data?.status === "ok", `status ${health.data?.status || "unknown"}`),
    result(
      "neon",
      "Neon database",
      integrity,
      Number(integrity.data?.summary?.matches || 0) > 0,
      `${Number(integrity.data?.summary?.matches || 0)} matches, ${Number(integrity.data?.summary?.prediction_snapshots || 0)} snapshots`
    ),
    result(
      "provider_widget",
      "Provider- en integriteitswidget",
      integrity,
      Array.isArray(integrity.data?.providers) && integrity.data.providers.length > 0,
      `${integrity.data?.providers?.length || 0} providers, ${integrity.data?.summary?.conflicts || 0} conflicten`
    ),
    result(
      "matches_widget",
      "Dashboard/matches-widget",
      matches,
      Array.isArray(matches.data?.matches) && Boolean(matches.data?.dataLineage?.sourceOfTruth || matches.data?.source),
      `${matches.data?.total || 0} actuele matches, bron ${matches.data?.dataLineage?.sourceOfTruth || matches.data?.source || "unknown"}`
    ),
    result(
      "standings_widget",
      "Standen-widget",
      standings,
      Object.keys(standings.data?.standings || {}).length > 0,
      `${Object.keys(standings.data?.standings || {}).length} standen`
    ),
    result(
      "cup_widget",
      "Bekerschema-widget",
      standings,
      standings.data?.cupSheets != null && typeof standings.data.cupSheets === "object",
      `${Object.keys(standings.data?.cupSheets || {}).length} actief; leeg is geldig buiten bekerrondes`
    ),
    result(
      "season_widget",
      "Neon seizoen-widget",
      standings,
      standings.data?.databaseSeasonOverview?.databaseConfigured === true,
      `${standings.data?.databaseSeasonOverview?.transitions?.length || 0} seizoenovergangen`
    ),
    result("history_widget", "Geschiedenis-widget", history, Array.isArray(history.data?.items), `${history.data?.total || 0} reviews`),
    result(
      "snapshot_widget",
      "Prediction-snapshot-widget",
      snapshots,
      Array.isArray(snapshots.data?.items),
      `${snapshots.data?.total || 0} snapshots`
    ),
    result(
      "knowledge_widget",
      "Vraag FootyAI-widget",
      knowledge,
      Array.isArray(knowledge.data?.results) && knowledge.data.results.length > 0,
      `${knowledge.data?.results?.length || 0} brongebonden resultaten`
    ),
  ];

  const failed = checks.filter((check) => !check.passed);
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    status: failed.length ? "degraded" : "ok",
    totals: { checks: checks.length, passed: checks.length - failed.length, failed: failed.length },
    neon: {
      connected: checks.find((check) => check.key === "neon")?.passed || false,
      matches: Number(integrity.data?.summary?.matches || 0),
      predictionSnapshots: Number(integrity.data?.summary?.prediction_snapshots || 0),
      h2hEdges: Number(integrity.data?.summary?.h2h_edges || 0),
      auditRows: Number(integrity.data?.summary?.audit_rows || 0),
    },
    checks,
    opportunities: [
      Number(integrity.data?.summary?.prematch_odds || 0) === 0 ? "Vul gratis pre-match odds snapshots voordat ROI/CLV wordt beoordeeld." : null,
      Number(integrity.data?.summary?.conflicts || 0) > 0 ? "Prioriteer open bronconflicten op impact en providertrust." : null,
      Number(integrity.data?.summary?.audited_predictions || 0) < Number(integrity.data?.summary?.prediction_snapshots || 0)
        ? "Breid source-auditdekking uit tot alle prediction snapshots."
        : null,
      failed.length ? `Herstel de mislukte widgetcontracten: ${failed.map((item) => item.label).join(", ")}.` : null,
    ].filter(Boolean),
  };

  const markdown = [
    "# Widget Integration Audit",
    "",
    `Gegenereerd: ${report.generatedAt}`,
    `Status: ${report.status}`,
    "",
    "## Neon",
    `- Verbonden: ${report.neon.connected ? "ja" : "nee"}`,
    `- Matches: ${report.neon.matches}`,
    `- Prediction snapshots: ${report.neon.predictionSnapshots}`,
    `- H2H edges: ${report.neon.h2hEdges}`,
    `- Source audit rows: ${report.neon.auditRows}`,
    "",
    "## Widgets",
    ...checks.map((check) => `- ${check.passed ? "OK" : "FOUT"} ${check.label}: ${check.detail}`),
    "",
    "## Kansen",
    ...report.opportunities.map((item) => `- ${item}`),
    "",
  ].join("\n");

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUTPUT_MD, markdown);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
