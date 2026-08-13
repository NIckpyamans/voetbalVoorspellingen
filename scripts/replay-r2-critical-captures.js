#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildR2ObjectKey, getR2Config, getR2Object } from "../shared/cloudflare-r2.js";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { readApiFootballFixtureCache } from "./worker/api-football-fixture-cache.js";

const ROOT = process.cwd();
const DAYS_BACK = Math.max(0, Number(process.env.R2_REPLAY_DAYS_BACK || 1));
const DAYS_AHEAD = Math.max(1, Number(process.env.R2_REPLAY_DAYS_AHEAD || 14));
const OUTPUT = path.join(ROOT, "monitor", "r2-critical-capture-replay.json");

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
  let closingPairs = 0;
  if (payload?.closing && payload?.prematch) {
    const updated = await sql.query(
      `update historical_odds_snapshots
       set closing_home=$2,closing_draw=$3,closing_away=$4,closing_captured_at=$5
       where historical_odds_snapshot_id=(
         select historical_odds_snapshot_id from historical_odds_snapshots
         where match_id=$1 and odds_role='prematch' and captured_at<$5
         order by captured_at asc limit 1
       )
       and (closing_home,closing_draw,closing_away,closing_captured_at)
         is distinct from ($2::numeric,$3::numeric,$4::numeric,$5::timestamptz)
       returning historical_odds_snapshot_id`,
      [matchId, Number(payload.closing.home), Number(payload.closing.draw), Number(payload.closing.away), payload.closing.capturedAt]
    );
    closingPairs = updated.length;
  }
  return { snapshots: writes, closingPairs };
}

async function replayFixtureMapping(sql, match, cached) {
  if (!cached?.providerFixtureId) return 0;
  const providerFixtureId = String(cached.providerFixtureId);
  const payload = {
    source: "API-Football",
    sourceMatchId: providerFixtureId,
    matchId: match.matchId,
    homeTeam: cached.homeTeam || null,
    awayTeam: cached.awayTeam || null,
    confidence: Number(cached.confidence || 0),
    mappedAt: cached.mappedAt || null,
  };
  const sourceRecordId = `api_football_fixture_${digest(`${match.matchId}|${providerFixtureId}`, 24)}`;
  const matchSourceRecordId = `msr_${digest(`${match.matchId}|${sourceRecordId}`, 24)}`;
  const aliasId = `fixture_alias_${digest(`api-football|${providerFixtureId}`, 24)}`;
  await sql.query(
    `insert into source_records(
       source_record_id,provider,source_url,entity_type,entity_key,fetched_at,source_timestamp,content_hash,trust_score,payload
     ) values($1,'api-football',$2,'fixture',$3,now(),$4,$5,0.8,$6::jsonb)
     on conflict(source_record_id) do update set
       fetched_at=excluded.fetched_at,
       source_timestamp=coalesce(excluded.source_timestamp,source_records.source_timestamp),
       content_hash=excluded.content_hash,
       payload=excluded.payload`,
    [sourceRecordId, "https://v3.football.api-sports.io/fixtures", match.matchId, cached.mappedAt || null, digest(JSON.stringify(payload), 40), JSON.stringify(payload)]
  );
  await sql.query(
    `insert into match_source_records(match_source_record_id,match_id,source_record_id,provider,source_match_id,is_primary,trust_score)
     values($1,$2,$3,'api-football',$4,false,0.8)
     on conflict(match_source_record_id) do update set
       source_match_id=excluded.source_match_id,
       trust_score=greatest(coalesce(match_source_records.trust_score,0),excluded.trust_score),
       updated_at=now()`,
    [matchSourceRecordId, match.matchId, sourceRecordId, providerFixtureId]
  );
  await sql.query(
    `insert into fixture_source_aliases(
       fixture_source_alias_id,canonical_fixture_id,canonical_match_id,source_match_id,provider,source_payload
     ) values($1,$2,$3,$4,'api-football',$5::jsonb)
     on conflict(provider,source_match_id) do update set
       canonical_fixture_id=excluded.canonical_fixture_id,
       canonical_match_id=excluded.canonical_match_id,
       source_payload=excluded.source_payload,
       updated_at=now()`,
    [aliasId, String(match.canonicalFixtureId || match.matchId), match.matchId, providerFixtureId, JSON.stringify(payload)]
  );
  return 1;
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
  const apiFootballCache = readApiFootballFixtureCache(ROOT);
  const report = {
    generatedAt: new Date().toISOString(),
    fixtures: fixtures.length,
    lineups: 0,
    odds: 0,
    closingPairs: 0,
    h2h: 0,
    fixtureMappings: 0,
    missingDatabaseMatches: 0,
  };
  if (!fixtures.length) {
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const existingRows = await sql.query("select match_id,canonical_fixture_id from matches where match_id = any($1::text[])", [fixtures.map((fixture) => fixture.matchId)]);
  const existingMatches = new Map(existingRows.map((row) => [String(row.match_id), {
    matchId: String(row.match_id),
    canonicalFixtureId: row.canonical_fixture_id ? String(row.canonical_fixture_id) : String(row.match_id),
  }]));
  for (const fixture of fixtures) {
    const databaseMatch = existingMatches.get(fixture.matchId);
    if (!databaseMatch) {
      report.missingDatabaseMatches += 1;
      continue;
    }
    report.fixtureMappings += await replayFixtureMapping(sql, databaseMatch, apiFootballCache.fixtures?.[fixture.matchId]);
    const [lineup, odds, h2h] = await Promise.all([
      readCapture(config, "lineups", fixture.matchId),
      readCapture(config, "odds", fixture.matchId),
      readCapture(config, "h2h", fixture.matchId),
    ]);
    report.lineups += await replayLineup(sql, fixture.matchId, lineup);
    const replayedOdds = await replayOdds(sql, fixture.matchId, odds);
    report.odds += replayedOdds.snapshots;
    report.closingPairs += replayedOdds.closingPairs;
    report.h2h += await replayH2H(sql, fixture.matchId, h2h);
  }
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
