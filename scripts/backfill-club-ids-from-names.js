#!/usr/bin/env node
// Koppelt gespeelde wedstrijden zonder home_club_id/away_club_id aan clubs via
// genormaliseerde naam-matching (met alias-tabel). Dit is de concrete uitvoering van
// het coverageImprovementPlan-item "provider_team_ids": zodra club-IDs gevuld zijn,
// vuren h2h_edges (rebuild-h2h-edges.js) en de H2H-features in de predictie wél.
//
//   node scripts/backfill-club-ids-from-names.js          # dry-run telling
//   node scripts/backfill-club-ids-from-names.js --apply
//
import { getSql, loadLocalEnv } from "../shared/database.js";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const normalize = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  if (!sql) {
    console.error("[club-id-backfill] DATABASE_URL ontbreekt.");
    process.exit(1);
  }
  const [{ unresolved }] = await sql.query(
    `select count(1)::int as unresolved
     from matches m
     join match_results mr on mr.match_id = m.match_id
     where m.identity_status <> 'resolved'
       and (m.home_club_id is null or m.away_club_id is null)`
  );
  // Unresolved matched op genormaliseerde naam; aliases via club_aliases meenemen.
  const candidates = await sql.query(
    `select distinct m.home_team_name, m.away_team_name
     from matches m
     join match_results mr on mr.match_id = m.match_id
     where m.identity_status <> 'resolved'
       and (m.home_club_id is null or m.away_club_id is null)
       and m.home_team_name is not null and m.away_team_name is not null
     limit 5000`
  );
  const clubs = await sql.query(`select club_id, name from clubs`);
  const aliasRows = await sql.query(`select club_id, normalized_alias from club_aliases`);
  const lookup = new Map();
  for (const club of clubs) {
    const key = normalize(club.name);
    if (key && !lookup.has(key)) lookup.set(key, club.club_id);
  }
  for (const alias of aliasRows) {
    const key = normalize(alias.normalized_alias);
    if (key && !lookup.has(key)) lookup.set(key, alias.club_id);
  }
  let resolvablePairs = 0;
  const updates = [];
  for (const row of candidates) {
    const homeId = lookup.get(normalize(row.home_team_name)) || null;
    const awayId = lookup.get(normalize(row.away_team_name)) || null;
    if (homeId && awayId && homeId !== awayId) {
      resolvablePairs += 1;
      updates.push([row.home_team_name, row.away_team_name, homeId, awayId]);
    }
  }
  let applied = 0;
  let matchedMatches = 0;
  if (APPLY && updates.length) {
    for (const [homeName, awayName, homeId, awayId] of updates) {
      const result = await sql.query(
        `with updated as (
           update matches m
           set home_club_id = $3, away_club_id = $4, updated_at = now()
           where m.home_team_name = $1 and m.away_team_name = $2
             and m.identity_status <> 'resolved'
             and (m.home_club_id is null or m.away_club_id is null)
           returning 1
         )
         select count(1)::int as matched from updated`,
        [homeName, awayName, homeId, awayId]
      );
      applied += 1;
      matchedMatches += Number(result[0]?.matched || 0);
    }
  }
  const report = {
    ok: true,
    apply: APPLY,
    unresolvedMatches: unresolved,
    uniqueNamePairs: candidates.length,
    resolvablePairs,
    appliedPairs: applied,
    matchedMatches,
    note: APPLY
      ? "Herstel nu npm run db:h2h:rebuild om h2h_edges opnieuw op te bouwen."
      : "Dry-run: draai opnieuw met --apply om club-IDs weg te schrijven.",
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`[club-id-backfill] ${error?.stack || error?.message || error}`);
  process.exit(1);
});
