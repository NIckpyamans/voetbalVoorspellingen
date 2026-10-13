#!/usr/bin/env node

// Per-competitie odds-agent ("odds-chatbot"): zoekt zeven dagen vooruit naar
// wedstrijden van de actieve competities zonder timestamped prematch odds en
// probeert die gaten dagelijks te vullen. Volgorde per agent:
//   1. Verse provider-probe (The Odds API / Sportmonks template / API-Football)
//      via fetchOddsAtPrediction, met Sportmonks fixture-resolutie.
//   2. Rapport per competitie: welke duels gevuld zijn en welke nog missen,
//      zodat de volgende run (of een andere bron) ze kan oppakken.
// Geen odds worden gefabriceerd: alleen echte, getimestampte waarden worden
// weggeschreven en de leakage-guard in de database valideert odds_role.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { ACTIVE_COMPETITIONS } from "../shared/competitionVisibility.js";
import { CLUB_ONLY_FIXTURE_WHERE } from "./club-fixture-filter.js";
import { fetchOddsAtPrediction } from "./odds-provider.js";
import { resolveSportmonksFixtureId } from "./sportmonks-fixture-resolver.js";

const ROOT = process.cwd();
loadLocalEnv(ROOT);
const sql = getSql();
if (!sql) {
  console.error("DATABASE_URL of POSTGRES_URL ontbreekt.");
  process.exit(2);
}

const daysAhead = Math.max(1, Number(process.env.ODDS_AGENT_DAYS_AHEAD || 7));
const limit = Math.max(1, Number(process.env.ODDS_AGENT_MATCH_LIMIT || 120));
const generatedAt = new Date().toISOString();
const activeCompetitionSet = new Set(ACTIVE_COMPETITIONS);
const digest = (value) => crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 22);

const rows = await sql.query(
  `select m.match_id, m.canonical_fixture_id, m.league, m.home_team_name, m.away_team_name, m.kickoff_at,
     fsa.source_match_id as sportmonks_fixture_id
   from matches m
   left join fixture_source_aliases fsa on fsa.canonical_match_id = m.match_id and fsa.provider = 'sportmonks'
   where m.kickoff_at > now()
     and m.kickoff_at <= now() + ($1::text || ' days')::interval
     and m.home_team_name is not null
     and m.away_team_name is not null
     and m.league = any($2::text[])
     and not exists (
       select 1 from historical_odds_snapshots hos
       where hos.match_id = m.match_id
         and hos.odds_role = 'prematch'
         and hos.available_before_kickoff = true
         and hos.captured_at > now() - interval '12 hours'
     )
     and not exists (
       select 1 from prediction_snapshots ps
       join odds_snapshots os on os.prediction_id = ps.prediction_id
       where ps.match_id = m.match_id
         and os.odds_role = 'prematch'
         and os.available_before_kickoff = true
         and os.captured_at > now() - interval '12 hours'
     )
     ${CLUB_ONLY_FIXTURE_WHERE}
   order by m.kickoff_at asc
   limit $3`,
  [String(daysAhead), [...activeCompetitionSet], limit]
);

const competitions = {};
for (const league of activeCompetitionSet) {
  competitions[league] = { league, missing: 0, filled: 0, attempted: 0, stillMissing: [] };
}

const errors = [];
const filledMatches = [];
const statusCounts = {};

for (const row of rows) {
  const league = row.league || "unknown";
  if (!competitions[league]) competitions[league] = { league, missing: 0, filled: 0, attempted: 0, stillMissing: [] };
  const bucket = competitions[league];
  bucket.missing += 1;
  bucket.attempted += 1;
  try {
    let sportmonksFixtureId = row.sportmonks_fixture_id ? String(row.sportmonks_fixture_id) : null;
    if (!sportmonksFixtureId) {
      const resolved = await resolveSportmonksFixtureId(sql, {
        matchId: row.match_id,
        canonicalFixtureId: row.canonical_fixture_id,
        league: row.league,
        homeTeam: row.home_team_name,
        awayTeam: row.away_team_name,
        kickoff: row.kickoff_at,
      });
      if (resolved?.fixtureId) sportmonksFixtureId = String(resolved.fixtureId);
    }
    const result = await fetchOddsAtPrediction(
      {
        matchId: row.match_id,
        sportmonksFixtureId,
        league: row.league,
        homeTeam: row.home_team_name,
        awayTeam: row.away_team_name,
        kickoff: row.kickoff_at,
      },
      { generatedAt, cutoffAt: generatedAt }
    );
    const status = result?.status || "unknown";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    const odds = result?.oddsAtPrediction;
    if (!odds || ![odds.home, odds.draw, odds.away].every((value) => Number(value) > 1)) {
      bucket.stillMissing.push({
        matchId: row.match_id,
        kickoff: row.kickoff_at,
        home: row.home_team_name,
        away: row.away_team_name,
        status,
        reason: result?.reason || null,
      });
      continue;
    }
    const capturedAt = odds.capturedAt || generatedAt;
    if (Date.parse(capturedAt) >= Date.parse(row.kickoff_at)) {
      bucket.stillMissing.push({ matchId: row.match_id, kickoff: row.kickoff_at, home: row.home_team_name, away: row.away_team_name, status: "rejected_after_cutoff" });
      continue;
    }
    const provider = odds.provider || result.provider || "odds-provider";
    const bookmaker = odds.bookmaker || provider;
    const snapshotId = `prematch_${digest(`${row.match_id}|${provider}|${bookmaker}|${capturedAt.slice(0, 13)}`)}`;
    await sql.query(
      `insert into historical_odds_snapshots (
        historical_odds_snapshot_id,match_id,provider,bookmaker,market,home,draw,away,captured_at,
        odds_role,available_before_kickoff,minutes_before_kickoff,source_record_id
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'prematch',true,$10,null)
      on conflict (historical_odds_snapshot_id) do update set
        provider=excluded.provider,
        home=excluded.home, draw=excluded.draw, away=excluded.away,
        captured_at=excluded.captured_at,
        available_before_kickoff=excluded.available_before_kickoff,
        minutes_before_kickoff=excluded.minutes_before_kickoff`,
      [
        snapshotId,
        row.match_id,
        provider,
        bookmaker,
        odds.market || "h2h",
        Number(odds.home),
        Number(odds.draw),
        Number(odds.away),
        capturedAt,
        Math.floor((Date.parse(row.kickoff_at) - Date.parse(capturedAt)) / 60000),
      ]
    );
    bucket.filled += 1;
    filledMatches.push({ matchId: row.match_id, league, provider, bookmaker, kickoff: row.kickoff_at });
  } catch (error) {
    errors.push({ matchId: row.match_id, error: error?.message || String(error) });
    bucket.stillMissing.push({ matchId: row.match_id, kickoff: row.kickoff_at, home: row.home_team_name, away: row.away_team_name, status: "provider_error" });
  }
}

const leagueBuckets = Object.values(competitions).filter((bucket) => bucket.missing > 0 || bucket.attempted > 0);
const stillMissingTotal = leagueBuckets.reduce((sum, bucket) => sum + bucket.stillMissing.length, 0);

const report = {
  generatedAt,
  schemaVersion: "competition-odds-agent-v1",
  daysAhead,
  window: `next ${daysAhead} day(s)`,
  checkedMissingMatches: rows.length,
  filled: filledMatches.length,
  stillMissing: stillMissingTotal,
  statusCounts,
  competitions: leagueBuckets.map((bucket) => ({
    ...bucket,
    stillMissing: bucket.stillMissing.slice(0, 15),
    stillMissingTotal: bucket.stillMissing.length,
    fillRate: bucket.attempted ? Number((bucket.filled / bucket.attempted).toFixed(3)) : null,
  })),
  filledMatches: filledMatches.slice(0, 40),
  errors: errors.slice(0, 10),
  recommendation:
    stillMissingTotal === 0
      ? "Alle actieve competities hebben prematch-odds binnen het weekvenster."
      : "Resterende gaten: check providerdekking per competitie (seizoenskeys) en herhaal morgen; football-data.co.uk vult avondwestrijd-closing later aan.",
};

fs.mkdirSync(path.join(ROOT, "monitor"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "monitor", "competition-odds-agent.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `[competition-odds-agent] weekvenster ${daysAhead}d: ${rows.length} duels zonder odds, ${filledMatches.length} gevuld, ${stillMissingTotal} nog missend`
);
