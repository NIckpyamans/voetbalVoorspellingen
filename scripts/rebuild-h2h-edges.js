#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const startedAt = Date.now();
const [result] = await sql.query(`
  with aggregated as (
    select least(home_club_id,away_club_id) club_a,greatest(home_club_id,away_club_id) club_b,m.competition_id,
      jsonb_agg(jsonb_build_object('matchId',m.match_id,'date',m.date_key,'homeClubId',m.home_club_id,'awayClubId',m.away_club_id,
        'homeTeam',m.home_team_name,'awayTeam',m.away_team_name,'homeGoals',mr.final_home_goals,'awayGoals',mr.final_away_goals,'outcome',mr.actual_outcome)
        order by m.date_key) results,
      count(1)::int played,sum((mr.actual_outcome='H')::int)::int home_wins,sum((mr.actual_outcome='D')::int)::int draws,
      sum((mr.actual_outcome='A')::int)::int away_wins
    from matches m join match_results mr on mr.match_id=m.match_id
    where m.identity_status='resolved' and m.home_club_id is not null and m.away_club_id is not null and m.competition_id is not null
    group by least(home_club_id,away_club_id),greatest(home_club_id,away_club_id),m.competition_id
  ), upserted as (
    insert into h2h_edges(h2h_edge_id,home_club_id,away_club_id,competition_id,played,home_wins,draws,away_wins,weighted_recent_balance,results)
    select 'h2h_'||substr(md5(club_a||'|'||club_b||'|'||competition_id),1,20),club_a,club_b,competition_id,played,home_wins,draws,away_wins,
      round((home_wins-away_wins)::numeric/greatest(played,1),3),results from aggregated
    on conflict(home_club_id,away_club_id,competition_id) do update set played=excluded.played,home_wins=excluded.home_wins,
      draws=excluded.draws,away_wins=excluded.away_wins,weighted_recent_balance=excluded.weighted_recent_balance,results=excluded.results,updated_at=now()
    returning 1
  ), removed as (
    delete from h2h_edges h where not exists(select 1 from aggregated a where a.club_a=h.home_club_id and a.club_b=h.away_club_id and a.competition_id=h.competition_id)
    returning 1
  )
  select (select count(1)::int from upserted) edges,(select count(1)::int from removed) removed
`);
console.log(JSON.stringify({ ...result, durationMs: Date.now() - startedAt }, null, 2));
