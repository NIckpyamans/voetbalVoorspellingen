#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fetchEspnSquad } from "./providers/espn-squad-provider.js";
import { fetchWikipediaSquad } from "./providers/wikipedia-squad-provider.js";

const ROOT = process.cwd();
const DAYS_AHEAD = Math.max(1, Number(process.env.SQUAD_ENRICHMENT_DAYS_AHEAD || 8));
const MAX_TEAMS = Math.max(1, Number(process.env.SQUAD_ENRICHMENT_MAX_TEAMS || 6));
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.SQUAD_ENRICHMENT_REQUEST_TIMEOUT_MS || 6000));
const REFRESH_TTL_MS = Math.max(60 * 60 * 1000, Number(process.env.SQUAD_ENRICHMENT_REFRESH_TTL_MS || 48 * 60 * 60 * 1000));
const UNAVAILABLE_TTL_MS = 6 * 60 * 60 * 1000;
const FORCE_UNAVAILABLE = String(process.env.SQUAD_ENRICHMENT_FORCE_UNAVAILABLE || "false").toLowerCase() === "true";
const CACHE_FILE = path.join(ROOT, "data", "team-squad-cache.json");
const TEAMS_FILE = path.join(ROOT, "data", "teams.json");
const REPORT_FILE = path.join(ROOT, "monitor", "upcoming-team-squad-enrichment.json");
const ESPN_TEAMS_FILE = path.join(ROOT, "config", "friendly-team-sources.json");
const SPORTS_DB_BASE = "https://www.thesportsdb.com/api/v1/json/123";

class ProviderRateLimitError extends Error {
  constructor(retryAfterSeconds = 0) {
    super("TheSportsDB rate limit reached");
    this.code = "provider_rate_limited";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function teamKey(name) {
  return `name:${normalize(name)}`;
}

function variants(name) {
  const value = String(name || "").trim();
  const stripped = value.replace(/\b(fc|cf|afc|sc|fk|as|rcd|ac)\b\.?/gi, " ").replace(/\s+/g, " ").trim();
  return [...new Set([value, stripped].filter(Boolean))].slice(0, 2);
}

function readJson(file, fallback) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function todayKey() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(dateKey, offset) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function mergePlayers(existing, incoming) {
  const byName = new Map();
  for (const player of [...(existing || []), ...(incoming || [])]) {
    const name = String(player?.name || "").trim();
    if (!name) continue;
    const key = normalize(name);
    const current = byName.get(key) || {};
    byName.set(key, {
      ...current,
      ...player,
      name,
      position: player.position || current.position || "",
      nationality: player.nationality || current.nationality || "",
      status: player.status || current.status || "beschikbaar",
      availability: player.availability || current.availability || "beschikbaar",
      sources: [...new Set([...(current.sources || []), ...(player.sources || []), player.source].filter(Boolean))],
    });
  }
  return [...byName.values()].sort((left, right) => String(left.position).localeCompare(String(right.position)) || left.name.localeCompare(right.name)).slice(0, 60);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Voetbal-Ai-tactics/1.0 (personal prediction app; cached public source enrichment)",
      },
      signal: controller.signal,
    });
    if (response.status === 429) {
      throw new ProviderRateLimitError(Number(response.headers.get("retry-after") || 0));
    }
    return response.ok ? await response.json() : null;
  } catch (error) {
    if (error?.code === "provider_rate_limited") throw error;
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSportsDbSquad(teamName) {
  let team = null;
  for (const query of variants(teamName)) {
    const payload = await fetchJson(`${SPORTS_DB_BASE}/searchteams.php?t=${encodeURIComponent(query)}`);
    team = (payload?.teams || []).find((item) => normalize(item?.strTeam) === normalize(teamName));
    if (team?.idTeam) break;
  }
  if (!team?.idTeam) return null;
  const payload = await fetchJson(`${SPORTS_DB_BASE}/lookup_all_players.php?id=${encodeURIComponent(team.idTeam)}`);
  const players = Array.isArray(payload?.player) ? payload.player : [];
  if (!players.length) return null;
  return {
    providerTeamId: String(team.idTeam),
    providerTeamName: String(team.strTeam || teamName),
    players: players.slice(0, 60).map((player) => ({
      id: player.idPlayer ? `thesportsdb:${player.idPlayer}` : "",
      name: player.strPlayer || "",
      position: player.strPosition || "",
      nationality: player.strNationality || "",
      dateBorn: player.dateBorn || null,
      status: player.strStatus || "beschikbaar",
      availability: player.strStatus || "beschikbaar",
      loan: /loan|huur|verhuur/i.test(String(player.strStatus || "")),
      source: "TheSportsDB",
      sources: ["TheSportsDB"],
    })),
  };
}

const cachePayload = readJson(CACHE_FILE, { teams: {} });
const cache = cachePayload?.teams && typeof cachePayload.teams === "object" ? cachePayload.teams : {};
const exportedTeams = readJson(TEAMS_FILE, {}).teamSquads || {};
const knownEspnTeams = readJson(ESPN_TEAMS_FILE, { teams: [] }).teams || [];
const candidates = new Map();
for (let offset = 0; offset <= DAYS_AHEAD; offset += 1) {
  const date = addDays(todayKey(), offset);
  const day = readJson(path.join(ROOT, "data", "days", `${date}.json`), null);
  for (const match of day?.matches || []) {
    for (const name of [match?.homeTeamName, match?.awayTeamName]) {
      if (!name) continue;
      const key = teamKey(name);
      const item = candidates.get(key) || { key, teamName: String(name), leagues: new Set() };
      if (match?.league) item.leagues.add(String(match.league));
      candidates.set(key, item);
    }
  }
}

const now = Date.now();
const report = { generatedAt: new Date().toISOString(), daysAhead: DAYS_AHEAD, candidates: candidates.size, checked: 0, enriched: 0, unavailable: 0, skippedFresh: 0, rateLimited: false, retryAfterSeconds: 0, byProvider: { TheSportsDB: 0, ESPN: 0, Wikipedia: 0 }, byCompetition: {}, samples: [] };
const pending = [...candidates.values()]
  .map((candidate) => {
    const existing = cache[candidate.key] || exportedTeams[candidate.key] || null;
    return { ...candidate, existing, playerCount: Number(existing?.playerCount || existing?.players?.length || 0) };
  })
  .filter((candidate) => {
    if (FORCE_UNAVAILABLE && candidate.existing?.unavailable) return true;
    const age = now - Date.parse(candidate.existing?.fetchedAt || candidate.existing?.checkedAt || 0);
    const ttl = candidate.existing?.unavailable ? UNAVAILABLE_TTL_MS : REFRESH_TTL_MS;
    if (candidate.existing?.fetchedAt && age < ttl) {
      report.skippedFresh += 1;
      return false;
    }
    return true;
  })
  .sort((left, right) => {
    const leftLeague = [...left.leagues].sort()[0] || "";
    const rightLeague = [...right.leagues].sort()[0] || "";
    return left.playerCount - right.playerCount || leftLeague.localeCompare(rightLeague) || left.teamName.localeCompare(right.teamName);
  })
  .slice(0, MAX_TEAMS);

for (const candidate of pending) {
  report.checked += 1;
  let profile = null;
  let provider = "";
  if (!report.rateLimited) {
    try {
      profile = await fetchSportsDbSquad(candidate.teamName);
      if (profile) provider = "TheSportsDB";
    } catch (error) {
      if (error?.code === "provider_rate_limited") {
        report.rateLimited = true;
        report.retryAfterSeconds = Number(error.retryAfterSeconds || 0);
      } else {
        throw error;
      }
    }
  }
  if (!profile) {
    try {
      profile = await fetchEspnSquad({
        teamName: candidate.teamName,
        leagues: [...candidate.leagues],
        knownTeams: knownEspnTeams,
        fetchJson,
      });
      if (profile) provider = "ESPN";
    } catch (error) {
      if (error?.code === "provider_rate_limited") {
        report.rateLimited = true;
        report.retryAfterSeconds = Math.max(report.retryAfterSeconds, Number(error.retryAfterSeconds || 0));
      } else {
        throw error;
      }
    }
  }
  if (!profile) {
    profile = await fetchWikipediaSquad({ teamName: candidate.teamName, fetchJson });
    if (profile) provider = "Wikipedia";
  }
  const competition = [...candidate.leagues][0] || "onbekend";
  report.byCompetition[competition] = report.byCompetition[competition] || { checked: 0, enriched: 0, unavailable: 0 };
  report.byCompetition[competition].checked += 1;
  if (!profile) {
    report.unavailable += 1;
    report.byCompetition[competition].unavailable += 1;
    cache[candidate.key] = { ...(candidate.existing || {}), teamName: candidate.teamName, fetchedAt: new Date().toISOString(), unavailable: true, source: candidate.existing?.source || "TheSportsDB + ESPN" };
    continue;
  }
  const players = mergePlayers(candidate.existing?.players, profile.players);
  cache[candidate.key] = {
    ...(candidate.existing || {}),
    key: candidate.key,
    teamName: candidate.teamName,
    source: [...new Set([candidate.existing?.source, provider].filter(Boolean))].join(" + "),
    sources: [...new Set([...(candidate.existing?.sources || []), provider])],
    sourceIds: {
      ...(candidate.existing?.sourceIds || {}),
      ...(provider === "TheSportsDB" ? { theSportsDb: profile.providerTeamId } : {}),
      ...(provider === "ESPN" ? { espn: profile.providerTeamId, espnLeagueCode: profile.leagueCode } : {}),
      ...(provider === "Wikipedia" ? { wikipediaTitle: profile.pageTitle } : {}),
    },
    playerCount: players.length,
    players,
    fetchedAt: new Date().toISOString(),
    rosterSourceCheckedAt: Date.now(),
    rosterBackfillVersion: "v5-fill-empty-rosters",
    unavailable: false,
    rosterDataQuality: "identity-and-roster-only",
  };
  report.enriched += 1;
  report.byProvider[provider] += 1;
  report.byCompetition[competition].enriched += 1;
  report.samples.push({ team: candidate.teamName, competition, players: players.length, provider, providerTeam: profile.providerTeamName });
  await new Promise((resolve) => setTimeout(resolve, 250));
}

fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
fs.writeFileSync(CACHE_FILE, `${JSON.stringify({ schemaVersion: "team-squad-cache-v1", generatedAt: report.generatedAt, teams: cache })}\n`);
fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
