#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { todayAmsterdamKey } from "../shared/date.js";

const ROOT = process.cwd();
const OUTPUT_JSON = path.join(ROOT, "monitor", "data-quality-audit.json");
const OUTPUT_MD = path.join(ROOT, "monitor", "data-quality-audit.md");
const DEFAULT_LOOKBACK_DAYS = Number(process.env.DATA_QUALITY_LOOKBACK_DAYS || 45);

function readJsonSafe(relativePath, fallback) {
  try {
    const filePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function dateMinus(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function hasFinalScore(match) {
  const status = String(match?.status || "").toUpperCase();
  const score = String(match?.score || "");
  return /^\d+\s*-\s*\d+$/.test(score) && ["FT", "AET", "PEN"].includes(status);
}

function isPastMatch(match, today) {
  const dateKey = String(match?._dateKey || match?.date || match?.kickoff || "").slice(0, 10);
  if (!dateKey) return false;
  return dateKey < today;
}

function matchLabel(match) {
  const dateKey = String(match?._dateKey || match?.date || match?.kickoff || "").slice(0, 10) || "unknown";
  return `${dateKey}: ${match?.homeTeamName || match?.homeTeam || "?"} - ${match?.awayTeamName || match?.awayTeam || "?"}`;
}

function collectMatches() {
  const meta = readJsonSafe(path.join("data", "meta.json"), {});
  const dates = Array.isArray(meta.dates) ? meta.dates : [];
  const fromDate = dateMinus(todayAmsterdamKey(), DEFAULT_LOOKBACK_DAYS);
  const splitMatches = dates
    .filter((dateKey) => dateKey >= fromDate)
    .flatMap((dateKey) => {
      const day = readJsonSafe(path.join("data", "days", `${dateKey}.json`), { matches: [] });
      return (Array.isArray(day.matches) ? day.matches : []).map((match) => ({ ...match, _dateKey: dateKey }));
    });

  if (splitMatches.length) return splitMatches;

  const serverData = readJsonSafe("server_data.json", {});
  return Object.entries(serverData.matches || {}).flatMap(([dateKey, matches]) =>
    (Array.isArray(matches) ? matches : []).map((match) => ({ ...match, _dateKey: dateKey }))
  );
}

function main() {
  const today = todayAmsterdamKey();
  const matches = collectMatches();
  const pastMatches = matches.filter((match) => isPastMatch(match, today));
  const pendingResultBackfills = pastMatches
    .filter((match) => !hasFinalScore(match) && String(match?.status || "").toUpperCase() === "RESULT_PENDING")
    .map(matchLabel);
  const missingPastScores = pastMatches
    .filter((match) => !hasFinalScore(match) && !["POSTPONED", "CANCELLED", "RESULT_PENDING"].includes(String(match?.status || "").toUpperCase()))
    .map(matchLabel);
  const h2hMissing = matches
    .filter((match) => Number(match?.h2h?.played || 0) <= 0)
    .map(matchLabel);
  const h2hCovered = matches.length - h2hMissing.length;
  const resultBackfillScore = pendingResultBackfills.length === 0 && missingPastScores.length === 0 ? "clean" : "needs_backfill";
  const h2hCoverage = matches.length ? Number((h2hCovered / matches.length).toFixed(3)) : 1;

  const report = {
    generatedAt: new Date().toISOString(),
    lookbackDays: DEFAULT_LOOKBACK_DAYS,
    totals: {
      matches: matches.length,
      pastMatches: pastMatches.length,
      pendingResultBackfills: pendingResultBackfills.length,
      missingPastScores: missingPastScores.length,
      h2hMissing: h2hMissing.length,
      h2hCovered,
      h2hCoverage,
    },
    status: {
      resultBackfill: resultBackfillScore,
      h2h: h2hCoverage >= 0.85 ? "healthy" : h2hCoverage >= 0.65 ? "watch" : "needs_backfill",
    },
    samples: {
      pendingResultBackfills: pendingResultBackfills.slice(0, 20),
      missingPastScores: missingPastScores.slice(0, 20),
      h2hMissing: h2hMissing.slice(0, 20),
    },
    recommendations: [
      pendingResultBackfills.length || missingPastScores.length
        ? "Vul eerst betrouwbare eindstanden aan voordat learning en ROI/CLV zwaarder worden gewogen."
        : "Resultaatbackfill is schoon binnen de auditperiode.",
      h2hCoverage < 0.85
        ? "Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking."
        : "H2H-dekking is voldoende voor de huidige auditperiode.",
    ],
  };

  const md = [
    "# Data Quality Audit",
    "",
    `Laatst bijgewerkt: ${report.generatedAt}`,
    `Lookback: ${DEFAULT_LOOKBACK_DAYS} dagen`,
    "",
    "## Scores",
    `- Wedstrijden: ${report.totals.matches}`,
    `- Oude wedstrijden: ${report.totals.pastMatches}`,
    `- Pending result backfills: ${report.totals.pendingResultBackfills}`,
    `- Ontbrekende oude scores: ${report.totals.missingPastScores}`,
    `- H2H-dekking: ${Math.round(report.totals.h2hCoverage * 100)}%`,
    "",
    "## Aanbevelingen",
    ...report.recommendations.map((item) => `- ${item}`),
    "",
    "## Samples",
    ...report.samples.pendingResultBackfills.map((item) => `- Pending: ${item}`),
    ...report.samples.missingPastScores.map((item) => `- Score mist: ${item}`),
    ...report.samples.h2hMissing.slice(0, 10).map((item) => `- H2H mist: ${item}`),
    "",
  ].join("\n");

  writeJson(OUTPUT_JSON, report);
  writeText(OUTPUT_MD, md);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main();
