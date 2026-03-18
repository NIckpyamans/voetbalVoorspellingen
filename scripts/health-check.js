#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, "server_data.json");
const FINDINGS_FILE = path.join(ROOT, "monitor", "daily-findings.json");

const FILES = {
  app: path.join(ROOT, "App.tsx"),
  matchCard: path.join(ROOT, "MatchCard.tsx"),
  livePanel: path.join(ROOT, "LivePanel.tsx"),
  worker: path.join(ROOT, "server-worker.js"),
  matchService: path.join(ROOT, "matchService.ts"),
  logo: path.join(ROOT, "logo.ts"),
  standings: path.join(ROOT, "standings.ts"),
};

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readText(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  } catch {
    return "";
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

function nowIso() {
  return new Date().toISOString();
}

function pushIssue(issues, key, severity, message, details = {}) {
  issues.push({ key, severity, message, details });
}

function uniqueIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.key}::${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectDataChecks() {
  const issues = [];
  const today = amsterdamDate();
  const store = readJsonSafe(DATA_FILE, null);

  if (!store) {
    pushIssue(issues, "server_data_missing", "high", "server_data.json ontbreekt of is ongeldig.");
    return { issues, stats: { today, dataPresent: false } };
  }

  const lastRun = Number(store.lastRun || 0);
  const ageMinutes = lastRun ? Math.round((Date.now() - lastRun) / 60000) : null;
  const todayMatches = Array.isArray(store.matches?.[today]) ? store.matches[today] : [];
  const standingsCount = Object.keys(store.standings || {}).length;
  const cupSheetCount = Object.keys(store.cupSheets || {}).length;
  const liveMatches = todayMatches.filter((match) => String(match.status || "").toUpperCase() === "LIVE");
  const liveWithoutMinute = liveMatches.filter(
    (match) => !match.minute && !match.minuteValue && !String(match.period || "").toLowerCase().includes("half time")
  );
  const h2hEmpty = todayMatches.filter((match) => !match.h2h?.played);
  const dateMismatches = todayMatches.filter((match) => {
    const kickoff = match.kickoff ? new Date(match.kickoff) : null;
    if (!kickoff || Number.isNaN(kickoff.getTime())) return false;
    return amsterdamDate(kickoff) !== today;
  });

  if (!lastRun) {
    pushIssue(issues, "worker_last_run_missing", "high", "Worker heeft geen lastRun opgeslagen.");
  } else if (ageMinutes != null && ageMinutes > 90) {
    pushIssue(issues, "worker_stale", "high", `server_data.json is ${ageMinutes} minuten oud.`);
  }

  if (!todayMatches.length) {
    pushIssue(issues, "today_matches_empty", "medium", "Er zijn geen wedstrijden voor vandaag in server_data.json.");
  }

  if (liveMatches.length && liveWithoutMinute.length) {
    pushIssue(
      issues,
      "live_minute_missing",
      "high",
      `${liveWithoutMinute.length} live wedstrijd(en) missen minute/minuteValue.`,
      { matchIds: liveWithoutMinute.map((match) => match.id).slice(0, 10) }
    );
  }

  if (todayMatches.length && h2hEmpty.length === todayMatches.length) {
    pushIssue(issues, "h2h_empty", "medium", "Alle wedstrijden van vandaag hebben lege H2H-data.");
  }

  if (cupSheetCount === 0) {
    pushIssue(issues, "cupsheets_empty", "medium", "cupSheets is leeg.");
  }

  if (standingsCount === 0) {
    pushIssue(issues, "standings_empty", "high", "Standings is leeg.");
  }

  if (dateMismatches.length) {
    pushIssue(
      issues,
      "dashboard_wrong_day",
      "high",
      `${dateMismatches.length} wedstrijd(en) in vandaag-data hebben een kickoff buiten de gekozen dag.`,
      { matchIds: dateMismatches.map((match) => match.id).slice(0, 10) }
    );
  }

  return {
    issues,
    stats: {
      today,
      dataPresent: true,
      lastRun,
      ageMinutes,
      todayMatches: todayMatches.length,
      liveMatches: liveMatches.length,
      liveWithoutMinute: liveWithoutMinute.length,
      h2hFilled: todayMatches.length - h2hEmpty.length,
      h2hMissing: h2hEmpty.length,
      standingsCount,
      cupSheetCount,
    },
  };
}

function collectCodeChecks() {
  const issues = [];
  const appText = readText(FILES.app);
  const matchCardText = readText(FILES.matchCard);
  const livePanelText = readText(FILES.livePanel);
  const workerText = readText(FILES.worker);
  const matchServiceText = readText(FILES.matchService);
  const logoText = readText(FILES.logo);

  if (!appText.includes("belongsToSelectedDate")) {
    pushIssue(issues, "date_filter_missing", "high", "Dashboard mist een expliciete dagfilterfunctie.");
  }

  if (!matchCardText.includes("LIVE ") && !matchCardText.includes("LIVE nu")) {
    pushIssue(issues, "live_chip_missing", "high", "MatchCard toont geen duidelijke live-chip.");
  }

  if (!workerText.includes("resolveMinuteState")) {
    pushIssue(issues, "minute_fallback_missing", "high", "Worker mist de extra minute fallback-logica.");
  }

  if (!matchServiceText.includes("normalizeMinute")) {
    pushIssue(issues, "matchservice_normalize_missing", "medium", "matchService normaliseert minute niet.");
  }

  if (!logoText.includes("/api/logo") && !matchCardText.includes("/api/logo?id=")) {
    pushIssue(issues, "logo_fallback_missing", "medium", "Logo fallback lijkt niet actief.");
  }

  const parserHits = [matchCardText, livePanelText, matchServiceText]
    .map((text) => (text.includes("parseMinuteValue") ? 1 : 0))
    .reduce((sum, value) => sum + value, 0);

  if (parserHits >= 3) {
    pushIssue(
      issues,
      "duplicate_minute_logic",
      "low",
      "Minute parsing staat op meerdere plekken dubbel; bundelen in één helper zou onderhoud verbeteren."
    );
  }

  if (!matchCardText.includes("InsightGrid")) {
    pushIssue(issues, "insight_grid_missing", "low", "MatchCard mist een compact blok met kernsignalen.");
  }

  return { issues };
}

function storeFindings(result) {
  const findings = readJsonSafe(FINDINGS_FILE, { days: {} });
  const dayKey = amsterdamDate();
  const dayBucket = findings.days[dayKey] || { runs: [] };

  dayBucket.runs.push({
    timestamp: nowIso(),
    stats: result.stats,
    issues: result.issues,
  });

  findings.days[dayKey] = dayBucket;
  writeJson(FINDINGS_FILE, findings);
}

function main() {
  const dataChecks = collectDataChecks();
  const codeChecks = collectCodeChecks();
  const issues = uniqueIssues([...dataChecks.issues, ...codeChecks.issues]);
  const output = {
    timestamp: nowIso(),
    stats: dataChecks.stats,
    issues,
    shouldNotify: issues.length > 0,
  };

  storeFindings(output);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main();
