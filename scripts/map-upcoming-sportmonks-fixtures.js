#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadLocalEnv } from "../shared/database.js";
import { getSportmonksApiKey } from "./provider-env.js";
import { findSportmonksFixture } from "./sportmonks-fixture-resolver.js";

const ROOT = process.cwd();
const DAYS_AHEAD = Math.max(1, Number(process.env.SPORTMONKS_MAPPING_DAYS_AHEAD || 8));
const LIMIT = Math.max(1, Number(process.env.SPORTMONKS_MAPPING_LIMIT || 80));
const CACHE_PATH = path.join(ROOT, "data", "sportmonks-fixture-cache.json");
const REPORT_PATH = path.join(ROOT, "monitor", "sportmonks-fixture-mapping.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function matchId(match) {
  return String(match?.id || match?.sofaId || "");
}

function upcomingMatches() {
  const rows = [];
  const now = Date.now();
  for (let offset = 0; offset <= DAYS_AHEAD; offset += 1) {
    const date = new Date(now + offset * 86400000).toISOString().slice(0, 10);
    const payload = readJson(path.join(ROOT, "data", "days", `${date}.json`), {});
    for (const match of Array.isArray(payload?.matches) ? payload.matches : []) {
      const kickoff = Date.parse(match?.kickoff || "");
      if (!matchId(match) || !Number.isFinite(kickoff) || kickoff <= now || !match?.homeTeamName || !match?.awayTeamName) continue;
      rows.push({
        matchId: matchId(match),
        canonicalFixtureId: matchId(match),
        kickoff: new Date(kickoff).toISOString(),
        league: match.league || "Onbekende competitie",
        homeTeam: match.homeTeamName,
        awayTeam: match.awayTeamName,
      });
    }
  }
  return rows.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)).slice(0, LIMIT);
}

function competitionReport(rows) {
  const byCompetition = {};
  for (const row of rows) {
    const key = row.league || "Onbekende competitie";
    const aggregate = byCompetition[key] ||= { fixtures: 0, mapped: 0, oddsAdvertised: 0, missing: 0, providerLeagueIds: [], providerSeasonIds: [] };
    aggregate.fixtures += 1;
    if (row.status === "matched") aggregate.mapped += 1;
    else aggregate.missing += 1;
    if (row.hasOdds) aggregate.oddsAdvertised += 1;
    if (row.sportmonksLeagueId && !aggregate.providerLeagueIds.includes(row.sportmonksLeagueId)) aggregate.providerLeagueIds.push(row.sportmonksLeagueId);
    if (row.sportmonksSeasonId && !aggregate.providerSeasonIds.includes(row.sportmonksSeasonId)) aggregate.providerSeasonIds.push(row.sportmonksSeasonId);
  }
  for (const value of Object.values(byCompetition)) {
    value.mappingCoverage = value.fixtures ? Number((value.mapped / value.fixtures).toFixed(3)) : 0;
    value.oddsDiscoveryCoverage = value.fixtures ? Number((value.oddsAdvertised / value.fixtures).toFixed(3)) : 0;
  }
  return byCompetition;
}

async function main() {
  loadLocalEnv(ROOT);
  if (!getSportmonksApiKey()) {
    throw new Error("Sportmonks API key ontbreekt. Configureer SPORTMONKS_API_KEY of MYSPORTS_API_KEY voordat fixturemapping wordt uitgevoerd.");
  }
  const previous = readJson(CACHE_PATH, { matches: {} });
  const rows = upcomingMatches();
  const cache = { schemaVersion: 1, generatedAt: new Date().toISOString(), matches: { ...(previous.matches || {}) } };
  const reportRows = [];
  for (const match of rows) {
    const resolved = await findSportmonksFixture(match, { useCache: false }).catch((error) => ({ status: "resolver_error", error: error?.message || String(error) }));
    const entry = {
      ...match,
      status: resolved?.fixtureId ? "matched" : resolved?.status || "not_found",
      fixtureId: resolved?.fixtureId || null,
      confidence: resolved?.confidence || 0,
      homeName: resolved?.homeName || null,
      awayName: resolved?.awayName || null,
      startingAt: resolved?.startingAt || null,
      hasOdds: Boolean(resolved?.hasOdds),
      sportmonksLeagueId: resolved?.sportmonksLeagueId || null,
      sportmonksLeagueName: resolved?.sportmonksLeagueName || null,
      sportmonksSeasonId: resolved?.sportmonksSeasonId || null,
      sportmonksSeasonName: resolved?.sportmonksSeasonName || null,
      sourceUrl: resolved?.sourceUrl || null,
      mappedAt: new Date().toISOString(),
    };
    // A transient provider failure must never replace a previously verified mapping.
    if (entry.status === "provider_error" && previous.matches?.[match.matchId]?.fixtureId) {
      cache.matches[match.matchId] = { ...previous.matches[match.matchId], lastAttemptAt: entry.mappedAt, lastAttemptStatus: entry.status };
    } else {
      cache.matches[match.matchId] = entry;
    }
    reportRows.push(entry);
  }
  const report = {
    generatedAt: cache.generatedAt,
    daysAhead: DAYS_AHEAD,
    checked: reportRows.length,
    mapped: reportRows.filter((row) => row.status === "matched").length,
    oddsAdvertised: reportRows.filter((row) => row.hasOdds).length,
    missing: reportRows.filter((row) => row.status !== "matched").length,
    providerErrors: reportRows.filter((row) => row.status === "provider_error" || row.status === "resolver_error").length,
    competitions: competitionReport(reportRows),
    matches: reportRows,
    nextAction: "Gebruik alleen voor aantoonbaar ontbrekende odds per competitie een tweede provider.",
  };
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
