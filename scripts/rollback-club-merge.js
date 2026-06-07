#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const auditId = process.env.CLUB_MERGE_AUDIT_ID;
if (!auditId) {
  console.error("CLUB_MERGE_AUDIT_ID is verplicht voor een clubmerge-rollback.");
  process.exit(2);
}
const [audit] = await sql.query("select * from club_merge_audit where club_merge_audit_id=$1 and rollback_status='not_rolled_back'", [auditId]);
if (!audit) process.exit(2);
for (const club of audit.merged_club_snapshots || []) {
  await sql.query(`insert into clubs(club_id,name,country_id,country_name,stadium,venue_id,provider_ids,history,created_at,updated_at)
    values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,coalesce($9::timestamptz,now()),now()) on conflict(club_id) do nothing`,
    [club.club_id,club.name,club.country_id,club.country_name,club.stadium,club.venue_id,JSON.stringify(club.provider_ids||{}),JSON.stringify(club.history||{}),club.created_at]);
}
const refs = audit.reference_snapshot || {};
for (const row of refs.homeMatches || []) await sql.query("update matches set home_club_id=$2 where match_id=$1", [row.match_id,row.club_id]);
for (const row of refs.awayMatches || []) await sql.query("update matches set away_club_id=$2 where match_id=$1", [row.match_id,row.club_id]);
for (const row of refs.teamMatchStats || []) await sql.query("update team_match_stats set club_id=$2 where team_match_stats_id=$1", [row.team_match_stats_id,row.club_id]);
for (const row of refs.teamSeasonStats || []) await sql.query("update team_season_stats set club_id=$2 where team_season_stats_id=$1", [row.team_season_stats_id,row.club_id]);
for (const row of refs.players || []) await sql.query("update players set club_id=$2 where player_id=$1", [row.player_id,row.club_id]);
for (const row of refs.squads || []) await sql.query("update squads set club_id=$2 where squad_id=$1", [row.squad_id,row.club_id]);
for (const row of refs.injuries || []) await sql.query("update injuries set club_id=$2 where injury_id=$1", [row.injury_id,row.club_id]);
for (const row of refs.suspensions || []) await sql.query("update suspensions set club_id=$2 where suspension_id=$1", [row.suspension_id,row.club_id]);
for (const row of refs.aliases || []) await sql.query("insert into club_aliases(club_id,alias,normalized_alias,source) values($1,$2,$3,$4) on conflict(club_id,normalized_alias) do nothing", [row.club_id,row.alias,row.normalized_alias,row.source]);
for (const row of refs.competitionSeasonClubs || []) await sql.query(`insert into competition_season_clubs(season_id,competition_id,club_id,club_name,status,entry_reason,previous_season_id,previous_level,previous_standing_position,previous_standing_points,previous_standing_source,current_level,source,source_record_id)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict(season_id,club_id) do nothing`,
  [row.season_id,row.competition_id,row.club_id,row.club_name,row.status,row.entry_reason,row.previous_season_id,row.previous_level,row.previous_standing_position,row.previous_standing_points,row.previous_standing_source,row.current_level,row.source,row.source_record_id]);
await sql.query("update club_merge_audit set rollback_status='rolled_back',rollback_reason='explicit_audit_rollback',rolled_back_at=now(),merge_status='rolled_back' where club_merge_audit_id=$1", [auditId]);
console.log(JSON.stringify({ rolledBack: Number(auditId), restoredClubs: (audit.merged_club_snapshots || []).length }, null, 2));
