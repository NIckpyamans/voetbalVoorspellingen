#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { ACTIVE_COMPETITIONS } from "../shared/competitionVisibility.js";
import { buildProfessionalReadinessGate } from "./worker/professional-readiness-gate.js";

const ROOT = process.cwd();
const readJson = (relativePath, fallback = {}) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")); } catch { return fallback; }
};

const report = buildProfessionalReadinessGate({
  activeCompetitions: ACTIVE_COMPETITIONS,
  catalog: readJson("config/competition-catalog.json"),
  agents: readJson("config/competition-agents.json"),
  dataQuality: readJson("monitor/data-quality-audit.json"),
  squads: readJson("monitor/upcoming-team-squad-enrichment.json"),
  calibration: readJson("monitor/model-recalibration-report.json"),
  providerHealth: readJson("monitor/provider-quota-audit.json"),
});

const outputJson = path.join(ROOT, "monitor", "professional-readiness-gate.json");
const outputMd = path.join(ROOT, "monitor", "professional-readiness-gate.md");
fs.mkdirSync(path.dirname(outputJson), { recursive: true });
fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
const percentage = (value) => `${Math.round(Number(value || 0) * 100)}%`;
const md = [
  "# Professional Readiness Gate",
  "",
  `Laatst bijgewerkt: ${report.generatedAt}`,
  `Status: ${report.status}`,
  "",
  "## Competities",
  ...report.competitions.map((row) =>
    `- ${row.league}: ${row.status}; selectie ${percentage(row.metrics.roster)}, ratings ${percentage(row.metrics.ratings)}, vorm ${percentage(row.metrics.form)}, H2H ${percentage(row.metrics.h2h)}, confirmed lineups ${percentage(row.metrics.confirmedLineups)}, odds ${percentage(row.metrics.timestampedOdds)}, reviews ${percentage(row.metrics.reviews)}, stats ${percentage(row.metrics.postMatchStats)}. Gaten: ${row.gaps.map((gap) => gap.key).join(", ") || "geen"}.`
  ),
  "",
  "## Kalibratie",
  `- Reguliere unieke wedstrijden: ${report.externalConstraints.regularCalibrationRows}`,
  `- Shadow mode: ${report.externalConstraints.shadowCalibrationReady ? "toegestaan" : "nog geblokkeerd"}`,
  `- Live promotie: ${report.externalConstraints.livePromotionReady ? "toegestaan" : "nog geblokkeerd"}`,
  `- Extern geblokkeerde providers: ${report.externalConstraints.providerBlocks.join(", ") || "geen"}`,
  "",
  "Providertekorten blijven zichtbaar als waarschuwing; alleen structurele catalogus- of agentfouten blokkeren de workflow.",
].join("\n");
fs.writeFileSync(outputMd, `${md}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok && String(process.env.PROFESSIONAL_READINESS_STRICT || "true") === "true") process.exitCode = 1;
