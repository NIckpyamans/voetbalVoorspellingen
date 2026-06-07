#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);

const trustDropThreshold = Number(process.env.TRUST_DROP_ALERT_THRESHOLD || 0.1);
const hitRateDropThreshold = Number(process.env.MODEL_HIT_RATE_DROP_ALERT_THRESHOLD || 0.1);
const brierIncreaseThreshold = Number(process.env.MODEL_BRIER_INCREASE_ALERT_THRESHOLD || 0.05);
const minimumModelSample = Number(process.env.MODEL_QUALITY_MINIMUM_SAMPLE || 20);
const alerts = [];

const trustChanges = await sql.query(`
  with ranked as (
    select provider,effective_trust_score,captured_at,row_number() over(partition by provider order by captured_at desc) rank
    from provider_trust_history
  )
  select current.provider,current.effective_trust_score current_value,previous.effective_trust_score previous_value
  from ranked current join ranked previous on previous.provider=current.provider and previous.rank=2
  where current.rank=1 and previous.effective_trust_score-current.effective_trust_score >= $1
`, [trustDropThreshold]);
for (const row of trustChanges) alerts.push({
  type: "provider_trust_drop", dimension: row.provider, severity: "high",
  current: Number(row.current_value), previous: Number(row.previous_value), threshold: trustDropThreshold,
  message: `Providertrust van ${row.provider} daalde sterk.`,
});

const modelChanges = await sql.query(`
  with counts as (
    select dimension_key,max(metric_value) filter(where metric_key='model_evaluation_count') sample_size
    from integrity_metric_snapshots where dimension_key<>'global' group by dimension_key
  ), ranked as (
    select dimension_key,metric_key,metric_value,captured_at,row_number() over(partition by dimension_key,metric_key order by captured_at desc) rank
    from integrity_metric_snapshots where metric_key in ('model_outcome_hit_rate','model_average_brier')
  )
  select current.dimension_key,current.metric_key,current.metric_value current_value,previous.metric_value previous_value,c.sample_size
  from ranked current join ranked previous on previous.dimension_key=current.dimension_key and previous.metric_key=current.metric_key and previous.rank=2
  join counts c on c.dimension_key=current.dimension_key
  where current.rank=1 and c.sample_size >= $1
`, [minimumModelSample]);
for (const row of modelChanges) {
  const current = Number(row.current_value);
  const previous = Number(row.previous_value);
  const isHitDrop = row.metric_key === "model_outcome_hit_rate" && previous - current >= hitRateDropThreshold;
  const isBrierIncrease = row.metric_key === "model_average_brier" && current - previous >= brierIncreaseThreshold;
  if (!isHitDrop && !isBrierIncrease) continue;
  alerts.push({
    type: isHitDrop ? "model_hit_rate_drop" : "model_brier_increase", dimension: row.dimension_key, severity: "high",
    current, previous, threshold: isHitDrop ? hitRateDropThreshold : brierIncreaseThreshold,
    message: `Modelkwaliteit verslechterde voor ${row.dimension_key}.`,
  });
}
for (const alert of alerts) {
  const alertId = `quality_${Buffer.from(`${alert.type}|${alert.dimension}`).toString("hex").slice(0, 48)}`;
  await sql.query(`insert into quality_alerts(alert_id,alert_type,dimension_key,severity,status,current_value,previous_value,delta,threshold,message,evidence)
    values($1,$2,$3,$4,'open',$5,$6,$7,$8,$9,$10::jsonb)
    on conflict(alert_id) do update set severity=excluded.severity,status='open',current_value=excluded.current_value,previous_value=excluded.previous_value,
      delta=excluded.delta,threshold=excluded.threshold,message=excluded.message,evidence=excluded.evidence,resolved_at=null,updated_at=now()`,
    [alertId, alert.type, alert.dimension, alert.severity, alert.current, alert.previous, alert.current-alert.previous, alert.threshold, alert.message,
      JSON.stringify({ detector: "quality-degradation-v1", minimumModelSample })]);
}
const activeDimensions = alerts.map((alert) => `${alert.type}|${alert.dimension}`);
await sql.query(`update quality_alerts set status='resolved',resolved_at=now(),updated_at=now()
  where status='open' and not ((alert_type||'|'||dimension_key)=any($1::text[]))`, [activeDimensions]);
fs.mkdirSync(path.join(process.cwd(), "monitor"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "monitor", "quality-alerts.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), alerts }, null, 2)}\n`);
console.log(JSON.stringify({ alerts: alerts.length, trustDrops: trustChanges.length, modelComparisons: modelChanges.length, minimumModelSample }, null, 2));
