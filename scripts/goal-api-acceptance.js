#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getGoalApiKey } from "./provider-env.js";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "monitor", "goal-api-acceptance.json");
const DAYS = 14;
const TARGETS = {
  domestic: 0.8,
  uefa: 0.8,
  friendly: 0.6,
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

export function normalizeGoalApiName(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(fc|afc|cf|sc|club|fk|sv|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function similarity(left, right) {
  const a = normalizeGoalApiName(left);
  const b = normalizeGoalApiName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.94;
  const aa = new Set(a.split(" "));
  const bb = new Set(b.split(" "));
  return [...aa].filter((token) => bb.has(token)).length / Math.max(1, Math.min(aa.size, bb.size));
}

export function segmentForLeague(league) {
  if (/friendl/i.test(String(league || ""))) return "friendly";
  if (/^Europe -/i.test(String(league || ""))) return "uefa";
  return "domestic";
}

function localFixtures() {
  const rows = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + offset);
    const date = day.toISOString().slice(0, 10);
    const payload = readJson(path.join(ROOT, "data", "days", `${date}.json`), {});
    for (const match of payload.matches || []) {
      if (!match.homeTeamName || !match.awayTeamName) continue;
      rows.push({ date, league: match.league || "unknown", home: match.homeTeamName, away: match.awayTeamName });
    }
  }
  return rows;
}

async function requestDate(date, apiKey) {
  const response = await fetch(`https://api.goal-api.com/v1/fixtures/date/${date}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
  });
  const payload = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    rows: Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [],
    limits: {
      remaining: response.headers.get("x-ratelimit-remaining"),
      limit: response.headers.get("x-ratelimit-limit"),
      dailyRemaining: response.headers.get("x-ratelimit-daily-remaining"),
    },
  };
}

function matchFixture(local, providerRows) {
  return providerRows.find((row) => Math.min(
    similarity(local.home, row?.homeTeam?.name || row?.home_team?.name || row?.homeTeamName),
    similarity(local.away, row?.awayTeam?.name || row?.away_team?.name || row?.awayTeamName)
  ) >= 0.82) || null;
}

export function evaluateGoalApiAcceptance(history, checkedAt = new Date().toISOString()) {
  const validRuns = (history || []).filter((run) => run.providerReachable && run.checked > 0);
  const first = validRuns[0]?.checkedAt;
  const elapsedDays = first ? Math.floor((Date.parse(checkedAt) - Date.parse(first)) / 86400000) + 1 : 0;
  const aggregate = {};
  for (const segment of Object.keys(TARGETS)) {
    const checked = validRuns.reduce((sum, run) => sum + Number(run.segments?.[segment]?.checked || 0), 0);
    const mapped = validRuns.reduce((sum, run) => sum + Number(run.segments?.[segment]?.mapped || 0), 0);
    aggregate[segment] = { checked, mapped, coverage: checked ? Number((mapped / checked).toFixed(3)) : 0, target: TARGETS[segment] };
  }
  const enoughTime = elapsedDays >= DAYS;
  const enoughEvidence = Object.values(aggregate).every((item) => item.checked >= 5);
  const targetsMet = Object.values(aggregate).every((item) => item.coverage >= item.target);
  return { accepted: enoughTime && enoughEvidence && targetsMet, enoughTime, enoughEvidence, targetsMet, elapsedDays, requiredDays: DAYS, aggregate };
}

async function main() {
  const apiKey = getGoalApiKey();
  const previous = readJson(OUTPUT, { history: [] });
  const checkedAt = new Date().toISOString();
  if (!apiKey) {
    const report = { ...previous, checkedAt, configured: false, accepted: false, reason: "GOAL_API_KEY ontbreekt; provider blijft uitgeschakeld." };
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const fixtures = localFixtures();
  const byDate = new Map();
  for (const fixture of fixtures) {
    if (!byDate.has(fixture.date)) byDate.set(fixture.date, []);
    byDate.get(fixture.date).push(fixture);
  }
  const providerByDate = new Map();
  const requestStatuses = [];
  for (const date of byDate.keys()) {
    const result = await requestDate(date, apiKey).catch((error) => ({ ok: false, status: "request_failed", rows: [], error: error?.message || String(error) }));
    providerByDate.set(date, result.rows || []);
    requestStatuses.push({ date, status: result.status, records: result.rows?.length || 0, limits: result.limits || null });
  }
  const segments = Object.fromEntries(Object.keys(TARGETS).map((key) => [key, { checked: 0, mapped: 0 }]));
  const samples = [];
  for (const fixture of fixtures) {
    const segment = segmentForLeague(fixture.league);
    segments[segment].checked += 1;
    const hit = matchFixture(fixture, providerByDate.get(fixture.date) || []);
    if (hit) segments[segment].mapped += 1;
    else if (samples.length < 30) samples.push({ ...fixture, segment, status: "not_mapped" });
  }
  const run = { checkedAt, providerReachable: requestStatuses.some((item) => item.status === 200), checked: fixtures.length, mapped: Object.values(segments).reduce((sum, item) => sum + item.mapped, 0), segments, requestStatuses };
  const history = [...(previous.history || []), run].slice(-21);
  const evaluation = evaluateGoalApiAcceptance(history, checkedAt);
  const report = { schemaVersion: "goal-api-acceptance-v1", checkedAt, configured: true, ...evaluation, promotionMode: "manual_after_gate", history, missingSamples: samples };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, history: undefined }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((error) => { console.error(error); process.exit(1); });
