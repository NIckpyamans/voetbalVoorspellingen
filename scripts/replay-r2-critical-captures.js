#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildR2ObjectKey, getR2Config, getR2Object } from "../shared/cloudflare-r2.js";
import { getSql, loadLocalEnv } from "../shared/database.js";

const ROOT = process.cwd();
const DAYS_BACK = Math.max(0, Number(process.env.R2_REPLAY_DAYS_BACK || 1));
const DAYS_AHEAD = Math.max(1, Number(process.env.R2_REPLAY_DAYS_AHEAD || 14));

function digest(value, size = 32) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, size);
}

function fixtureIds() {
  const rows = new Map();
  const now = new Date();
  for (let offset = -DAYS_BACK; offset <= DAYS_AHEAD; offset += 1) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + offset);
    const file = path.join(ROOT, "data", "days", `${date.toISOString().slice(0, 10)}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const match of Array.isArray(payload?.matches) ? payload.matches : []) {
        const matchId = String(match.id || (match.sofaId ? `ss-${match.sofaId}` : ""));
        if (!matchId) continue;
        rows.set(matchId, { matchId, kickoff: match.kickoff || null });
      }
    } catch (error) {
      console.warn(`[r2-replay] kon ${file} niet lezen: ${error?.message || error}`);
    }
  }
  return [...rows.values()];
}

async function readCapture(config, type, matchId) {
  const object = await getR2Object({
    config,
    key: buildR2ObjectKey(config, `critical-captures/${type}/${matchId}.json`),
  }).catch(() => null);
  if (!object?.ok) return null;
  return JSON.parse(object.body.toString("utf8"));
}

async function replayLineup(sql, matchId, payload) {
  const attempts = Array.isArray(payload?.attempts) ? payload.attempts : payload?.lineupSummary ? [payload] : [];
  let writes = 0;
  for (const attempt of attempts) {
    if (!attempt?.lineupSummary || !attempt?.capturedAt) continue;
    const provider = attempt.provider || payload.provider || "r2-lineup-replay";
    const contentHash = digest(JSON.stringify(attempt.lineupSummary), 40);
    const sourceRecordId = `lineup_${digest(`${matchId}|${provider}|${contentHash}`, 40)}`;
    const inserted = await sql.query(
      `insert into source_records(source_record_id,provider,entity_type,entity_key,fetched_at,source_timestamp,content_hash,trust_score,payload)
       values($1,$2,'lineup',$3,now(),$4,$5,$6,$7::jsonb)
       on conflict(source_record_id) do nothing
       returning source_record_id`,
      [sourceRecordId, provider, matchId, attempt.capturedAt, contentHash, attempt.lineupSummary.confirmed ? 0.92 : 0.72, JSON.stringify({ ...attempt, matchId })]
    );
    writes += inserted.length;
  }
  return writes;
}

async function replayOdds(sql, matchId, payload) {
  const snapshots = Array.isArray(payload?.snapshots) ? payload.snapshots : [];
  let writes = 0;
  for (const odds of snapshots) {
    if (![odds?.home, odds?.draw, odds?.away].every((value) => Number(value) > 1) || !odds?.capturedAt) continue;
    // Het relationele schema classificeert alle tijdscorrecte invoer als prematch;
    // opening/prematch/closing blijven als immutable eventrollen in R2 bewaard.
    const role = "prematch";
    const id = `r2_${digest(`${matchId}|${odds.provider}|${odds.bookmaker}|${odds.capturedAt}|${role}`, 36)}`;
    const inserted = await sql.query(
      `insert into historical_odds_snapshots(
         historical_odds_snapshot_id,match_id,provider,bookmaker,market,home,draw,away,captured_at,
         odds_role,available_before_kickoff,minutes_before_kickoff,source_record_id
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,null)
       on conflict(historical_odds_snapshot_id) do nothing
       returning historical_odds_snapshot_id`,
      [id, matchId, odds.provider || "r2-odds-replay", odds.bookmaker || odds.provider || "unknown", odds.market || "1X2", Number(odds.home), Number(odds.draw), Number(odds.away), odds.capturedAt, role, odds.minutesBeforeKickoff]
    );
    writes += inserted.length;
  }
  if (payload?.closing && payload?.prematch) {
    await sql.query(
      `update historical_odds_snapshots
       set closing_home=$2,closing_draw=$3,closing_away=$4,closing_captured_at=$5
       where historical_odds_snapshot_id=(
         select historical_odds_snapshot_id from historical_odds_snapshots
         where match_id=$1 and odds_role='prematch' and captured_at<$5
         order by captured_at asc limit 1
       )
       and (closing_home,closing_draw,closing_away,closing_captured_at)
         is distinct from ($2::numeric,$3::numeric,$4::numeric,$5::timestamptz)`,
      [matchId, Number(payload.closing.home), Number(payload.closing.draw), Number(payload.closing.away), payload.closing.capturedAt]
    );
  }
  return writes;
}

async function replayH2H(sql, matchId, payload) {
  if (!payload?.h2h?.results?.length || !payload?.capturedAt) return 0;
  const provider = payload.provider || "r2-h2h-replay";
  const contentHash = digest(JSON.stringify(payload.h2h), 40);
  const sourceRecordId = `h2h_r2_${digest(`${matchId}|${provider}|${contentHash}`, 36)}`;
  const inserted = await sql.query(
    `insert into source_records(source_record_id,provider,entity_type,entity_key,fetched_at,source_timestamp,content_hash,trust_score,payload)
     values($1,$2,'h2h',$3,now(),$4,$5,0.86,$6::jsonb)
     on conflict(source_record_id) do nothing
     returning source_record_id`,
    [sourceRecordId, provider, matchId, payload.capturedAt, contentHash, JSON.stringify(payload)]
  );
  return inserted.length;
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  const config = getR2Config();
  if (!sql) throw new Error("DATABASE_URL ontbreekt voor R2 replay.");
  if (!config.configured) throw new Error("Cloudflare R2 is niet geconfigureerd voor replay.");
  const fixtures = fixtureIds();
  const report = { generatedAt: new Date().toISOString(), fixtures: fixtures.length, lineups: 0, odds: 0, h2h: 0, missingDatabaseMatches: 0 };
  if (!fixtures.length) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const existingRows = await sql.query("select match_id from matches where match_id = any($1::text[])", [fixtures.map((fixture) => fixture.matchId)]);
  const existingMatchIds = new Set(existingRows.map((row) => String(row.match_id)));
  for (const fixture of fixtures) {
    if (!existingMatchIds.has(fixture.matchId)) {
      report.missingDatabaseMatches += 1;
      continue;
    }
    const [lineup, odds, h2h] = await Promise.all([
      readCapture(config, "lineups", fixture.matchId),
      readCapture(config, "odds", fixture.matchId),
      readCapture(config, "h2h", fixture.matchId),
    ]);
    report.lineups += await replayLineup(sql, fixture.matchId, lineup);
    report.odds += await replayOdds(sql, fixture.matchId, odds);
    report.h2h += await replayH2H(sql, fixture.matchId, h2h);
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
