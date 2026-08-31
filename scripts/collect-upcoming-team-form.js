#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fetchTheSportsDbTeamForm } from "./providers/thesportsdb-team-form-provider.js";
import { fetchFotMobTeamForm } from "./providers/fotmob-team-form-provider.js";
import { canonicalDedupeTeam } from "../shared/matchNormalization.js";
import { loadSnapshotLedger } from "../shared/predictionSnapshotLedger.js";
import { buildLocalTeamFormIndex, dayPayloadsFromHistorySummary, dayPayloadsFromSnapshotLedger, mergeLocalTeamForm } from "./worker/local-team-form-history.js";
import { shouldRefreshTeamFormCache } from "./worker/team-form-cache-policy.js";

const ROOT = process.cwd();
const DAYS_AHEAD = Math.max(1, Number(process.env.FORM_ENRICHMENT_DAYS_AHEAD || 7));
const MAX_TEAMS = Math.max(1, Number(process.env.FORM_ENRICHMENT_MAX_TEAMS || 20));
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.FORM_ENRICHMENT_REQUEST_TIMEOUT_MS || 3000));
const TEAM_TIMEOUT_MS = Math.max(1000, Number(process.env.FORM_ENRICHMENT_TEAM_TIMEOUT_MS || 7000));
const RUN_BUDGET_MS = Math.max(10000, Number(process.env.FORM_ENRICHMENT_RUN_BUDGET_MS || 90000));
const SUCCESS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PARTIAL_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const UNAVAILABLE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const TARGET_FORM_MATCHES = Math.max(5, Number(process.env.FORM_ENRICHMENT_TARGET_MATCHES || 10));
const CACHE_FILE = path.join(ROOT, "data", "team-form-cache.json");
const REPORT_FILE = path.join(ROOT, "monitor", "upcoming-team-form-enrichment.json");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function variants(name) {
  const value = String(name || "").trim();
  const stripped = value.replace(/\b(fc|cf|afc|sc|fk|as|rcd|ac)\b\.?/gi, " ").replace(/\s+/g, " ").trim();
  return [...new Set([value, stripped].filter(Boolean))];
}

function todayKey() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(dateKey, offset) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function readJson(file, fallback) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

const cachePayload = readJson(CACHE_FILE, { teams: {} });
const cache = cachePayload?.teams && typeof cachePayload.teams === "object" ? cachePayload.teams : {};
const rejectedSportsPattern = /volleyball|basketball|baseball|ice hockey|handball|rugby|cricket/i;
let rejectedWrongSport = 0;
for (const [key, value] of Object.entries(cache)) {
  if (value?.data?.recentMatches?.some((match) => rejectedSportsPattern.test(String(match?.league || "")))) {
    delete cache[key];
    rejectedWrongSport += 1;
  }
}
const teamTargets = new Map();
function fotmobTeamId(value) {
  const match = String(value || "").match(/(?:^|:)fotmob-(\d+)$/i) || String(value || "").match(/^fotmob-(\d+)$/i);
  return match?.[1] || null;
}
function addTeamTarget(name, id, kickoff) {
  if (!name) return;
  const current = teamTargets.get(String(name)) || { name: String(name), fotmobTeamId: null, kickoff: null };
  current.fotmobTeamId ||= fotmobTeamId(id);
  if (kickoff && (!current.kickoff || Date.parse(kickoff) < Date.parse(current.kickoff))) current.kickoff = kickoff;
  teamTargets.set(String(name), current);
}
for (let offset = 0; offset <= DAYS_AHEAD; offset += 1) {
  const dateKey = addDays(todayKey(), offset);
  const day = readJson(path.join(ROOT, "data", "days", `${dateKey}.json`), null);
  for (const match of day?.matches || []) {
    addTeamTarget(match?.homeTeamName, match?.homeTeamId, match?.kickoff);
    addTeamTarget(match?.awayTeamName, match?.awayTeamId, match?.kickoff);
  }
}
const teamNames = new Set([...teamTargets.keys()]);

const now = Date.now();
const requestState = { count: 0, max: MAX_TEAMS, lastAt: 0, blockedUntil: 0 };
const report = {
  generatedAt: new Date().toISOString(),
  daysAhead: DAYS_AHEAD,
  targetMatchesPerTeam: TARGET_FORM_MATCHES,
  candidates: teamNames.size,
  checked: 0,
  enriched: 0,
  unavailable: 0,
  timedOut: 0,
  skippedFresh: 0,
  runBudgetMs: RUN_BUDGET_MS,
  teamTimeoutMs: TEAM_TIMEOUT_MS,
  budgetExceeded: false,
  rejectedWrongSport,
  localHistoryTeams: 0,
  localHistoryMatches: 0,
  localFriendlyHistoryMatches: 0,
  samples: [],
};

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTeamProfile(args) {
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const fotmob = await fetchFotMobTeamForm({
          teamId: args.fotmobTeamId,
          teamName: args.teamName,
          fetchImpl: args.fetchImpl,
          now: args.now,
        });
        if (Number(fotmob?.recentMatches?.length || 0) >= TARGET_FORM_MATCHES) return fotmob;
        const sportsDb = await fetchTheSportsDbTeamForm(args);
        if (!fotmob) return sportsDb;
        if (!sportsDb) return fotmob;
        const merged = mergeLocalTeamForm(fotmob, sportsDb.recentMatches, args.teamName, { now: args.now });
        return { ...merged, source: "fotmob-team-fixtures+thesportsdb-recent-results" };
      })(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), TEAM_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const historicalDays = fs.readdirSync(path.join(ROOT, "data", "days"))
  .filter((fileName) => /^\d{4}-\d{2}-\d{2}\.json$/.test(fileName))
  .map((fileName) => readJson(path.join(ROOT, "data", "days", fileName), null))
  .filter(Boolean);
const snapshotLedgerLoad = await loadSnapshotLedger({ root: ROOT });
const ledgerDays = dayPayloadsFromSnapshotLedger(snapshotLedgerLoad.ledger);
const historyDays = dayPayloadsFromHistorySummary(readJson(path.join(ROOT, "data", "history-summary.json"), {}));
const localFormIndex = buildLocalTeamFormIndex([...historicalDays, ...ledgerDays, ...historyDays], { now: Date.now() });
report.immutableLedgerMatches = ledgerDays.reduce((sum, day) => sum + day.matches.length, 0);
report.immutableHistorySummaryMatches = historyDays.reduce((sum, day) => sum + day.matches.length, 0);
report.r2LedgerAvailable = Boolean(snapshotLedgerLoad.sources.r2?.available);
report.r2LedgerError = snapshotLedgerLoad.sources.r2?.error || null;

const pendingTeams = [...teamNames]
  .sort((left, right) => {
    const leftCount = Number(cache[normalize(left)]?.data?.recentMatches?.length || 0);
    const rightCount = Number(cache[normalize(right)]?.data?.recentMatches?.length || 0);
    const leftKickoff = Date.parse(teamTargets.get(left)?.kickoff || "") || Number.MAX_SAFE_INTEGER;
    const rightKickoff = Date.parse(teamTargets.get(right)?.kickoff || "") || Number.MAX_SAFE_INTEGER;
    return leftKickoff - rightKickoff || leftCount - rightCount || left.localeCompare(right);
  })
  .filter((teamName) => {
    const existing = cache[normalize(teamName)];
    if (shouldRefreshTeamFormCache({
      entry: existing,
      now,
      targetMatches: TARGET_FORM_MATCHES,
      successTtlMs: SUCCESS_CACHE_TTL_MS,
      partialTtlMs: PARTIAL_CACHE_TTL_MS,
      unavailableTtlMs: UNAVAILABLE_CACHE_TTL_MS,
      hasFotmobTarget: Boolean(teamTargets.get(teamName)?.fotmobTeamId),
    })) return true;
    report.skippedFresh += 1;
    return false;
  })
  .slice(0, MAX_TEAMS);

for (const teamName of pendingTeams) {
  if (Date.now() - now >= RUN_BUDGET_MS) {
    report.budgetExceeded = true;
    break;
  }
  const key = normalize(teamName);
  report.checked += 1;
  const profile = await fetchTeamProfile({
    teamName,
    fotmobTeamId: teamTargets.get(teamName)?.fotmobTeamId,
    cache,
    nameVariants: variants,
    now,
    requestState,
    fetchImpl: fetchWithTimeout,
    maxSearchVariants: 1,
    minRecentMatches: TARGET_FORM_MATCHES,
    partialTtlMs: PARTIAL_CACHE_TTL_MS,
  });
  if (profile?.recentMatches?.length) {
    report.enriched += 1;
    report.samples.push({ team: teamName, matches: profile.recentMatches.length, providerTeam: profile.providerTeamName });
    cache[key] = {
      updatedAt: new Date().toISOString(),
      providerCheckedAt: new Date().toISOString(),
      data: profile,
    };
  } else {
    report.unavailable += 1;
    if (profile?.timedOut) report.timedOut += 1;
    cache[key] = {
      updatedAt: new Date().toISOString(),
      providerCheckedAt: new Date().toISOString(),
      unavailable: true,
      reason: profile?.timedOut ? "team_timeout" : "not_found",
    };
  }
}

for (const teamName of teamNames) {
  const key = normalize(teamName);
  const localMatches = localFormIndex.get(canonicalDedupeTeam(teamName)) || [];
  if (!localMatches.length) continue;
  const current = cache[key] || {};
  const data = mergeLocalTeamForm(current.data || null, localMatches, teamName, { now });
  cache[key] = { ...current, updatedAt: new Date(now).toISOString(), data };
  report.localHistoryTeams += 1;
  report.localHistoryMatches += localMatches.length;
  report.localFriendlyHistoryMatches += localMatches.filter((match) => match.friendly).length;
}

fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
fs.writeFileSync(CACHE_FILE, `${JSON.stringify({ schemaVersion: "team-form-cache-v1", generatedAt: report.generatedAt, teams: cache })}\n`);
fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
