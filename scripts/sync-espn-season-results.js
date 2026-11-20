#!/usr/bin/env node

// ESPN levert per team een volledig seizoensschema met uitslagen, zonder key en
// zonder quota. Voor competities waar de andere H2H-bronnen niets opleveren
// (Eerste Divisie: geen football-data.co.uk, goal-api dicht, api-football zonder
// team-ids) is dat de enige bron die de historie van vóór het lokale dagvenster
// kan vullen. Deze stap bewaart die uitslagen als lokale H2H-historie, zodat
// readLocalH2HProfile ze zonder netwerk kan gebruiken.

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "data", "h2h", "espn-season-results.json");
const CONFIG = path.join(ROOT, "config", "friendly-team-sources.json");
const SEASONS_BACK = Math.max(1, Math.min(8, Number(process.env.ESPN_H2H_SEASONS_BACK || 4)));
const LEAGUES = String(process.env.ESPN_SYNC_LEAGUES || "ned.2")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const MAX_REQUESTS = Math.max(1, Number(process.env.ESPN_SYNC_MAX_REQUESTS || 400));
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.ESPN_SYNC_REQUEST_DELAY_MS || 120));

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numericScore(value) {
  const candidate = Number(value?.value ?? value?.displayValue ?? value);
  return Number.isFinite(candidate) ? candidate : null;
}

function isCompleted(status) {
  return Boolean(
    status?.completed === true ||
      /final|full[_ -]?time|completed/i.test(String(status?.type?.name || status?.type?.description || status?.name || ""))
  );
}

// Eén ESPN-event wordt pas bruikbaar als beide teams, beide scores en de datum
// bekend zijn; een halve wedstrijd in de cache zou H2H-balansen vervuilen.
export function normalizeEspnSeasonEvent(event) {
  const competition = event?.competitions?.[0] || {};
  const home = (competition.competitors || []).find((row) => row?.homeAway === "home");
  const away = (competition.competitors || []).find((row) => row?.homeAway === "away");
  const dateValue = competition.date || event?.date || "";
  const dateMs = Date.parse(dateValue);
  if (!home?.team?.id || !away?.team?.id || !Number.isFinite(dateMs)) return null;
  const homeScore = numericScore(home.score);
  const awayScore = numericScore(away.score);
  if (homeScore == null || awayScore == null) return null;
  if (!isCompleted(competition.status || event?.status)) return null;
  return {
    eventId: String(event?.id || competition?.id || "") || null,
    date: new Date(dateMs).toISOString().slice(0, 10),
    homeTeamId: String(home.team.id),
    awayTeamId: String(away.team.id),
    homeTeamName: String(home.team.displayName || home.team.name || "").trim() || null,
    awayTeamName: String(away.team.displayName || away.team.name || "").trim() || null,
    homeScore,
    awayScore,
    // summarizeH2HResults filtert op een score-string; zonder dit veld valt een
    // geldige uitslag alsnog uit het H2H-profiel.
    score: `${homeScore}-${awayScore}`,
    dataSource: "espn-season-results",
  };
}

function teamsByLeague(config, leagueCodes) {
  const wanted = new Set(leagueCodes);
  const grouped = new Map();
  for (const team of config?.teams || []) {
    if (team?.active === false) continue;
    const leagueCode = String(team?.espnLeagueCode || "").trim();
    const teamId = String(team?.espnTeamId || "").trim();
    if (!leagueCode || !teamId || !wanted.has(leagueCode)) continue;
    if (!grouped.has(leagueCode)) grouped.set(leagueCode, new Map());
    grouped.get(leagueCode).set(teamId, {
      name: String(team?.name || teamId),
      league: String(team?.league || "").trim() || null,
    });
  }
  return grouped;
}

async function fetchTeamSeason({ leagueCode, teamId, season, fetchImpl, requestState }) {
  if (requestState.requests >= MAX_REQUESTS) {
    requestState.skipped += 1;
    return { status: "budget_exhausted", events: [] };
  }
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(leagueCode)}/teams/${encodeURIComponent(teamId)}/schedule?season=${season}`;
  requestState.requests += 1;
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      requestState.failures.push({ leagueCode, teamId, season, status: `http_${response.status}` });
      return { status: `http_${response.status}`, events: [] };
    }
    const payload = await response.json();
    return { status: "ok", events: Array.isArray(payload?.events) ? payload.events : [] };
  } catch (error) {
    const status = error?.name || error?.message || "request_failed";
    requestState.failures.push({ leagueCode, teamId, season, status });
    return { status, events: [] };
  } finally {
    if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
  }
}

export async function syncEspnSeasonResults({
  config,
  leagueCodes = LEAGUES,
  seasonsBack = SEASONS_BACK,
  fetchImpl = globalThis.fetch,
  season = new Date().getUTCFullYear(),
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is niet beschikbaar");
  const grouped = teamsByLeague(config, leagueCodes);
  const requestState = { requests: 0, skipped: 0, failures: [] };
  const leagues = {};
  for (const [leagueCode, teams] of grouped.entries()) {
    const unique = new Map();
    const leagueLabel = [...teams.values()].find((team) => team?.league)?.league || null;
    for (const teamId of teams.keys()) {
      for (let year = season; year > season - seasonsBack; year -= 1) {
        const response = await fetchTeamSeason({ leagueCode, teamId, season: year, fetchImpl, requestState });
        for (const event of response.events) {
          const normalized = normalizeEspnSeasonEvent(event);
          if (!normalized) continue;
          // Hetzelfde duel komt uit het schema van beide teams terug.
          unique.set(normalized.eventId || `${normalized.date}|${normalized.homeTeamId}|${normalized.awayTeamId}`, normalized);
        }
      }
    }
    leagues[leagueCode] = {
      label: leagueLabel,
      teams: teams.size,
      results: [...unique.values()].sort((left, right) => left.date.localeCompare(right.date)),
    };
  }
  return {
    schemaVersion: "espn-season-results-v1",
    generatedAt: new Date().toISOString(),
    seasonsBack,
    leagues,
    requestState: {
      requests: requestState.requests,
      skippedByBudget: requestState.skipped,
      failures: requestState.failures.slice(0, 25),
    },
  };
}

async function main() {
  const config = readJson(CONFIG, null);
  if (!config) throw new Error(`kon ${CONFIG} niet lezen`);
  const payload = await syncEspnSeasonResults({ config });
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  const summary = Object.fromEntries(
    Object.entries(payload.leagues).map(([code, league]) => [code, league.results.length])
  );
  console.log(
    `[espn-season-results] ${payload.requestState.requests} requests, ` +
      `${payload.requestState.skippedByBudget} overgeslagen, ` +
      `${payload.requestState.failures.length} fouten, uitslagen per competitie: ${JSON.stringify(summary)}`
  );
  if (!Object.values(summary).some((count) => count > 0)) {
    console.error("[espn-season-results] geen enkele uitslag opgehaald; cache is leeg gebleven");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
