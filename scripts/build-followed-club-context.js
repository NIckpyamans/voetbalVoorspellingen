#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { loadLocalEnv, getSql } from "../shared/database.js";

const ROOT = process.cwd();
const SEED_FILE = path.join(ROOT, "docs", "data-context", "followed-clubs.seed.json");
const OUT_FILE = path.join(ROOT, "docs", "data-context", "followed-clubs-context.json");
const SERVER_DATA_FILE = path.join(ROOT, "server_data.json");
const THESPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json/123";

loadLocalEnv(ROOT);

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(fc|cf|sc|afc|club|voetbalclub)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function digest(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 18);
}

function countryMatches(team, country) {
  if (!country) return true;
  const expected = normalizeName(country);
  const actual = normalizeName(team?.strCountry || "");
  if (expected === "england") return ["england", "united kingdom"].includes(actual);
  return actual === expected;
}

function leagueLooksRight(team, country) {
  const league = normalizeName(team?.strLeague || "");
  const expected = normalizeName(country);
  if (!league) return true;
  if (expected === "spain") return /laliga|spanish|segunda/.test(league);
  if (expected === "england") return /premier league|championship|english/.test(league);
  if (expected === "germany") return /bundesliga|german/.test(league);
  if (expected === "france") return /ligue|french/.test(league);
  return true;
}

function pickSportsDbTeam(teams, query, seedClub) {
  if (!teams.length) return null;
  const wanted = [seedClub.name, ...(seedClub.aliases || []), query].map(normalizeName);
  const seedIsWomen = /women|vrouw|femenino|femeni/.test(normalizeName(seedClub.name));
  const candidates = teams
    .map((team) => ({
      team,
      score:
        (wanted.includes(normalizeName(team?.strTeam)) ? 100 : 0) +
        (countryMatches(team, seedClub.country) ? 40 : -80) +
        (leagueLooksRight(team, seedClub.country) ? 20 : -40) +
        (String(team?.strSport || "").toLowerCase() === "soccer" ? 10 : 0) +
        (!seedIsWomen && /women|ladies|femenino|femeni/.test(normalizeName(`${team?.strTeam || ""} ${team?.strLeague || ""}`)) ? -160 : 0) +
        (/(\bb\b|u21|u19|reserves)/.test(normalizeName(`${team?.strTeam || ""} ${team?.strLeague || ""}`)) ? -80 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.score > 0 ? candidates[0].team : null;
}

async function fetchSportsDbTeam(seedClub) {
  const queries = [seedClub.name, ...(seedClub.aliases || [])];
  const attempts = [];
  for (const query of queries) {
    const url = `${THESPORTSDB_BASE}/searchteams.php?t=${encodeURIComponent(query)}`;
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) {
        attempts.push({ ok: false, status: response.status, url, query });
        continue;
      }
      const json = await response.json();
      const teams = Array.isArray(json?.teams) ? json.teams : [];
      const team = pickSportsDbTeam(teams, query, seedClub);
      attempts.push({ ok: Boolean(team), url, query, teams: teams.length });
      if (team) return { ok: true, url, query, attempts, team };
    } catch (error) {
      attempts.push({ ok: false, query, url, error: error.message });
    }
  }
  return { ok: false, url: attempts.at(-1)?.url || null, attempts };
}

function localClubStats(seedClub, store) {
  const names = [seedClub.name, ...(seedClub.aliases || [])].map(normalizeName);
  const matches = [];
  for (const [dateKey, dayMatches] of Object.entries(store?.matches || {})) {
    for (const match of dayMatches || []) {
      const home = normalizeName(match.homeTeamName);
      const away = normalizeName(match.awayTeamName);
      const isHome = names.includes(home);
      const isAway = names.includes(away);
      if (!isHome && !isAway) continue;
      const scoreMatch = String(match.score || "").match(/(\d+)\s*-\s*(\d+)/);
      const homeGoals = scoreMatch ? Number(scoreMatch[1]) : null;
      const awayGoals = scoreMatch ? Number(scoreMatch[2]) : null;
      let result = null;
      if (Number.isFinite(homeGoals) && Number.isFinite(awayGoals)) {
        const goalsFor = isHome ? homeGoals : awayGoals;
        const goalsAgainst = isHome ? awayGoals : homeGoals;
        result = goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
      }
      matches.push({
        date: dateKey,
        matchId: match.id,
        league: match.league,
        opponent: isHome ? match.awayTeamName : match.homeTeamName,
        venue: isHome ? "home" : "away",
        status: match.status,
        score: match.score || null,
        result,
        predictionId: match.predictionId || null,
        dataSource: match.dataSource || null,
      });
    }
  }

  const finished = matches.filter((match) => match.result);
  const wins = finished.filter((match) => match.result === "W").length;
  const draws = finished.filter((match) => match.result === "D").length;
  const losses = finished.filter((match) => match.result === "L").length;
  return {
    matches: matches.length,
    finished: finished.length,
    wins,
    draws,
    losses,
    winRate: finished.length ? Number((wins / finished.length).toFixed(3)) : null,
    recent: matches
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 12),
  };
}

async function writeSourceRecords(clubs) {
  const sql = getSql();
  if (!sql) return { skipped: true, reason: "database_url_missing" };
  let written = 0;
  for (const club of clubs) {
    if (!club.external?.theSportsDb?.team) continue;
    const payload = club.external.theSportsDb.team;
    await sql.query(
      `
        insert into source_records (
          source_record_id, provider, source_url, entity_type, entity_key,
          fetched_at, content_hash, trust_score, payload
        )
        values ($1, 'TheSportsDB Free', $2, 'club', $3, $4, $5, 0.74, $6::jsonb)
        on conflict (source_record_id) do update set
          fetched_at = excluded.fetched_at,
          content_hash = excluded.content_hash,
          payload = excluded.payload
      `,
      [
        `src_tsdb_club_${digest(club.name)}`,
        club.external.theSportsDb.url,
        club.name,
        club.external.theSportsDb.fetchedAt,
        digest(JSON.stringify(payload)),
        JSON.stringify(payload),
      ]
    );
    written += 1;
  }
  return { skipped: false, written };
}

const seed = readJsonSafe(SEED_FILE, { clubs: [] });
const store = readJsonSafe(SERVER_DATA_FILE, {});
const clubs = [];

for (const club of seed.clubs || []) {
  const external = await fetchSportsDbTeam(club);
  clubs.push({
    ...club,
    local: localClubStats(club, store),
    external: {
      theSportsDb: {
        fetchedAt: new Date().toISOString(),
        ok: external.ok,
        url: external.url,
        query: external.query || null,
        attempts: external.attempts || [],
        error: external.error || null,
        status: external.status || null,
        team: external.team
          ? {
              idTeam: external.team.idTeam || null,
              strTeam: external.team.strTeam || null,
              strLeague: external.team.strLeague || null,
              strStadium: external.team.strStadium || null,
              strStadiumLocation: external.team.strStadiumLocation || null,
              intStadiumCapacity: external.team.intStadiumCapacity || null,
              intFormedYear: external.team.intFormedYear || null,
              strCountry: external.team.strCountry || null,
              strDescriptionEN: external.team.strDescriptionEN || null,
              strBadge: external.team.strBadge || null,
              strWebsite: external.team.strWebsite || null,
            }
          : null,
      },
    },
  });
}

const sourceRecordSync = await writeSourceRecords(clubs);
const output = {
  version: "2026-06-05",
  generatedAt: new Date().toISOString(),
  purpose: "Analysis-ready followed club context for Data Analytics and prediction feature governance.",
  freeSourcesUsed: ["TheSportsDB Free API", "local server_data.json", "Neon source_records"],
  sourceRecordSync,
  clubs,
};

fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  generatedAt: output.generatedAt,
  clubs: clubs.length,
  enriched: clubs.filter((club) => club.external?.theSportsDb?.ok).length,
  sourceRecordSync,
}, null, 2));
