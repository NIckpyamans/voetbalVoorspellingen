#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, "monitor", "competition-season-reset.json");

function digest(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 20);
}

function inferEntryReason(current, previousByClub) {
  const previous = previousByClub.get(current.club_id);
  if (!previous) return { reason: "new_or_promoted", previousSeasonId: null, previousLevel: null };
  const currentLevel = Number(current.level || 0);
  const previousLevel = Number(previous.level || 0);
  if (previousLevel > currentLevel) return { reason: "promoted", previousSeasonId: previous.season_id, previousLevel };
  if (previousLevel < currentLevel) return { reason: "relegated", previousSeasonId: previous.season_id, previousLevel };
  return { reason: "retained", previousSeasonId: previous.season_id, previousLevel };
}

async function ensureSeasonTransitionColumns(sql) {
  await sql.query("alter table competition_season_clubs add column if not exists previous_standing_position integer");
  await sql.query("alter table competition_season_clubs add column if not exists previous_standing_points integer");
  await sql.query("alter table competition_season_clubs add column if not exists previous_standing_source text");
}

function normalizeStandingTeam(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|afc|sc|club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const MEMBERSHIP_TEAM_ALIASES = {
  "afc bournemouth": "bournemouth",
  "brighton hove albion": "brighton",
  "leeds united": "leeds",
  "manchester city": "man city",
  "manchester united": "man united",
  "newcastle united": "newcastle",
  "nottingham forest": "nott m forest",
  "sunderland": "sunderland",
  "tottenham hotspur": "tottenham",
  "west ham united": "west ham",
  "wolverhampton wanderers": "wolves",
  "ajax": "ajax",
  "az alkmaar": "az",
  "feyenoord rotterdam": "feyenoord",
  "fortuna sittard": "for sittard",
  "groningen": "groningen",
  "heracles almelo": "heracles",
  "nec": "nijmegen",
  "pec zwolle": "zwolle",
  "psv eindhoven": "psv",
  "sbv excelsior": "excelsior",
  "heerenveen": "heerenveen",
  "telstar 1963": "telstar",
  "twente 65": "twente",
  "utrecht": "utrecht",
  "volendam": "volendam",
};

function membershipTeamKey(value) {
  const normalized = normalizeStandingTeam(value);
  return MEMBERSHIP_TEAM_ALIASES[normalized] || normalized;
}

function dedupeSeasonClubs(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = membershipTeamKey(row.club_name);
    const current = byKey.get(key);
    const prefersFootballData = String(row.club_id || "").startsWith("football-data-") && !String(current?.club_id || "").startsWith("football-data-");
    if (!current || prefersFootballData) byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => String(a.club_name).localeCompare(String(b.club_name)));
}

function standingPositionValue(row, index) {
  return Number(row?.pos ?? row?.position ?? row?.rank ?? index + 1) || index + 1;
}

function standingPointsValue(row) {
  const value = Number(row?.pts ?? row?.points ?? row?.Ptn ?? row?.Pnt);
  return Number.isFinite(value) ? value : null;
}

async function readPreviousStandingByClub(sql, season) {
  const rows = await sql.query(
    `
      select ss.standings, ss.source, s.season_id, s.year_label, comp.level
      from standings_snapshots ss
      join seasons s on s.season_id = ss.season_id
      join competitions comp on comp.competition_id = ss.competition_id
      where s.year_label < $1
      order by s.year_label desc, ss.captured_at desc
      limit 80
    `,
    [season.year_label]
  );
  const byClub = new Map();
  const byName = new Map();
  for (const snapshot of rows) {
    const standings = Array.isArray(snapshot.standings) ? snapshot.standings : [];
    standings.forEach((item, index) => {
      const clubId = item?.clubId || item?.club_id || item?.teamId || null;
      const teamName = item?.team || item?.clubName || item?.name || null;
      const standing = {
        position: standingPositionValue(item, index),
        points: standingPointsValue(item),
        seasonId: snapshot.season_id,
        yearLabel: snapshot.year_label,
        level: snapshot.level,
        source: snapshot.source || "standings_snapshots",
      };
      if (clubId && !byClub.has(clubId)) byClub.set(clubId, standing);
      const nameKey = normalizeStandingTeam(teamName);
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, standing);
    });
  }
  return { byClub, byName };
}

function findPreviousStanding(club, previousStandings) {
  return previousStandings.byClub.get(club.club_id) || previousStandings.byName.get(normalizeStandingTeam(club.club_name)) || null;
}

function buildPreviousStandingIndex(snapshots) {
  const bySeasonYear = new Map();
  for (const snapshot of snapshots) {
    const standings = Array.isArray(snapshot.standings) ? snapshot.standings : [];
    const item = bySeasonYear.get(snapshot.year_label) || { byClub: new Map(), byName: new Map() };
    standings.forEach((row, index) => {
      const clubId = row?.clubId || row?.club_id || row?.teamId || null;
      const teamName = row?.team || row?.clubName || row?.name || null;
      const standing = {
        position: standingPositionValue(row, index),
        points: standingPointsValue(row),
        seasonId: snapshot.season_id,
        yearLabel: snapshot.year_label,
        level: snapshot.level,
        source: snapshot.source || "standings_snapshots",
      };
      if (clubId && !item.byClub.has(clubId)) item.byClub.set(clubId, standing);
      const nameKey = normalizeStandingTeam(teamName);
      if (nameKey && !item.byName.has(nameKey)) item.byName.set(nameKey, standing);
    });
    bySeasonYear.set(snapshot.year_label, item);
  }
  return bySeasonYear;
}

function previousStandingForSeason(season, previousStandingIndex) {
  const years = [...previousStandingIndex.keys()].filter((year) => String(year) < String(season.year_label)).sort().reverse();
  const merged = { byClub: new Map(), byName: new Map() };
  for (const year of years) {
    const item = previousStandingIndex.get(year);
    for (const [key, value] of item.byClub.entries()) {
      if (!merged.byClub.has(key)) merged.byClub.set(key, value);
    }
    for (const [key, value] of item.byName.entries()) {
      if (!merged.byName.has(key)) merged.byName.set(key, value);
    }
  }
  return merged;
}

async function rebuildSeasonMemberships(sql) {
  await ensureSeasonTransitionColumns(sql);
  const seasons = await sql.query(
    `
      select s.season_id, s.competition_id, s.year_label, c.level, c.name as competition_name
      from seasons s
      join competitions c on c.competition_id = s.competition_id
      order by c.country_name, c.level nulls last, c.name, s.year_label
    `
  );
  let memberships = 0;
  let zeroStandings = 0;
  const seasonSummaries = [];
  const allStandingSnapshots = await sql.query(
    `
      select ss.standings, ss.source, s.season_id, s.year_label, comp.level
      from standings_snapshots ss
      join seasons s on s.season_id = ss.season_id
      join competitions comp on comp.competition_id = ss.competition_id
      order by s.year_label desc, ss.captured_at desc
    `
  );
  const previousStandingIndex = buildPreviousStandingIndex(allStandingSnapshots);

  for (const season of seasons) {
    const rawClubs = await sql.query(
      `
        select club_id, club_name
        from (
          select home_club_id as club_id, home_team_name as club_name from matches where season_id = $1 and home_club_id is not null and identity_status = 'resolved'
          union
          select away_club_id as club_id, away_team_name as club_name from matches where season_id = $1 and away_club_id is not null and identity_status = 'resolved'
        ) clubs
        order by club_name
      `,
      [season.season_id]
    );
    const clubs = dedupeSeasonClubs(rawClubs);
    if (!clubs.length) continue;
    const previousStandings = previousStandingForSeason(season, previousStandingIndex);

    const previousRows = await sql.query(
      `
        select csc.club_id, csc.season_id, comp.level
        from competition_season_clubs csc
        join seasons s on s.season_id = csc.season_id
        join competitions comp on comp.competition_id = csc.competition_id
        where s.year_label < $1
        order by s.year_label desc
      `,
      [season.year_label]
    );
    const previousByClub = new Map();
    for (const previous of previousRows) {
      if (!previousByClub.has(previous.club_id)) previousByClub.set(previous.club_id, previous);
    }

    await sql.query("delete from competition_season_clubs where season_id = $1", [season.season_id]);
    const standings = [];
    for (const club of clubs) {
      const entry = inferEntryReason({ ...club, level: season.level }, previousByClub);
      const previousStanding = findPreviousStanding(club, previousStandings);
      await sql.query(
        `
          insert into competition_season_clubs (
            season_id, competition_id, club_id, club_name, status, entry_reason,
            previous_season_id, previous_level, previous_standing_position,
            previous_standing_points, previous_standing_source, current_level, source
          )
          values ($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,$11,'matches-and-standings-derived')
          on conflict (season_id, club_id) do update set
            competition_id = excluded.competition_id,
            club_name = excluded.club_name,
            status = excluded.status,
            entry_reason = excluded.entry_reason,
            previous_season_id = excluded.previous_season_id,
            previous_level = excluded.previous_level,
            previous_standing_position = excluded.previous_standing_position,
            previous_standing_points = excluded.previous_standing_points,
            previous_standing_source = excluded.previous_standing_source,
            current_level = excluded.current_level,
            source = excluded.source,
            updated_at = now()
        `,
        [
          season.season_id,
          season.competition_id,
          club.club_id,
          club.club_name,
          entry.reason,
          entry.previousSeasonId,
          entry.previousLevel,
          previousStanding?.position || null,
          previousStanding?.points || null,
          previousStanding?.source || null,
          season.level,
        ]
      );
      standings.push({
        clubId: club.club_id,
        team: club.club_name,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
        entryReason: entry.reason,
        previousStandingPosition: previousStanding?.position || null,
        previousStandingPoints: previousStanding?.points || null,
        previousStandingSource: previousStanding?.source || null,
      });
      memberships += 1;
    }

    const snapshotId = `zero_${digest(`${season.season_id}|${clubs.length}`)}`;
    await sql.query("delete from standings_snapshots where season_id = $1 and source = 'season-reset-zero' and standings_snapshot_id <> $2", [
      season.season_id,
      snapshotId,
    ]);
    await sql.query(
      `
        insert into standings_snapshots (standings_snapshot_id, competition_id, season_id, captured_at, source, standings)
        values ($1,$2,$3,now(),'season-reset-zero',$4::jsonb)
        on conflict (standings_snapshot_id) do update set
          captured_at = excluded.captured_at,
          standings = excluded.standings
      `,
      [snapshotId, season.competition_id, season.season_id, JSON.stringify(standings)]
    );
    zeroStandings += 1;
    seasonSummaries.push({
      seasonId: season.season_id,
      competition: season.competition_name,
      yearLabel: season.year_label,
      teams: clubs.length,
    });
  }
  return { seasons: seasonSummaries.length, memberships, zeroStandings, samples: seasonSummaries.slice(0, 12) };
}

async function rebuildH2HEdges(sql) {
  await sql.query("delete from h2h_edges");
  const rows = await sql.query(
    `
      select
        least(home_club_id, away_club_id) as club_a,
        greatest(home_club_id, away_club_id) as club_b,
        competition_id,
        jsonb_agg(
          jsonb_build_object(
            'matchId', m.match_id,
            'date', m.date_key,
            'homeClubId', m.home_club_id,
            'awayClubId', m.away_club_id,
            'homeTeam', m.home_team_name,
            'awayTeam', m.away_team_name,
            'homeGoals', mr.final_home_goals,
            'awayGoals', mr.final_away_goals,
            'outcome', mr.actual_outcome
          )
          order by m.date_key
        ) as results,
        count(*)::int as played,
        sum(case when mr.actual_outcome = 'H' then 1 else 0 end)::int as home_wins_raw,
        sum(case when mr.actual_outcome = 'D' then 1 else 0 end)::int as draws,
        sum(case when mr.actual_outcome = 'A' then 1 else 0 end)::int as away_wins_raw
      from matches m
      join match_results mr on mr.match_id = m.match_id
      where m.home_club_id is not null
        and m.away_club_id is not null
        and m.competition_id is not null
        and m.identity_status = 'resolved'
      group by least(home_club_id, away_club_id), greatest(home_club_id, away_club_id), competition_id
      having count(*) >= 1
    `
  );
  let edges = 0;
  for (const row of rows) {
    await sql.query(
      `
        insert into h2h_edges (
          h2h_edge_id, home_club_id, away_club_id, competition_id, played,
          home_wins, draws, away_wins, weighted_recent_balance, results
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
        on conflict (home_club_id, away_club_id, competition_id) do update set
          played = excluded.played,
          home_wins = excluded.home_wins,
          draws = excluded.draws,
          away_wins = excluded.away_wins,
          weighted_recent_balance = excluded.weighted_recent_balance,
          results = excluded.results,
          updated_at = now()
      `,
      [
        `h2h_${digest(`${row.club_a}|${row.club_b}|${row.competition_id}`)}`,
        row.club_a,
        row.club_b,
        row.competition_id,
        row.played,
        row.home_wins_raw,
        row.draws,
        row.away_wins_raw,
        Number(((Number(row.home_wins_raw || 0) - Number(row.away_wins_raw || 0)) / Math.max(Number(row.played || 1), 1)).toFixed(3)),
        JSON.stringify(row.results || []),
      ]
    );
    edges += 1;
  }
  return { edges };
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  if (!sql) {
    console.error("DATABASE_URL of POSTGRES_URL ontbreekt.");
    process.exit(2);
  }
  const result = {
    generatedAt: new Date().toISOString(),
    seasonMemberships: await rebuildSeasonMemberships(sql),
    h2h: await rebuildH2HEdges(sql),
  };
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
