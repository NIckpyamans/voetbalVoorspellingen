#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const FINDINGS_FILE = path.join(ROOT, "monitor", "daily-findings.json");

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function amsterdamDate(input = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(input);
}

function summarizeIssues(runs) {
  const map = new Map();
  for (const run of runs) {
    for (const issue of run.issues || []) {
      if (!map.has(issue.key)) map.set(issue.key, issue);
    }
  }
  return [...map.values()];
}

function buildRecommendation(issue) {
  const recs = {
    live_minute_missing: "Controleer worker live feed en minute fallback in server-worker.js en MatchCard.tsx.",
    h2h_empty: "Controleer H2H-fetch en fallback vanuit recente wedstrijden.",
    cupsheets_empty: "Controleer knockout-opbouw en cupSheets-populatie in server-worker.js.",
    standings_empty: "Controleer standings fetch en opslag in server_data.json.",
    dashboard_wrong_day: "Controleer App.tsx dagfilter en data uit /api/matches.",
    duplicate_minute_logic: "Overweeg een gedeelde minute helper voor MatchCard, LivePanel en matchService.",
    logo_fallback_missing: "Controleer logo.ts en img-fallbacks in MatchCard.tsx.",
    phase_reliability_empty: "Controleer of reviews opnieuw worden opgebouwd en of phase buckets in server-worker.js gevuld worden.",
    bookmaker_signals_missing: "Controleer of marktprofielen bookmakerSignals en closing dekking meekrijgen uit football-data.co.uk.",
    historical_referee_unmatched: "Verbred de referee alias-cache of trek bredere historische competities in de cache.",
    referee_alias_cache_missing: "Voeg een competitie-specifieke referee alias-cache toe voor lossere naamkoppeling.",
    bookmaker_signal_logic_missing: "Voeg bookmaker-specifieke closing-signalen toe naast de samengestelde consensuslaag.",
    phase_buckets_missing: "Splits betrouwbaarheid verder uit naar qualification, friendly, league, cup en two-leg knockout.",
  };
  return recs[issue.key] || "Controleer de betrokken bestanden en maak een gerichte patchvoorstel-branch.";
}

function main() {
  const findings = readJsonSafe(FINDINGS_FILE, { days: {} });
  const todayKey = amsterdamDate();
  const runs = findings.days?.[todayKey]?.runs || [];

  if (!runs.length) {
    process.stdout.write(JSON.stringify({ shouldNotify: false, reason: "Geen runs vandaag." }, null, 2) + "\n");
    return;
  }

  const issues = summarizeIssues(runs);
  if (!issues.length) {
    process.stdout.write(JSON.stringify({ shouldNotify: false, reason: "Geen relevante bevindingen vandaag." }, null, 2) + "\n");
    return;
  }

  const latestStats = runs[runs.length - 1]?.stats || {};
  const report = {
    shouldNotify: false,
    date: todayKey,
    summary: `FootyAI dagrapport: ${issues.length} aandachtspunt(en) gevonden.`,
    latestStats,
    findings: issues.map((issue) => ({
      severity: issue.severity,
      message: issue.message,
      recommendation: buildRecommendation(issue),
      details: issue.details || {},
    })),
  };

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main();
