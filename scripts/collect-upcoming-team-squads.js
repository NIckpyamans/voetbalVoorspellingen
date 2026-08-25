#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fetchEspnSquad } from "./providers/espn-squad-provider.js";
import { fetchWikipediaSquad } from "./providers/wikipedia-squad-provider.js";
import { fetchTransfermarktDatasetSquad } from "./providers/transfermarkt-squad-provider.js";
import { fetchFotMobSquad } from "./providers/fotmob-squad-provider.js";

const ROOT = process.cwd();
const DAYS_AHEAD = Math.max(1, Number(process.env.SQUAD_ENRICHMENT_DAYS_AHEAD || 8));
const MAX_TEAMS = Math.max(1, Number(process.env.SQUAD_ENRICHMENT_MAX_TEAMS || 6));
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.SQUAD_ENRICHMENT_REQUEST_TIMEOUT_MS || 6000));
const REFRESH_TTL_MS = Math.max(60 * 60 * 1000, Number(process.env.SQUAD_ENRICHMENT_REFRESH_TTL_MS || 48 * 60 * 60 * 1000));
const PARTIAL_REFRESH_TTL_MS = Math.max(60 * 60 * 1000, Number(process.env.SQUAD_ENRICHMENT_PARTIAL_REFRESH_TTL_MS || 6 * 60 * 60 * 1000));
const UNAVAILABLE_TTL_MS = 6 * 60 * 60 * 1000;
const TARGET_SQUAD_PLAYERS = Math.max(11, Number(process.env.SQUAD_ENRICHMENT_TARGET_PLAYERS || 18));
const FORCE_UNAVAILABLE = String(process.env.SQUAD_ENRICHMENT_FORCE_UNAVAILABLE || "false").toLowerCase() === "true";
const FORCE_REFRESH = String(process.env.SQUAD_ENRICHMENT_FORCE_REFRESH || "false").toLowerCase() === "true";
const TEAM_FILTER = new Set(String(process.env.SQUAD_ENRICHMENT_TEAM_FILTER || "").split(",").map(normalize).filter(Boolean));
const CACHE_FILE = path.join(ROOT, "data", "team-squad-cache.json");
const TEAMS_FILE = path.join(ROOT, "data", "teams.json");
const COMPETITION_CATALOG_FILE = path.join(ROOT, "config", "competition-catalog.json");
const REPORT_FILE = path.join(ROOT, "monitor", "upcoming-team-squad-enrichment.json");
const ESPN_TEAMS_FILE = path.join(ROOT, "config", "friendly-team-sources.json");
const SPORTS_DB_BASE = "https://www.thesportsdb.com/api/v1/json/123";

class ProviderRateLimitError extends Error {
  constructor(retryAfterSeconds = 0, provider = "squad provider") {
    super(`${provider} rate limit reached`);
    this.code = "provider_rate_limited";
    this.retryAfterSeconds = retryAfterSeconds;
    this.provider = provider;
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

function normalizePlayerPosition(value) {
  const position = String(value || "").trim();
  if (position === "0") return "Goalkeeper";
  if (position === "1") return "Defender";
  if (position === "2") return "Midfielder";
  if (position === "3") return "Forward";
  return position;
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
    if (/coach|manager|trainer|staff/i.test(String(player?.position || ""))) continue;
    const key = normalize(name);
    const current = byName.get(key) || {};
    byName.set(key, {
      ...current,
      ...player,
      name,
      position: normalizePlayerPosition(player.position) || normalizePlayerPosition(current.position) || "",
      nationality: player.nationality || current.nationality || "",
      status: player.status || current.status || "beschikbaar",
      availability: player.availability || current.availability || "beschikbaar",
      rating: Number(player.rating || 0) || Number(current.rating || 0) || null,
      marketValueEur: Number(player.marketValueEur || 0) || Number(current.marketValueEur || 0) || null,
      lastStartedAt: player.lastStartedAt || current.lastStartedAt || null,
      lastMatchId: player.lastMatchId || current.lastMatchId || null,
      sources: [...new Set([...(current.sources || []), ...(player.sources || []), player.source].filter(Boolean))],
    });
  }
  return [...byName.values()].sort((left, right) => String(left.position).localeCompare(String(right.position)) || left.name.localeCompare(right.name)).slice(0, 60);
}

async function fetchJson(url, { ignoreRateLimit = false } = {}) {
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
      if (ignoreRateLimit) return null;
      throw new ProviderRateLimitError(Number(response.headers.get("retry-after") || 0), new URL(url).hostname);
    }
    return response.ok ? await response.json() : null;
  } catch (error) {
    if (error?.code === "provider_rate_limited") throw error;
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

let publicRateLimitWaited = false;
async function fetchPublicJson(url) {
  try {
    return await fetchJson(url);
  } catch (error) {
    if (error?.code !== "provider_rate_limited") throw error;
    if (publicRateLimitWaited) return null;
    publicRateLimitWaited = true;
    const waitSeconds = Math.max(1, Math.min(45, Number(error.retryAfterSeconds || 5)));
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    return fetchJson(url, { ignoreRateLimit: true });
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
const competitionCatalog = readJson(COMPETITION_CATALOG_FILE, { competitions: [] });
const candidates = new Map();

// Keep every active competition's roster current, including clubs that do not
// happen to play inside the short upcoming-fixture window.
for (const competition of competitionCatalog?.competitions || []) {
  for (const name of competition?.teams || []) {
    if (!name) continue;
    const key = teamKey(name);
    const item = candidates.get(key) || { key, teamName: String(name), leagues: new Set(), providerTeamIds: new Set() };
    if (competition?.league) item.leagues.add(String(competition.league));
    candidates.set(key, item);
  }
}
for (let offset = 0; offset <= DAYS_AHEAD; offset += 1) {
  const date = addDays(todayKey(), offset);
  const day = readJson(path.join(ROOT, "data", "days", `${date}.json`), null);
  for (const match of day?.matches || []) {
    for (const [name, providerId] of [[match?.homeTeamName, match?.homeTeamId], [match?.awayTeamName, match?.awayTeamId]]) {
      if (!name) continue;
      const key = teamKey(name);
      const item = candidates.get(key) || { key, teamName: String(name), leagues: new Set(), providerTeamIds: new Set() };
      if (match?.league) item.leagues.add(String(match.league));
      if (providerId) item.providerTeamIds.add(String(providerId));
      candidates.set(key, item);
    }
  }
}

const recentLineups = new Map();
for (let offset = -1; offset >= -30; offset -= 1) {
  const date = addDays(todayKey(), offset);
  const day = readJson(path.join(ROOT, "data", "days", `${date}.json`), null);
  for (const match of day?.matches || []) {
    const lineup = match?.lineupSummary;
    if (!lineup?.confirmed) continue;
    for (const [teamName, side] of [[match?.homeTeamName, lineup.home], [match?.awayTeamName, lineup.away]]) {
      const key = teamKey(teamName);
      if (!teamName || recentLineups.has(key) || !Array.isArray(side?.players) || side.players.length < 10) continue;
      recentLineups.set(key, {
        matchId: match.id,
        playedAt: match.kickoff || `${date}T12:00:00Z`,
        players: side.players.map((player) => ({
          ...player,
          id: player.id ? `lineup:${player.id}` : "",
          source: "Laatste bevestigde opstelling",
          sources: ["Laatste bevestigde opstelling", player.source].filter(Boolean),
          lastStartedAt: match.kickoff || `${date}T12:00:00Z`,
          lastMatchId: match.id,
          availability: "laatste wedstrijd gestart",
          status: "laatste wedstrijd gestart",
        })),
      });
    }
  }
}

const now = Date.now();
const report = { generatedAt: new Date().toISOString(), daysAhead: DAYS_AHEAD, targetPlayersPerTeam: TARGET_SQUAD_PLAYERS, candidates: candidates.size, checked: 0, enriched: 0, unavailable: 0, skippedFresh: 0, pendingBeforeBatch: 0, pendingAfterBatch: 0, rateLimited: false, retryAfterSeconds: 0, byProvider: { FotMob: 0, "Laatste bevestigde opstelling": 0, "Transfermarkt Datasets": 0, TheSportsDB: 0, ESPN: 0, Wikipedia: 0 }, byCompetition: {}, samples: [] };
const pendingCandidates = [...candidates.values()]
  .filter((candidate) => !TEAM_FILTER.size || TEAM_FILTER.has(normalize(candidate.teamName)))
  .map((candidate) => {
    const existing = cache[candidate.key] || exportedTeams[candidate.key] || null;
    return { ...candidate, existing, playerCount: Number(existing?.playerCount || existing?.players?.length || 0) };
  })
  .filter((candidate) => {
    if (FORCE_REFRESH) return true;
    if (FORCE_UNAVAILABLE && candidate.existing?.unavailable) return true;
    const age = now - Date.parse(candidate.existing?.fetchedAt || candidate.existing?.checkedAt || 0);
    const ttl = candidate.existing?.unavailable
      ? UNAVAILABLE_TTL_MS
      : candidate.playerCount >= TARGET_SQUAD_PLAYERS ? REFRESH_TTL_MS : PARTIAL_REFRESH_TTL_MS;
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
  });
const pending = pendingCandidates.slice(0, MAX_TEAMS);
report.pendingBeforeBatch = pendingCandidates.length;
report.pendingAfterBatch = Math.max(0, pendingCandidates.length - pending.length);

for (const candidate of pending) {
  report.checked += 1;
  let sportsDbProfile = null;
  let espnProfile = null;
  let wikipediaProfile = null;
  let fotmobProfile = null;
  const providerProfiles = [];
  fotmobProfile = await fetchFotMobSquad({
    teamName: candidate.teamName,
    teamIds: candidate.providerTeamIds || [],
    fetchJson: (url) => fetchJson(url, { ignoreRateLimit: true }),
  });
  if (fotmobProfile) providerProfiles.push({ provider: "FotMob", profile: fotmobProfile });
  const transfermarktProfile = fetchTransfermarktDatasetSquad({ teamName: candidate.teamName, root: ROOT });
  if (transfermarktProfile) providerProfiles.push({ provider: "Transfermarkt Datasets", profile: transfermarktProfile });
  if (mergePlayers([], providerProfiles.flatMap((item) => item.profile.players)).length < TARGET_SQUAD_PLAYERS) {
    espnProfile = await fetchEspnSquad({
      teamName: candidate.teamName,
      leagues: [...candidate.leagues],
      knownTeams: knownEspnTeams,
      fetchJson: (url) => fetchJson(url, { ignoreRateLimit: true }),
    });
    if (espnProfile) providerProfiles.push({ provider: "ESPN", profile: espnProfile });
  }
  if (!providerProfiles.length && !report.rateLimited) {
    try {
      sportsDbProfile = await fetchSportsDbSquad(candidate.teamName);
      if (sportsDbProfile) providerProfiles.push({ provider: "TheSportsDB", profile: sportsDbProfile });
    } catch (error) {
      if (error?.code === "provider_rate_limited") {
        report.rateLimited = true;
        report.retryAfterSeconds = Number(error.retryAfterSeconds || 0);
      } else {
        throw error;
      }
    }
  }
  if (mergePlayers([], providerProfiles.flatMap((item) => item.profile.players)).length < TARGET_SQUAD_PLAYERS) {
    wikipediaProfile = await fetchWikipediaSquad({ teamName: candidate.teamName, fetchJson: fetchPublicJson });
    if (wikipediaProfile) providerProfiles.push({ provider: "Wikipedia", profile: wikipediaProfile });
  }
  const recentLineup = recentLineups.get(candidate.key) || null;
  const preferredProfile = providerProfiles.find((item) => mergePlayers([], item.profile.players).length >= TARGET_SQUAD_PLAYERS) || null;
  const basePlayers = preferredProfile
    ? mergePlayers([], preferredProfile.profile.players)
    : mergePlayers([], providerProfiles.flatMap((item) => item.profile.players));
  const playersWithRecentXi = mergePlayers(basePlayers, recentLineup?.players || []);
  const providers = [...new Set([
    ...(preferredProfile ? [preferredProfile.provider] : providerProfiles.map((item) => item.provider)),
    ...(recentLineup ? ["Laatste bevestigde opstelling"] : []),
  ])];
  const profile = playersWithRecentXi.length
    ? {
        providerTeamName: preferredProfile?.profile?.providerTeamName || providerProfiles.find((item) => item.profile?.providerTeamName)?.profile.providerTeamName || candidate.teamName,
        players: playersWithRecentXi,
      }
    : null;
  const competition = [...candidate.leagues][0] || "onbekend";
  report.byCompetition[competition] = report.byCompetition[competition] || { checked: 0, enriched: 0, unavailable: 0 };
  report.byCompetition[competition].checked += 1;
  if (!profile) {
    report.unavailable += 1;
    report.byCompetition[competition].unavailable += 1;
    cache[candidate.key] = { ...(candidate.existing || {}), teamName: candidate.teamName, fetchedAt: new Date().toISOString(), unavailable: true, source: candidate.existing?.source || "TheSportsDB + ESPN" };
    continue;
  }
  // Een succesvolle providercontrole is een actuele momentopname. Oude spelers
  // worden bewust niet opnieuw samengevoegd, anders blijven transfers eeuwig staan.
  const players = mergePlayers([], profile.players);
  cache[candidate.key] = {
    ...(candidate.existing || {}),
    key: candidate.key,
    teamName: candidate.teamName,
    source: providers.join(" + "),
    sources: providers,
    sourceIds: {
      ...(candidate.existing?.sourceIds || {}),
      ...(sportsDbProfile ? { theSportsDb: sportsDbProfile.providerTeamId } : {}),
      ...(espnProfile ? { espn: espnProfile.providerTeamId, espnLeagueCode: espnProfile.leagueCode } : {}),
      ...(fotmobProfile ? { fotmob: fotmobProfile.providerTeamId } : {}),
      ...(wikipediaProfile ? { wikipediaTitle: wikipediaProfile.pageTitle } : {}),
      ...(transfermarktProfile ? { transfermarkt: transfermarktProfile.providerTeamId } : {}),
    },
    playerCount: players.length,
    players,
    fetchedAt: new Date().toISOString(),
    rosterSourceCheckedAt: Date.now(),
    rosterBackfillVersion: "v6-current-snapshot-last-xi",
    unavailable: false,
    rosterDataQuality: "identity-and-roster-only",
    snapshotMode: "replace-current-roster",
    lastConfirmedLineupAt: recentLineup?.playedAt || null,
    lastConfirmedLineupMatchId: recentLineup?.matchId || null,
  };
  report.enriched += 1;
  for (const provider of providers) report.byProvider[provider] += 1;
  report.byCompetition[competition].enriched += 1;
  report.samples.push({ team: candidate.teamName, competition, players: players.length, provider: providers.join(" + "), providerTeam: profile.providerTeamName });
  await new Promise((resolve) => setTimeout(resolve, 250));
}

fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
fs.writeFileSync(CACHE_FILE, `${JSON.stringify({ schemaVersion: "team-squad-cache-v1", generatedAt: report.generatedAt, teams: cache })}\n`);
fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
