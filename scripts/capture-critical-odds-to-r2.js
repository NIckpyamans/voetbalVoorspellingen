#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { buildR2ObjectKey, getR2Config, getR2Object, putR2Object } from "../shared/cloudflare-r2.js";
import { loadLocalEnv } from "../shared/database.js";
import { fetchOddsAtPrediction } from "./odds-provider.js";

const ROOT = process.cwd();
const HOURS_AHEAD = Math.max(3, Number(process.env.CRITICAL_ODDS_HOURS_AHEAD || 36));
const LIMIT = Math.max(1, Number(process.env.CRITICAL_ODDS_MATCH_LIMIT || 40));

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

function mergeSnapshot(ledger, match, odds) {
  const snapshots = Array.isArray(ledger?.snapshots) ? ledger.snapshots : [];
  const capturedAt = odds.capturedAt || new Date().toISOString();
  if (!snapshots.some((item) => item.provider === odds.provider && item.bookmaker === odds.bookmaker && item.capturedAt === capturedAt)) {
    snapshots.push({
      provider: odds.provider,
      bookmaker: odds.bookmaker,
      market: odds.market || "1X2",
      home: odds.home,
      draw: odds.draw,
      away: odds.away,
      capturedAt,
    });
  }
  snapshots.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
  const valid = snapshots.filter((item) => Date.parse(item.capturedAt) < Date.parse(match.kickoff));
  const prematch = valid[0] || null;
  const latest = valid.at(-1) || null;
  const minutesBeforeKickoff = latest ? Math.floor((Date.parse(match.kickoff) - Date.parse(latest.capturedAt)) / 60000) : null;
  const closing = prematch && latest && latest.capturedAt !== prematch.capturedAt && minutesBeforeKickoff > 0 && minutesBeforeKickoff <= 120 ? latest : null;
  return {
    schemaVersion: "critical-odds-v1",
    match,
    updatedAt: new Date().toISOString(),
    prematch,
    closing,
    snapshots: valid.slice(-12),
  };
}

async function main() {
  loadLocalEnv(ROOT);
  const config = getR2Config();
  if (!config.configured) throw new Error("Cloudflare R2 secrets ontbreken voor critical odds capture.");
  const matches = upcomingMatches();
  const report = { generatedAt: new Date().toISOString(), checked: matches.length, captured: 0, closingPairs: 0, statuses: {}, matches: [] };
  for (const match of matches) {
    const result = await fetchOddsAtPrediction(match, { generatedAt: new Date().toISOString(), cutoffAt: new Date().toISOString() });
    report.statuses[result?.status || "unknown"] = Number(report.statuses[result?.status || "unknown"] || 0) + 1;
    const odds = result?.oddsAtPrediction;
    if (!odds || ![odds.home, odds.draw, odds.away].every((value) => Number(value) > 1)) {
      report.matches.push({ ...match, status: result?.status || "not_found" });
      continue;
    }
    const key = buildR2ObjectKey(config, `critical-captures/odds/${match.matchId}.json`);
    const ledger = mergeSnapshot(await readLedger(config, key), match, odds);
    await putR2Object({ config, key, body: `${JSON.stringify(ledger)}\n`, contentType: "application/json", metadata: { match: match.matchId, provider: odds.provider } });
    report.captured += 1;
    if (ledger.closing) report.closingPairs += 1;
    report.matches.push({ ...match, status: "captured", provider: odds.provider, closing: Boolean(ledger.closing) });
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
