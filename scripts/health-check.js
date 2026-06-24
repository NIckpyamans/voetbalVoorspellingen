#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { addDaysToDateKey } from "../shared/date.js";
import { buildFixtureCalendarStatus } from "../shared/fixtureCalendar.js";
import { buildCupSheetsFromMatches } from "../shared/cupSheets.js";

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, "server_data.json");
const FINDINGS_FILE = path.join(ROOT, "monitor", "daily-findings.json");
const MAX_WORKER_AGE_MINUTES = Number(process.env.HEALTH_MAX_WORKER_AGE_MINUTES || 180);
const WRITE_FINDINGS = process.env.HEALTH_WRITE_FINDINGS !== "false";

const FILES = {
  app: path.join(ROOT, "App.tsx"),
  matchCard: path.join(ROOT, "components", "MatchCard.tsx"),
  livePanel: path.join(ROOT, "components", "LivePanel.tsx"),
  worker: path.join(ROOT, "scripts", "server-worker.js"),
  matchService: path.join(ROOT, "services", "matchService.ts"),
  minuteHelper: path.join(ROOT, "shared", "minute.js"),
  logo: path.join(ROOT, "api", "logo.ts"),
  standings: path.join(ROOT, "api", "standings.ts"),
  health: path.join(ROOT, "api", "health.ts"),
  status: path.join(ROOT, "api", "health.ts"),
  systemCheck: path.join(ROOT, "api", "health.ts"),
  logger: path.join(ROOT, "shared", "logger.js"),
  http: path.join(ROOT, "shared", "http.js"),
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

function readStore() {
  const meta = readJsonSafe(path.join(ROOT, "data", "meta.json"), {});
  const hasSplitData = !!meta?.lastRun || Array.isArray(meta?.dates);
  if (!hasSplitData) {
    const fullStore = readJsonSafe(DATA_FILE, null);
    if (fullStore) return fullStore;
  }
  const store = {
    ...meta,
    matches: {},
    predictions: {},
    postMatchReviews: {},
  };
  const standingsExport = readJsonSafe(path.join(ROOT, "data", "standings.json"), {});
  if (standingsExport && typeof standingsExport === "object") {
    store.standings = standingsExport.standings || store.standings || {};
    store.cupSheets = standingsExport.cupSheets || store.cupSheets || {};
    store.knockoutOverview = standingsExport.knockoutOverview || store.knockoutOverview || {};
  }
  const phaseExport = readJsonSafe(path.join(ROOT, "data", "phase-reliability.json"), {});
  const historyExport = readJsonSafe(path.join(ROOT, "data", "history-summary.json"), {});
  store.phaseReliability = phaseExport.phaseReliability || historyExport.phaseReliability || store.phaseReliability || {};
  const daysDir = path.join(ROOT, "data", "days");
  if (!fs.existsSync(daysDir)) return null;
  for (const entry of fs.readdirSync(daysDir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(entry)) continue;
    const dateKey = entry.replace(/\.json$/, "");
    const day = readJsonSafe(path.join(daysDir, entry), {});
    store.matches[dateKey] = Array.isArray(day.matches) ? day.matches : [];
    store.predictions[dateKey] = Array.isArray(day.predictions) ? day.predictions : [];
    Object.assign(store.postMatchReviews, day.reviews || {});
  }
  return store;
}

function writeJson(filePath, value) {
  ensureDir(filePath);
  const payload = JSON.stringify(value, null, 2);
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.writeFileSync(filePath, payload);
      return;
    } catch (error) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
  }

  throw lastError;
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
  const tomorrow = addDaysToDateKey(today, 1);
  const store = readStore();

  if (!store) {
    pushIssue(issues, "worker_data_missing", "high", "Workerdata ontbreekt of is ongeldig.");
    return { issues, stats: { today, dataPresent: false } };
  }

  const lastRun = Number(store.lastRun || 0);
  const ageMinutes = lastRun ? Math.round((Date.now() - lastRun) / 60000) : null;
  const todayMatches = Array.isArray(store.matches?.[today]) ? store.matches[today] : [];
  const tomorrowMatches = Array.isArray(store.matches?.[tomorrow]) ? store.matches[tomorrow] : [];
  const lastRunFresh = !!lastRun && ageMinutes != null && ageMinutes <= MAX_WORKER_AGE_MINUTES;
  const fixtureDays = Object.fromEntries(
    Array.isArray(store.dates)
      ? store.dates.map((dateKey) => [dateKey, store.matches?.[dateKey] || []])
      : Object.entries(store.matches || {})
  );
  const fixtureCalendar = buildFixtureCalendarStatus({
    today,
    days: fixtureDays,
    meta: store,
    lastRunFresh,
  });
  const standingsCount = Object.keys(store.standings || {}).length;
  const cupSheetCount = Object.keys(
    Object.keys(store.cupSheets || {}).length ? store.cupSheets : buildCupSheetsFromMatches(store)
  ).length;
  const phaseReliabilityCount = Object.keys(store.phaseReliability || {}).length;
  const allMatches = Object.values(store.matches || {}).flatMap((rows) => Array.isArray(rows) ? rows : []);
  const hasCupMatches = allMatches.some((match) => {
    const league = String(match?.league || "").toLowerCase();
    return match?.aggregate?.active || /cup|beker|champions league|europa league|conference league/.test(league);
  });
  const reviewCount = Object.keys(store.postMatchReviews || {}).length || Number(store.reviewCount || 0);
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
  } else if (!lastRunFresh) {
    pushIssue(issues, "worker_stale", "high", `Workerdata is ${ageMinutes} minuten oud.`);
  }

  if (!todayMatches.length && !fixtureCalendar.emptyWindowOk) {
    pushIssue(issues, "today_matches_empty", "medium", "Er zijn geen wedstrijden voor vandaag in workerdata.");
  }

  if (!fixtureCalendar.healthy) {
    pushIssue(issues, "fixture_calendar_source_gap", "medium", fixtureCalendar.explanation, {
      checkedDates: fixtureCalendar.checkedDates,
      nextMatchDate: fixtureCalendar.nextMatchDate,
    });
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

  if (cupSheetCount === 0 && hasCupMatches) {
    pushIssue(issues, "cupsheets_empty", "medium", "cupSheets is leeg.");
  }

  if (phaseReliabilityCount === 0 && reviewCount > 0) {
    pushIssue(issues, "phase_reliability_empty", "medium", "phaseReliability is leeg.");
  }

  const marketWithoutBookmakers = todayMatches.filter(
    (match) =>
      !!match.marketCalibration &&
      (!Array.isArray(match.marketCalibration.bookmakerSignals) || !match.marketCalibration.bookmakerSignals.length)
  );
  if (todayMatches.length && marketWithoutBookmakers.length === todayMatches.length) {
    pushIssue(
      issues,
      "bookmaker_signals_missing",
      "medium",
      "Alle wedstrijden missen bookmaker-signalen in de marktcalibratie."
    );
  }

  const matchesWithRefereeName = todayMatches.filter((match) => String(match.refereeProfile?.name || "").trim());
  const historicalRefs = todayMatches.filter((match) => Number(match.refereeProfile?.matches || 0) > 0);
  if (matchesWithRefereeName.length >= 3 && historicalRefs.length === 0) {
    pushIssue(
      issues,
      "historical_referee_unmatched",
      "low",
      "Geen enkele wedstrijd van vandaag gebruikt historische referee-data."
    );
  }

  if (standingsCount === 0 && cupSheetCount === 0 && (todayMatches.length > 0 || tomorrowMatches.length > 0)) {
    pushIssue(issues, "standings_empty", "high", "Standings/cupSheets zijn leeg.");
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
      tomorrow,
      dataPresent: true,
      lastRun,
      ageMinutes,
      maxWorkerAgeMinutes: MAX_WORKER_AGE_MINUTES,
      todayMatches: todayMatches.length,
      tomorrowMatches: tomorrowMatches.length,
      fixtureCalendar,
      liveMatches: liveMatches.length,
      liveWithoutMinute: liveWithoutMinute.length,
      h2hFilled: todayMatches.length - h2hEmpty.length,
      h2hMissing: h2hEmpty.length,
      standingsCount,
      cupSheetCount,
      phaseReliabilityCount,
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
  const minuteHelperText = readText(FILES.minuteHelper);
  const logoText = readText(FILES.logo);
  const loggerText = readText(FILES.logger);
  const httpText = readText(FILES.http);

  if (!appText.includes("belongsToSelectedDate")) {
    pushIssue(issues, "date_filter_missing", "high", "Dashboard mist een expliciete dagfilterfunctie.");
  }

  if (!workerText.includes("resolveMinuteState")) {
    pushIssue(issues, "minute_fallback_missing", "high", "Worker mist de extra minute fallback-logica.");
  }

  if (!workerText.includes("buildRefereeAliasVariants")) {
    pushIssue(issues, "referee_alias_cache_missing", "medium", "Worker mist een bredere referee alias-cache.");
  }

  if (!workerText.includes("bookmakerSignals")) {
    pushIssue(issues, "bookmaker_signal_logic_missing", "medium", "Worker mist bookmaker-specifieke closing-signalen.");
  }

  if (!workerText.includes("\"qualification\"") || !workerText.includes("\"friendly\"")) {
    pushIssue(issues, "phase_buckets_missing", "medium", "Worker mist fijnere fasegroepen zoals qualification/friendly.");
  }

  if (!matchServiceText.includes("normalizeMinute")) {
    pushIssue(issues, "matchservice_normalize_missing", "medium", "matchService normaliseert minute niet.");
  }

  if (!minuteHelperText.includes("getLiveMinuteLabel")) {
    pushIssue(issues, "minute_helper_missing", "medium", "Gedeelde minute-helper ontbreekt.");
  }

  if (!logoText.includes("/api/logo") && !matchCardText.includes("/api/logo?id=")) {
    pushIssue(issues, "logo_fallback_missing", "medium", "Logo fallback lijkt niet actief.");
  }

  if (!loggerText.includes("createLogger")) {
    pushIssue(issues, "structured_logging_missing", "medium", "Gedeelde structured logger ontbreekt.");
  }

  if (!httpText.includes("fetchWithRetry")) {
    pushIssue(issues, "retry_helper_missing", "medium", "Gedeelde retry-helper ontbreekt.");
  }

  if (!readText(FILES.health).includes("sendSystemHealth") || !readText(FILES.systemCheck).includes("sendSystemHealth")) {
    pushIssue(issues, "health_endpoints_missing", "high", "Health/status/system-check endpoints ontbreken of zijn niet gekoppeld.");
  }

  const parserHits = [matchCardText, livePanelText, matchServiceText]
    .map((text) => (text.includes("function parseMinuteValue") ? 1 : 0))
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
    shouldNotify: false,
  };

  if (WRITE_FINDINGS) storeFindings(output);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main();
