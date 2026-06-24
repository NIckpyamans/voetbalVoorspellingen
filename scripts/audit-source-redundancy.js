#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

const [coverage] = await sql.query(`
  with scoped as (
    select match_id from matches
    where date_key::date between current_date - 90 and current_date + 180
  ), expanded as (
    select msr.match_id, trim(provider_part) as provider
    from match_source_records msr
    cross join lateral unnest(string_to_array(msr.provider, '+')) provider_part
  ), counts as (
    select s.match_id, count(distinct e.provider)::int as providers
    from scoped s left join expanded e on e.match_id = s.match_id
    group by s.match_id
  )
  select count(*)::int as matches,
    count(*) filter (where providers >= 1)::int as with_primary_source,
    count(*) filter (where providers >= 2)::int as with_backup_source,
    round(avg(providers), 2) as average_providers,
    max(providers)::int as maximum_providers
  from counts
`);

const providers = await sql.query(`
  select trim(provider_part) as provider, count(distinct match_id)::int as matches,
    count(*) filter (where is_primary)::int as primary_links,
    round(avg(coalesce(trust_score, 0.5)), 3) as average_trust
  from match_source_records
  cross join lateral unnest(string_to_array(provider, '+')) provider_part
  group by trim(provider_part)
  order by matches desc, provider
`);

const fields = await sql.query(`
  select field_name,
    count(distinct prediction_id)::int as predictions,
    count(distinct source)::int as independent_sources,
    round(count(*) filter (where available)::numeric / greatest(count(*), 1), 3) as availability,
    round(count(*) filter (where source_timestamp_known)::numeric / greatest(count(*), 1), 3) as timestamp_coverage
  from source_audit
  group by field_name
  order by field_name
`);

const sourceFamilies = {
  fixtures: ["Sofascore", "ESPN", "TheSportsDB", "OpenLigaDB", "football-data.org"],
  h2h: ["API-Football", "openfootball", "canonical match history"],
  statistics: ["StatsBomb", "Understat", "FBref", "football-data.co.uk"],
  odds: ["The Odds API", "football-data.co.uk"],
  squadsAndAvailability: ["Sofascore", "football-data.org", "Forza Football"],
};
const matches = Number(coverage?.matches || 0);
const backupCoverage = matches ? Number(coverage?.with_backup_source || 0) / matches : null;
const report = {
  generatedAt: new Date().toISOString(),
  scope: "matches from 90 days ago through 180 days ahead",
  status: backupCoverage == null ? "no_matches" : backupCoverage >= 0.8 ? "healthy" : backupCoverage >= 0.5 ? "warning" : "needs_attention",
  coverage: {
    ...coverage,
    primarySourceCoverage: matches ? Number((Number(coverage.with_primary_source || 0) / matches).toFixed(3)) : null,
    backupSourceCoverage: backupCoverage == null ? null : Number(backupCoverage.toFixed(3)),
  },
  providers,
  predictionFields: fields,
  configuredSourceFamilies: sourceFamilies,
  interpretation: "Meerdere bronnen worden als aanvulling en controle gebruikt; conflicten worden via providertrust opgelost. Geen willekeurige bron overschrijft automatisch de primaire waarheid.",
};

console.log(JSON.stringify(report, null, 2));
