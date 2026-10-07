#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getApiFootballKey } from "./provider-env.js";
import { probeApiFootballH2HPairs } from "./providers/api-football-h2h-probe.js";
import { getKnownProviderIds } from "./worker/team-identity.js";
import { loadLocalEnv } from "../shared/database.js";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "monitor", "api-football-h2h-probe.json");
const SUPPORTED_LEAGUES = new Set([
  "Netherlands - Eredivisie", "Netherlands - Eerste Divisie",
  "Germany - Bundesliga", "Germany - 2. Bundesliga",
  "England - Premier League", "England - Championship",
  "France - Ligue 1", "France - Ligue 2",
]);

export function collectApiFootballH2HProbePairs(root, { daysAhead = 21, maxPairs = 3, now = Date.now(), getProviderIds = getKnownProviderIds, fsImpl = fs } = {}) {
  const safePairLimit = Math.min(5, Math.max(1, Math.floor(Number(maxPairs) || 3)));
  const deadline = now + Math.max(1, Number(daysAhead) || 21) * 86400000;
  const byLeague = new Map();
  const daysDir = path.join(root, "data", "days");
  for (const filename of fsImpl.existsSync(daysDir) ? fsImpl.readdirSync(daysDir).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort() : []) {
    let payload;
    try { payload = JSON.parse(fsImpl.readFileSync(path.join(daysDir, filename), "utf8")); } catch { continue; }
    for (const match of Array.isArray(payload?.matches) ? payload.matches : []) {
      const league = String(match?.league || "");
      const kickoff = Date.parse(match?.kickoff || "");
      if (!SUPPORTED_LEAGUES.has(league) || !Number.isFinite(kickoff) || kickoff <= now || kickoff > deadline) continue;
      if (!match?.homeTeamName || !match?.awayTeamName || Number(match?.h2h?.played || match?.h2h?.results?.length || 0) > 0) continue;
      const homeIds = getProviderIds(match.homeTeamName, { root });
      const awayIds = getProviderIds(match.awayTeamName, { root });
      const rows = byLeague.get(league) || [];
      rows.push({
        matchId: String(match.id || `${filename}:${match.homeTeamName}:${match.awayTeamName}`),
        date: filename.slice(0, 10),
        kickoff: match.kickoff,
        league,
        homeTeam: match.homeTeamName,
        awayTeam: match.awayTeamName,
        homeTeamId: homeIds.apiFootball || null,
        awayTeamId: awayIds.apiFootball || null,
      });
      byLeague.set(league, rows);
    }
  }
  for (const rows of byLeague.values()) rows.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  const selected = [];
  while (selected.length < safePairLimit) {
    let added = false;
    for (const rows of byLeague.values()) {
      const next = rows.shift();
      if (!next) continue;
      selected.push(next);
      added = true;
      if (selected.length >= safePairLimit) break;
    }
    if (!added) break;
  }
  return selected;
}

function summarize(results) {
  return results.reduce((acc, row) => {
    const key = row.status === "history_found" ? "historyFound"
      : row.status === "no_history_returned" ? "noHistoryReturned"
        : row.status.includes("mapping_missing") ? "mappingMissing"
          : row.status.startsWith("http_") || row.status.startsWith("provider_http_") || row.status === "provider_quota_exhausted" ? "providerErrors" : "notCompleted";
    acc[key] += 1;
    return acc;
  }, { historyFound: 0, noHistoryReturned: 0, mappingMissing: 0, providerErrors: 0, notCompleted: 0 });
}

async function main() {
  loadLocalEnv(ROOT);
  const apiKey = getApiFootballKey();
  const pairsLimit = Math.min(5, Math.max(1, Number(process.env.API_FOOTBALL_H2H_PROBE_PAIRS || 3)));
  const requestLimit = Math.min(15, pairsLimit * 3);
  const pairs = collectApiFootballH2HProbePairs(ROOT, { maxPairs: pairsLimit });
  if (!apiKey) {
    const report = {
      schemaVersion: "api-football-h2h-probe-v1",
      generatedAt: new Date().toISOString(),
      mode: "read-only",
      persistence: "none (no Neon, R2, static day-file, or provider writes)",
      requestBudget: { maxPairs: pairsLimit, maxRequests: requestLimit, requestsUsed: 0 },
      candidateCount: pairs.length,
      summary: { historyFound: 0, noHistoryReturned: 0, mappingMissing: 0, providerErrors: 0, notCompleted: pairs.length },
      mappingSuggestions: [],
      results: [],
      recommendation: "Configure API_KEY_API_FOOTBALL in GitHub Actions to run the read-only provider probe.",
    };
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }
  const result = await probeApiFootballH2HPairs(pairs, {
    apiKey,
    baseUrl: process.env.API_FOOTBALL_BASE_URL,
    maxPairs: pairsLimit,
    maxRequests: requestLimit,
  });
  const report = {
    schemaVersion: "api-football-h2h-probe-v1",
    generatedAt: new Date().toISOString(),
    mode: "read-only",
    persistence: "none (no Neon, R2, static day-file, or provider writes)",
    requestBudget: { maxPairs: pairsLimit, maxRequests: requestLimit, requestsUsed: result.requests },
    candidateCount: pairs.length,
    quotaSamples: result.quotaSamples,
    summary: summarize(result.results),
    mappingSuggestions: result.mappingSuggestions,
    mappingFailures: result.mappingFailures,
    results: result.results,
    recommendation: result.results.some((row) => row.status === "history_found")
      ? "API-Football H2H returns eligible history; add verified team IDs to the provider map and enable a small capped backfill."
      : result.results.some((row) => row.status.includes("mapping_missing"))
        ? "Team search did not resolve one or more exact teams; curate aliases/IDs before enabling broad H2H enrichment."
        : "Review provider responses and source coverage; a successful empty H2H response is not evidence that other local datasets lack history.",
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const report = {
      schemaVersion: "api-football-h2h-probe-v1",
      generatedAt: new Date().toISOString(),
      mode: "read-only",
      persistence: "none (no Neon, R2, static day-file, or provider writes)",
      requestBudget: { maxPairs: Math.min(5, Math.max(1, Number(process.env.API_FOOTBALL_H2H_PROBE_PAIRS || 3))), maxRequests: 0, requestsUsed: 0 },
      candidateCount: 0,
      summary: { historyFound: 0, noHistoryReturned: 0, mappingMissing: 0, providerErrors: 1, notCompleted: 0 },
      mappingSuggestions: [],
      results: [],
      recommendation: `Read-only H2H probe failed before publishing provider results: ${error?.message || error}`,
    };
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
    console.error(`[api-football-h2h-probe] ${error?.message || error}`);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  });
}
