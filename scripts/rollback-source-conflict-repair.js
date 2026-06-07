#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const repairId = process.env.SOURCE_CONFLICT_REPAIR_ID;
if (!repairId) {
  console.error("SOURCE_CONFLICT_REPAIR_ID is verplicht voor een rollback.");
  process.exit(2);
}
const [repair] = await sql.query(`select * from source_conflict_repairs
  where source_conflict_repair_id=$1 and repair_status='applied' and rollback_status='not_rolled_back'`, [repairId]);
if (!repair) {
  console.error("Geen rollbackbare repair gevonden.");
  process.exit(2);
}
const value = typeof repair.previous_value === "string" ? repair.previous_value : String(repair.previous_value ?? "");
if (repair.field_name === "kickoff") {
  await sql.query("update matches set kickoff_at=$2::timestamptz,date_key=to_char($2::timestamptz,'YYYY-MM-DD'),updated_at=now() where match_id=$1", [repair.entity_key, value]);
} else if (repair.field_name === "score") {
  const [home, away] = value.split("-").map(Number);
  await sql.query(`update match_results set final_home_goals=$2,final_away_goals=$3,
    actual_outcome=case when $2>$3 then 'H' when $2=$3 then 'D' else 'A' end,result_source='repair_rollback',settled_at=now() where match_id=$1`, [repair.entity_key, home, away]);
} else if (repair.field_name === "status") {
  await sql.query("update matches set status_normalized=$2,updated_at=now() where match_id=$1", [repair.entity_key, value]);
} else {
  console.error(`Rollback voor ${repair.field_name} wordt niet ondersteund.`);
  process.exit(2);
}
await sql.query(`update source_conflict_repairs set rollback_status='rolled_back',rollback_reason='manual_verified_rollback',rolled_back_at=now()
  where source_conflict_repair_id=$1`, [repairId]);
await sql.query("update source_conflicts set status='review_required',resolved_at=null,updated_at=now() where source_conflict_id=$1", [repair.source_conflict_id]);
console.log(JSON.stringify({ rolledBack: Number(repairId), field: repair.field_name, entityKey: repair.entity_key }, null, 2));
