#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fetchTheSportsDbTeamForm } from "./providers/thesportsdb-team-form-provider.js";

const ROOT = process.cwd();
const DAYS_AHEAD = Math.max(1, Number(process.env.FORM_ENRICHMENT_DAYS_AHEAD || 7));
const MAX_TEAMS = Math.max(1, Number(process.env.FORM_ENRICHMENT_MAX_TEAMS || 60));
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
const teamNames = new Set();
for (let offset = 0; offset <= DAYS_AHEAD; offset += 1) {
  const dateKey = addDays(todayKey(), offset);
  const day = readJson(path.join(ROOT, "data", "days", `${dateKey}.json`), null);
  for (const match of day?.matches || []) {
    if (match?.homeTeamName) teamNames.add(String(match.homeTeamName));
    if (match?.awayTeamName) teamNames.add(String(match.awayTeamName));
  }
}

const now = Date.now();
const requestState = { count: 0, max: MAX_TEAMS, lastAt: 0, blockedUntil: 0 };
const report = { generatedAt: new Date().toISOString(), daysAhead: DAYS_AHEAD, candidates: teamNames.size, checked: 0, enriched: 0, unavailable: 0, skippedFresh: 0, samples: [] };

for (const teamName of [...teamNames].sort().slice(0, MAX_TEAMS)) {
  const key = normalize(teamName);
  const existing = cache[key];
  if (existing?.data && now - Number(existing.updatedAt || 0) < 12 * 60 * 60 * 1000) {
    report.skippedFresh += 1;
    continue;
  }
  report.checked += 1;
  const profile = await fetchTheSportsDbTeamForm({ teamName, cache, nameVariants: variants, now, requestState });
  if (profile?.recentMatches?.length) {
    report.enriched += 1;
    report.samples.push({ team: teamName, matches: profile.recentMatches.length, providerTeam: profile.providerTeamName });
  } else {
    report.unavailable += 1;
  }
}

fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
fs.writeFileSync(CACHE_FILE, `${JSON.stringify({ schemaVersion: "team-form-cache-v1", generatedAt: report.generatedAt, teams: cache })}\n`);
fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
