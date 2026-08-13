#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { loadLocalEnv } from "../shared/database.js";
import { getApiFootballKey } from "./provider-env.js";
import {
  mergeApiFootballFixtureMappings,
  readApiFootballFixtureCache,
  writeApiFootballFixtureCache,
} from "./worker/api-football-fixture-cache.js";

const ROOT = process.cwd();
const DAYS_AHEAD = Math.max(1, Number(process.env.API_FOOTBALL_ACCEPTANCE_DAYS_AHEAD || 8));
const MAX_FIXTURES = Math.max(1, Number(process.env.API_FOOTBALL_ACCEPTANCE_LIMIT || 80));
const QUALIFIER_TARGET = Math.min(1, Math.max(0, Number(process.env.API_FOOTBALL_QUALIFIER_TARGET || 0.8)));
const FRIENDLY_TARGET = Math.min(1, Math.max(0, Number(process.env.API_FOOTBALL_FRIENDLY_TARGET || 0.6)));
const STRICT = String(process.env.API_FOOTBALL_ACCEPTANCE_STRICT || "false").toLowerCase() === "true";
const REPORT_PATH = path.join(ROOT, "monitor", "api-football-provider-acceptance.json");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(fc|afc|cf|sc|ac|as|club|football club|the|de|la)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function similarity(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 5 && b.includes(a)) return 0.94;
  if (b.length >= 5 && a.includes(b)) return 0.94;
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  const overlap = [...aTokens].filter((item) => bTokens.has(item)).length;
  return overlap / Math.max(1, Math.min(aTokens.size, bTokens.size));
}

function category(match) {
  const league = String(match?.league || "").toLowerCase();
  if (/europe\s*-\s*(champions|conference|europa) league/.test(league)) return "uefaQualification";
  if (/friendly/.test(league)) return "clubFriendly";
  return null;
}

function readDayMatches() {
  const now = Date.now();
  const rows = [];
  for (let offset = 0; offset <= DAYS_AHEAD; offset += 1) {
    const date = new Date(now + offset * 86400000).toISOString().slice(0, 10);
    const file = path.join(ROOT, "data", "days", `${date}.json`);
    if (!fs.existsSync(file)) continue;
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const match of Array.isArray(payload?.matches) ? payload.matches : []) {
      const matchCategory = category(match);
      const kickoff = Date.parse(match?.kickoff || "");
      if (!matchCategory || !Number.isFinite(kickoff) || kickoff <= now || !match?.homeTeamName || !match?.awayTeamName) continue;
      rows.push({
        id: String(match.id || match.sofaId || ""),
        date,
        kickoff: new Date(kickoff).toISOString(),
        league: match.league,
        homeTeam: match.homeTeamName,
        awayTeam: match.awayTeamName,
        category: matchCategory,
      });
    }
  }
  return rows.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)).slice(0, MAX_FIXTURES);
}

async function request(baseUrl, apiKey, pathname, params = {}) {
  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, String(value));
  const headers = { Accept: "application/json" };
  if (/rapidapi/i.test(url.hostname)) {
    headers["x-rapidapi-key"] = apiKey;
    headers["x-rapidapi-host"] = url.hostname;
  } else {
    headers["x-apisports-key"] = apiKey;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return {
      ok: response.ok && !Object.keys(payload?.errors || {}).length,
      status: response.status,
      payload,
      quota: {
        dailyRemaining: response.headers.get("x-ratelimit-requests-remaining"),
        minuteRemaining: response.headers.get("x-ratelimit-remaining"),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function findFixture(match, rows) {
  let best = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const direct = Math.min(similarity(match.homeTeam, row?.teams?.home?.name), similarity(match.awayTeam, row?.teams?.away?.name));
    const reversed = Math.min(similarity(match.homeTeam, row?.teams?.away?.name), similarity(match.awayTeam, row?.teams?.home?.name));
    const confidence = Math.max(direct, reversed);
    if (confidence < 0.82 || (best && best.confidence >= confidence)) continue;
    best = { fixtureId: String(row?.fixture?.id || ""), confidence, reversed: reversed > direct };
  }
  return best?.fixtureId ? best : null;
}

function summary(rows, key, target) {
  const subset = rows.filter((row) => row.category === key);
  const mapped = subset.filter((row) => row.fixtureId).length;
  const coverage = subset.length ? mapped / subset.length : 0;
  return { checked: subset.length, mapped, coverage: Number(coverage.toFixed(3)), target, passed: subset.length > 0 && coverage >= target };
}

async function main() {
  loadLocalEnv(ROOT);
  const apiKey = getApiFootballKey();
  if (!apiKey) throw new Error("API_KEY_API_FOOTBALL ontbreekt.");
  const baseUrl = String(process.env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io").replace(/\/$/, "");
  const rows = readDayMatches();
  const perDate = new Map();
  for (const row of rows) (perDate.get(row.date) || (perDate.set(row.date, []), perDate.get(row.date))).push(row);
  const quota = [];
  const errors = [];
  for (const [date, matches] of perDate) {
    const result = await request(baseUrl, apiKey, "/fixtures", { date });
    quota.push(result.quota);
    if (!result.ok) {
      errors.push({ endpoint: "fixtures", date, status: result.status, message: result.payload?.errors || result.payload?.message || null });
      continue;
    }
    for (const match of matches) Object.assign(match, findFixture(match, result.payload?.response));
  }
  const uefaQualification = summary(rows, "uefaQualification", QUALIFIER_TARGET);
  const clubFriendly = summary(rows, "clubFriendly", FRIENDLY_TARGET);
  const report = {
    generatedAt: new Date().toISOString(),
    provider: "api-football",
    baseHost: new URL(baseUrl).hostname,
    calls: perDate.size,
    quota,
    errors,
    targets: { uefaQualification, clubFriendly },
    accepted: uefaQualification.passed && clubFriendly.passed,
    matches: rows.map(({ id, date, league, homeTeam, awayTeam, category: matchCategory, fixtureId, confidence }) => ({ id, date, league, homeTeam, awayTeam, category: matchCategory, fixtureId: fixtureId || null, confidence: confidence || 0 })),
  };
  const fixtureCache = mergeApiFootballFixtureMappings(readApiFootballFixtureCache(ROOT), rows);
  writeApiFootballFixtureCache(ROOT, fixtureCache);
  report.fixtureCache = {
    mappedThisRun: fixtureCache.mapped,
    total: fixtureCache.total,
    storage: "git_cache_with_neon_replay",
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (STRICT && !report.accepted) process.exitCode = 1;
}

main().catch((error) => {
  const report = {
    generatedAt: new Date().toISOString(),
    provider: "api-football",
    accepted: false,
    targets: {
      uefaQualification: { checked: 0, mapped: 0, coverage: 0, target: QUALIFIER_TARGET, passed: false },
      clubFriendly: { checked: 0, mapped: 0, coverage: 0, target: FRIENDLY_TARGET, passed: false },
    },
    errors: [{ endpoint: "acceptance", status: null, message: error?.message || String(error) }],
    matches: [],
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (STRICT) process.exitCode = 1;
});
