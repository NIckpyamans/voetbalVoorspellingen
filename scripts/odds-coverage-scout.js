#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
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

const limit = Math.max(1, Number(process.env.ODDS_SCOUT_LIMIT || 60));
const daysAhead = Math.max(1, Number(process.env.ODDS_SCOUT_DAYS_AHEAD || 21));
const generatedAt = new Date().toISOString();

const rows = await sql.query(
  `select m.match_id, m.canonical_fixture_id, m.league, m.home_team_name, m.away_team_name, m.kickoff_at,
    fsa.source_match_id as sportmonks_fixture_id,
    exists(select 1 from historical_odds_snapshots hos where hos.match_id=m.match_id and hos.available_before_kickoff=true) as has_historical_odds,
    exists(select 1 from prediction_snapshots ps join odds_snapshots os on os.prediction_id=ps.prediction_id where ps.match_id=m.match_id and os.available_before_kickoff=true) as has_prediction_odds
   from matches m
   left join fixture_source_aliases fsa on fsa.canonical_match_id = m.match_id and fsa.provider = 'sportmonks'
   where m.kickoff_at > now()
     and m.kickoff_at <= now() + ($1::text || ' days')::interval
     and m.home_team_name is not null
     and m.away_team_name is not null
     ${CLUB_ONLY_FIXTURE_WHERE}
   order by (case when exists(select 1 from historical_odds_snapshots hos where hos.match_id=m.match_id and hos.available_before_kickoff=true) then 1 else 0 end),
     m.kickoff_at asc
   limit $2`,
  [String(daysAhead), limit]
);

const statusCounts = {};
const sportCounts = {};
const leagueBuckets = {};
const samples = [];
let covered = 0;

for (const row of rows) {
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
  const sport = result?.requestMeta?.sport || result?.requestMeta?.attempts?.find((attempt) => ["available", "partial"].includes(attempt.status))?.sport || "unknown";
  statusCounts[status] = (statusCounts[status] || 0) + 1;
  sportCounts[sport] = (sportCounts[sport] || 0) + 1;
  const league = row.league || "unknown";
  const bucket = leagueBuckets[league] || { league, checked: 0, available: 0, partial: 0, notFound: 0, providerErrors: 0 };
  bucket.checked += 1;
  if (status === "available") bucket.available += 1;
  else if (status === "partial") bucket.partial += 1;
  else if (status === "not_found") bucket.notFound += 1;
  else if (status === "provider_error") bucket.providerErrors += 1;
  leagueBuckets[league] = bucket;
  if (["available", "partial"].includes(status)) covered += 1;
  if (samples.length < 20 || !["available", "partial"].includes(status)) {
    samples.push({
      matchId: row.match_id,
      kickoff: row.kickoff_at,
      league,
      home: row.home_team_name,
      away: row.away_team_name,
      status,
      sport,
      sportmonksFixtureId,
      attemptedSports: result?.requestMeta?.attemptedSports || [],
      attempts: result?.requestMeta?.attempts || [],
      hasHistoricalOdds: !!row.has_historical_odds,
      hasPredictionOdds: !!row.has_prediction_odds,
      reason: result?.reason || null,
    });
  }
}

const report = {
  generatedAt,
  checked: rows.length,
  covered,
  coverage: rows.length ? Number((covered / rows.length).toFixed(3)) : 0,
  statusCounts,
  sportCounts,
  leagueBuckets: Object.values(leagueBuckets).sort((a, b) => b.checked - a.checked),
  samples: samples.slice(0, 40),
  recommendation:
    covered > 0
      ? "Gebruik de succesvolle sportkeys/providerstatus in prematch capture en bewaak closing pairs."
      : "Geen oddsdekking gevonden voor deze kandidaten; voeg bredere provider toe voor Europese kwalificatie/voorrondewedstrijden.",
};

fs.mkdirSync(path.join(ROOT, "monitor"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "monitor", "odds-coverage-scout.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
