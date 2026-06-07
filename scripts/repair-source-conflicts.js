#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);

const minimumTrust = Number(process.env.SOURCE_CONFLICT_REPAIR_MIN_TRUST || 0.8);
const minimumTrustMargin = Number(process.env.SOURCE_CONFLICT_REPAIR_MIN_MARGIN || 0.02);
const conflicts = await sql.query(`
  select sc.*,msr.trust_score
  from source_conflicts sc
  join match_source_records msr on msr.source_record_id=sc.selected_source_record_id and msr.match_id=sc.entity_key
  where sc.entity_type='match' and sc.status='pending' and sc.field_name in ('kickoff','score','status')
  order by sc.detected_at
`);
let repaired = 0;
let skipped = 0;
for (const conflict of conflicts) {
  const value = typeof conflict.selected_value === "string" ? conflict.selected_value : String(conflict.selected_value ?? "");
  const trust = Number(conflict.trust_score || 0);
  const candidates = Array.isArray(conflict.candidate_values) ? conflict.candidate_values : [];
  const runnerUpTrust = Number(candidates[1]?.trustScore || 0);
  const trustMargin = trust - runnerUpTrust;
  let previous = null;
  let applied = false;
  let reason = trust < minimumTrust ? "provider_trust_below_threshold" : trustMargin < minimumTrustMargin ? "provider_trust_margin_too_small" : "invalid_or_unchanged_value";
  if (trust >= minimumTrust && trustMargin >= minimumTrustMargin && conflict.field_name === "kickoff" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))) {
    [previous] = await sql.query("select to_jsonb(kickoff_at::text) value from matches where match_id=$1", [conflict.entity_key]);
    const changed = await sql.query("update matches set kickoff_at=$2::timestamptz,date_key=to_char($2::timestamptz,'YYYY-MM-DD'),updated_at=now() where match_id=$1 and kickoff_at is distinct from $2::timestamptz returning 1", [conflict.entity_key, value]);
    applied = changed.length > 0;
  } else if (trust >= minimumTrust && trustMargin >= minimumTrustMargin && conflict.field_name === "score" && /^\d{1,2}-\d{1,2}$/.test(value)) {
    [previous] = await sql.query("select to_jsonb(final_home_goals::text||'-'||final_away_goals::text) value from match_results where match_id=$1", [conflict.entity_key]);
    const [home, away] = value.split("-").map(Number);
    const changed = await sql.query(`update match_results set final_home_goals=$2,final_away_goals=$3,
      actual_outcome=case when $2>$3 then 'H' when $2=$3 then 'D' else 'A' end,result_source='automatic_trusted_conflict_repair',settled_at=now()
      where match_id=$1 and (final_home_goals is distinct from $2 or final_away_goals is distinct from $3) returning 1`, [conflict.entity_key, home, away]);
    applied = changed.length > 0;
  } else if (trust >= minimumTrust && trustMargin >= minimumTrustMargin && conflict.field_name === "status" && ["FT", "AET", "PEN", "POSTPONED", "CANCELLED", "CANCELED", "SCHEDULED", "LIVE"].includes(value.toUpperCase())) {
    const normalizedStatus = value.toUpperCase() === "CANCELED" ? "CANCELLED" : value.toUpperCase();
    [previous] = await sql.query("select to_jsonb(coalesce(status_normalized,status,'')) value from matches where match_id=$1", [conflict.entity_key]);
    const changed = await sql.query("update matches set status_normalized=$2,updated_at=now() where match_id=$1 and status_normalized is distinct from $2 returning 1", [conflict.entity_key, normalizedStatus]);
    applied = changed.length > 0;
  }
  if (applied) reason = "trusted_source_value_applied";
  await sql.query(`insert into source_conflict_repairs(source_conflict_id,entity_key,field_name,previous_value,applied_value,source_record_id,source_trust_score,repair_status,repair_reason)
    values($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9)`, [
    conflict.source_conflict_id, conflict.entity_key, conflict.field_name, JSON.stringify(previous?.value ?? null),
    JSON.stringify(value), conflict.selected_source_record_id, trust, applied ? "applied" : "skipped", reason,
  ]);
  await sql.query("update source_conflicts set status=$2,resolved_at=case when $2='resolved' then now() else null end,updated_at=now() where source_conflict_id=$1",
    [conflict.source_conflict_id, applied || reason === "invalid_or_unchanged_value" ? "resolved" : "review_required"]);
  if (applied) repaired += 1;
  else skipped += 1;
}
console.log(JSON.stringify({ candidates: conflicts.length, repaired, skipped, minimumTrust, minimumTrustMargin }, null, 2));
