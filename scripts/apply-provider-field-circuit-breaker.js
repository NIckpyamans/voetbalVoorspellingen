#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const minimumScore = Number(process.env.PROVIDER_FIELD_MINIMUM_TRUST || 0.3);
const minimumSamples = Number(process.env.PROVIDER_FIELD_MINIMUM_SAMPLES || 30);
const consecutiveRuns = Number(process.env.PROVIDER_FIELD_DISABLE_AFTER_RUNS || 3);
await sql.query(`
  insert into provider_field_controls(provider,field_name,status,reason,consecutive_low_scores,disabled_at,updated_at)
  select provider,field_name,
    case when effective_trust_score<$1 and samples>=$2 and 1>= $3 then 'disabled' else 'active' end,
    case when effective_trust_score<$1 and samples>=$2 then 'field_trust_below_threshold' else null end,
    case when effective_trust_score<$1 and samples>=$2 then 1 else 0 end,
    case when effective_trust_score<$1 and samples>=$2 and 1>= $3 then now() else null end,now()
  from provider_field_trust_profiles
  on conflict(provider,field_name) do update set
    consecutive_low_scores=case when excluded.reason is not null then provider_field_controls.consecutive_low_scores+1 else 0 end,
    status=case when excluded.reason is not null and provider_field_controls.consecutive_low_scores+1 >= $3 then 'disabled' else 'active' end,
    reason=excluded.reason,
    disabled_at=case when excluded.reason is not null and provider_field_controls.consecutive_low_scores+1 >= $3 then coalesce(provider_field_controls.disabled_at,now()) else null end,
    updated_at=now()
`, [minimumScore, minimumSamples, consecutiveRuns]);
const summary = await sql.query("select status,count(1)::int rows from provider_field_controls group by status order by status");
console.log(JSON.stringify({ minimumScore, minimumSamples, consecutiveRuns, summary }, null, 2));
