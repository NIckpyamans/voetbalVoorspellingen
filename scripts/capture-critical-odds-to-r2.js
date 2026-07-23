#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { buildR2ObjectKey, getR2Config, getR2Object, putR2Object } from "../shared/cloudflare-r2.js";
import { loadLocalEnv } from "../shared/database.js";
import { fetchOddsAtPrediction } from "./odds-provider.js";
import { findSportmonksFixture } from "./sportmonks-fixture-resolver.js";
import { mergeOddsCaptureLedger } from "./worker/critical-captures.js";
import { summarizeLeagueCoverage } from "./worker/coverage-summary.js";

const ROOT = process.cwd();
const HOURS_AHEAD = Math.max(3, Number(process.env.CRITICAL_ODDS_HOURS_AHEAD || 36));
const LIMIT = Math.max(1, Number(process.env.CRITICAL_ODDS_MATCH_LIMIT || 40));
const OUTPUT = path.join(ROOT, "monitor", "critical-odds-capture.json");

function upcomingMatches() {
  const now = Date.now();
  const rows = [];
  for (let offset = 0; offset <= 2; offset += 1) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() + offset);
    const filePath = path.join(ROOT, "data", "days", `${day.toISOString().slice(0, 10)}.json`);
    if (!fs.existsSync(filePath)) continue;
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    for (const match of Array.isArray(payload?.matches) ? payload.matches : []) {
      const kickoff = Date.parse(match?.kickoff || "");
      if (!Number.isFinite(kickoff) || kickoff <= now || kickoff > now + HOURS_AHEAD * 3600000) continue;
      if (!match?.homeTeamName || !match?.awayTeamName) continue;
      rows.push({
        matchId: String(match.id || `ss-${match.sofaId}`),
        kickoff: new Date(kickoff).toISOString(),
        league: match.league || null,
        homeTeam: match.homeTeamName,
        awayTeam: match.awayTeamName,
      });
    }
  }
  return rows.sort((left, right) => Date.parse(left.kickoff) - Date.parse(right.kickoff)).slice(0, LIMIT);
}

async function readLedger(config, key) {
  const object = await getR2Object({ config, key }).catch(() => null);
  if (!object?.ok) return null;
  return JSON.parse(object.body.toString("utf8"));
}

async function main() {
  loadLocalEnv(ROOT);
  const config = getR2Config();
  if (!config.configured) throw new Error("Cloudflare R2 secrets ontbreken voor critical odds capture.");
  const matches = upcomingMatches();
  const report = {
    generatedAt: new Date().toISOString(),
    checked: matches.length,
    captured: 0,
    openingCaptured: 0,
    prematchCaptured: 0,
    closingCaptured: 0,
    closingPairs: 0,
    statuses: {},
    sportmonksMapped: 0,
    sportmonksMappingStatuses: {},
    matches: [],
  };
  for (const match of matches) {
    const sportmonks = await findSportmonksFixture(match).catch((error) => ({ status: "resolver_error", error: error?.message || String(error) }));
    report.sportmonksMappingStatuses[sportmonks?.status || "unknown"] = Number(report.sportmonksMappingStatuses[sportmonks?.status || "unknown"] || 0) + 1;
    if (sportmonks?.fixtureId) report.sportmonksMapped += 1;
    const oddsMatch = { ...match, sportmonksFixtureId: sportmonks?.fixtureId || null };
    const result = await fetchOddsAtPrediction(oddsMatch, { generatedAt: new Date().toISOString(), cutoffAt: new Date().toISOString() });
    report.statuses[result?.status || "unknown"] = Number(report.statuses[result?.status || "unknown"] || 0) + 1;
    const odds = result?.oddsAtPrediction;
    if (!odds || ![odds.home, odds.draw, odds.away].every((value) => Number(value) > 1)) {
      report.matches.push({ ...match, status: result?.status || "not_found", sportmonksMapping: sportmonks?.status || "unknown" });
      continue;
    }
    const key = buildR2ObjectKey(config, `critical-captures/odds/${match.matchId}.json`);
    const ledger = mergeOddsCaptureLedger(await readLedger(config, key), match, odds);
    await putR2Object({ config, key, body: `${JSON.stringify(ledger)}\n`, contentType: "application/json", metadata: { match: match.matchId, provider: odds.provider } });
    report.captured += 1;
    const latestRole = ledger.snapshots.at(-1)?.roleAtCapture;
    if (latestRole === "opening") report.openingCaptured += 1;
    if (latestRole === "prematch") report.prematchCaptured += 1;
    if (latestRole === "closing") report.closingCaptured += 1;
    if (ledger.closing) report.closingPairs += 1;
    report.matches.push({ ...match, status: "captured", provider: odds.provider, captureRole: latestRole, sportmonksFixtureId: sportmonks?.fixtureId || null, opening: Boolean(ledger.opening), prematch: Boolean(ledger.prematch), closing: Boolean(ledger.closing) });
  }
  report.leagueCoverage = summarizeLeagueCoverage(report.matches, {
    success: (row) => row.status === "captured",
  });
  report.coverage = report.checked ? Number((report.captured / report.checked).toFixed(3)) : 0;
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
