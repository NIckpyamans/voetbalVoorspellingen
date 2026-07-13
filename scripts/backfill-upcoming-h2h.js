#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fetchApiFootballH2HProfile, summarizeApiFootballUsage } from "./api-football-provider.js";
import { getApiFootballKey } from "./provider-env.js";
import { getSql, loadLocalEnv } from "../shared/database.js";

const ROOT = process.cwd();
const OUTPUT_JSON = path.join(ROOT, "monitor", "h2h-upcoming-backfill.json");
const OUTPUT_MD = path.join(ROOT, "monitor", "h2h-upcoming-backfill.md");
const DAYS_AHEAD = Math.max(1, Number(process.env.H2H_BACKFILL_DAYS_AHEAD || 14));
const LIMIT = Math.max(1, Number(process.env.H2H_BACKFILL_LIMIT || 40));

function digest(value, size = 20) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, size);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function edgeIds(homeClubId, awayClubId, competitionId) {
  const clubA = [homeClubId, awayClubId].sort()[0];
  const clubB = [homeClubId, awayClubId].sort()[1];
  return {
    clubA,
    clubB,
    edgeId: `h2h_${digest(`${clubA}|${clubB}|${competitionId}`)}`,
  };
}

function orientResultForStoredEdge(result, clubA, homeClubId, awayClubId) {
  const currentHomeIsClubA = String(homeClubId) === String(clubA);
  return {
    ...result,
    storedHomeClubId: clubA,
    storedAwayClubId: currentHomeIsClubA ? awayClubId : homeClubId,
    storedHomeScore: currentHomeIsClubA ? result.homeScore : result.awayScore,
    storedAwayScore: currentHomeIsClubA ? result.awayScore : result.homeScore,
  };
}

async function upsertH2HEdge(sql, match, profile) {
  const { clubA, clubB, edgeId } = edgeIds(match.home_club_id, match.away_club_id, match.competition_id);
  const oriented = (profile.results || []).map((result) => orientResultForStoredEdge(result, clubA, match.home_club_id, match.away_club_id));
  const homeWins = oriented.filter((item) => Number(item.storedHomeScore) > Number(item.storedAwayScore)).length;
  const awayWins = oriented.filter((item) => Number(item.storedAwayScore) > Number(item.storedHomeScore)).length;
  const draws = oriented.length - homeWins - awayWins;
  const weightedRecentBalance = Number(((homeWins - awayWins) / Math.max(oriented.length, 1)).toFixed(3));
  const provider = String(profile.source || "h2h-backfill").toLowerCase().includes("database") ? "database-results" : "api-football";
  const sourceRecordId = `${provider}-h2h:${digest(`${match.match_id}|${profile.asOf || ""}|${JSON.stringify(oriented)}`)}`;

  await sql.query(
    `insert into source_records(source_record_id,provider,entity_type,entity_key,fetched_at,source_timestamp,content_hash,trust_score,payload)
     values($1,$2,'h2h',$3,now(),$4,$5,$6,$7::jsonb)
     on conflict(source_record_id) do update set fetched_at=excluded.fetched_at,payload=excluded.payload`,
    [sourceRecordId, provider, match.match_id, profile.asOf || new Date().toISOString(), digest(JSON.stringify(oriented), 40), provider === "database-results" ? 0.94 : 0.86, JSON.stringify({ matchId: match.match_id, source: profile.source, results: oriented })]
  );

  await sql.query(
    `
      insert into h2h_edges(
        h2h_edge_id, home_club_id, away_club_id, competition_id, played,
        home_wins, draws, away_wins, weighted_recent_balance, results, source_record_id, updated_at
      )
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,now())
      on conflict(h2h_edge_id) do update set
        played = excluded.played,
        home_wins = excluded.home_wins,
        draws = excluded.draws,
        away_wins = excluded.away_wins,
        weighted_recent_balance = excluded.weighted_recent_balance,
        results = excluded.results,
        source_record_id = excluded.source_record_id,
        updated_at = now()
    `,
    [
      edgeId,
      clubA,
      clubB,
      match.competition_id,
      oriented.length,
      homeWins,
      draws,
      awayWins,
      weightedRecentBalance,
      JSON.stringify(oriented),
      sourceRecordId,
    ]
  );
}

async function readDatabaseH2HProfile(sql, match) {
  const rows = await sql.query(
    `select m.match_id,m.date_key,m.league,m.home_club_id,m.away_club_id,m.home_team_name,m.away_team_name,
       mr.final_home_goals,mr.final_away_goals,mr.result_source,mr.settled_at
     from matches m
     join match_results mr on mr.match_id=m.match_id
     where m.kickoff_at < $1
       and ((m.home_club_id=$2 and m.away_club_id=$3) or (m.home_club_id=$3 and m.away_club_id=$2))
       and mr.final_home_goals is not null and mr.final_away_goals is not null
     order by m.kickoff_at desc
     limit 20`,
    [match.kickoff_at, match.home_club_id, match.away_club_id]
  );
  if (!rows.length) return null;
  const results = rows.map((row) => {
    const currentOrientation = String(row.home_club_id) === String(match.home_club_id);
    return {
      date: row.date_key,
      league: row.league,
      homeTeam: currentOrientation ? row.home_team_name : row.away_team_name,
      awayTeam: currentOrientation ? row.away_team_name : row.home_team_name,
      homeScore: Number(currentOrientation ? row.final_home_goals : row.final_away_goals),
      awayScore: Number(currentOrientation ? row.final_away_goals : row.final_home_goals),
      source: row.result_source || "match_results",
    };
  });
  return { results, source: "database historical match results", asOf: rows[0]?.settled_at || new Date().toISOString() };
}

function buildNoDirectHistoryProfile(match, status) {
  return {
    matchId: match.match_id,
    date: match.date_key,
    league: match.league,
    homeTeam: match.home_team_name,
    awayTeam: match.away_team_name,
    status,
    note:
      status === "provider_not_configured"
        ? "API-Football is in deze omgeving niet geconfigureerd; GitHub Actions kan dit wel uitvoeren als de secret aanwezig is."
        : status === "team_mapping_missing"
          ? "Providerteam-ID mapping ontbreekt; voeg aliases of provider-ID's toe voor dit clubpaar."
          : status === "rate_limited_locally"
            ? "Providerquota voor deze run is bereikt; volgende geplande run probeert opnieuw."
            :
      status === "not_found"
        ? "Geen betrouwbare directe H2H gevonden bij de gekoppelde provider. Dit wordt niet als gespeelde H2H gefaket."
        : "H2H kon niet worden opgehaald door mapping/providerstatus.",
  };
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  if (!sql) process.exit(2);

  const candidates = await sql.query(
    `
      select m.match_id, m.date_key, m.kickoff_at, m.league, m.competition_id, m.home_team_name, m.away_team_name,
        m.home_club_id, m.away_club_id
      from matches m
      where m.kickoff_at >= now()
        and m.kickoff_at <= now() + ($1::int * interval '1 day')
        and m.identity_status = 'resolved'
        and m.home_club_id is not null
        and m.away_club_id is not null
        and not exists (
          select 1 from h2h_edges h
          where h.home_club_id = least(m.home_club_id, m.away_club_id)
            and h.away_club_id = greatest(m.home_club_id, m.away_club_id)
            and h.competition_id is not distinct from m.competition_id
            and h.played > 0
        )
      order by m.kickoff_at, m.match_id
      limit $2
    `,
    [DAYS_AHEAD, LIMIT]
  );

  const store = {};
  const providerConfigured = Boolean(getApiFootballKey());
  const filled = [];
  const noDirectHistory = [];
  const errors = [];

  for (const match of candidates) {
    try {
      const databaseProfile = await readDatabaseH2HProfile(sql, match);
      if (databaseProfile?.results?.length) {
        await upsertH2HEdge(sql, match, databaseProfile);
        filled.push({
          matchId: match.match_id,
          date: match.date_key,
          homeTeam: match.home_team_name,
          awayTeam: match.away_team_name,
          played: databaseProfile.results.length,
          source: databaseProfile.source,
        });
        continue;
      }
      if (!providerConfigured) {
        noDirectHistory.push(buildNoDirectHistoryProfile(match, "provider_not_configured"));
        continue;
      }
      const profile = await fetchApiFootballH2HProfile({
        store,
        homeName: match.home_team_name,
        awayName: match.away_team_name,
        homeId: match.home_club_id,
        awayId: match.away_club_id,
        leagueLabel: match.league,
      });
      if (profile?.results?.length) {
        await upsertH2HEdge(sql, match, profile);
        filled.push({
          matchId: match.match_id,
          date: match.date_key,
          homeTeam: match.home_team_name,
          awayTeam: match.away_team_name,
          played: profile.results.length,
          source: profile.source,
        });
      } else {
        const cacheKey = `${String(match.league || "").toLowerCase()}:${String(match.home_team_name || "").toLowerCase()}__${String(match.away_team_name || "").toLowerCase()}`;
        const status = store.apiFootballH2HCache?.[cacheKey]?.status || "not_found";
        noDirectHistory.push(buildNoDirectHistoryProfile(match, status));
      }
    } catch (error) {
      errors.push({
        matchId: match.match_id,
        homeTeam: match.home_team_name,
        awayTeam: match.away_team_name,
        error: error?.message || String(error),
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    daysAhead: DAYS_AHEAD,
    checked: candidates.length,
    filled: filled.length,
    noDirectHistory: noDirectHistory.length,
    errors: errors.length,
    apiFootball: summarizeApiFootballUsage(store),
    filledSamples: filled.slice(0, 20),
    noDirectHistorySamples: noDirectHistory.slice(0, 20),
    errorSamples: errors.slice(0, 10),
    recommendation:
      !providerConfigured
        ? "API-Football is lokaal niet geconfigureerd. Laat de GitHub workflow draaien met API_KEY_API_FOOTBALL of voeg de key lokaal toe voor handmatige backfill."
        :
      filled.length > 0
        ? "H2H-profielen zijn naar Neon geschreven. Laat de worker draaien zodat voorspellingen de nieuwe edges gebruiken."
        : "Geen directe H2H gevonden voor de gecontroleerde wedstrijden. Breid team-ID mapping/providerdekking uit of accepteer expliciet no-direct-history voor deze fixtures.",
  };

  writeJson(OUTPUT_JSON, report);
  fs.writeFileSync(
    OUTPUT_MD,
    [
      "# Upcoming H2H Backfill",
      "",
      `Laatst bijgewerkt: ${report.generatedAt}`,
      `Gecontroleerd: ${report.checked}`,
      `Gevuld: ${report.filled}`,
      `Geen directe H2H: ${report.noDirectHistory}`,
      `Errors: ${report.errors}`,
      "",
      "## Aanbeveling",
      report.recommendation,
      "",
      "## Gevuld",
      ...report.filledSamples.map((item) => `- ${item.date}: ${item.homeTeam} - ${item.awayTeam} (${item.played})`),
      "",
      "## Geen Directe H2H",
      ...report.noDirectHistorySamples.map((item) => `- ${item.date}: ${item.homeTeam} - ${item.awayTeam} (${item.status})`),
      "",
    ].join("\n")
  );

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
