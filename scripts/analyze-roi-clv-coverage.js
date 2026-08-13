#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { buildRoiClvGate } from "./worker/roi-clv-gate.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const minimumSample = Math.max(100, Number(process.env.ROI_CLV_MINIMUM_SAMPLE || 100));
const output = path.join(process.cwd(), "monitor", "roi-clv-coverage.json");
const [report] = await sql.query(`
  with timestamped_odds as (
    select match_id,captured_at,closing_captured_at,available_before_kickoff from historical_odds_snapshots
    union all
    select ps.match_id,os.captured_at,os.closing_captured_at,os.available_before_kickoff
    from odds_snapshots os join prediction_snapshots ps on ps.prediction_id=os.prediction_id
  )
  select count(distinct match_id)::int evaluation_matches,
    count(distinct match_id) filter(where roi is not null)::int roi_evaluation_matches,
    count(distinct match_id) filter(where clv is not null)::int clv_evaluation_matches,
    round(coalesce(avg(roi) filter(where roi is not null),0),4) avg_roi,
    round(coalesce(avg(clv) filter(where clv is not null),0),4) avg_clv,
    (
      select count(distinct match_id)::int from timestamped_odds
      where available_before_kickoff=true and captured_at is not null
    ) safe_prematch_matches,
    (
      select count(distinct match_id)::int from timestamped_odds
      where available_before_kickoff=true
        and captured_at is not null
        and closing_captured_at is not null
        and closing_captured_at > captured_at
    ) closing_pair_matches
  from prediction_evaluations
`);
const gate = buildRoiClvGate(report, minimumSample);
const gatedReport = {
  ...report,
  ...gate,
  generated_at: new Date().toISOString(),
  publishable_avg_roi: gate.roi_ready ? report.avg_roi : null,
  publishable_avg_clv: gate.clv_ready ? report.avg_clv : null,
};
for (const [key, value] of Object.entries(gatedReport)) {
  if (value !== null && (typeof value === "number" || typeof value === "boolean" || !Number.isNaN(Number(value)))) {
    await sql.query("insert into integrity_metric_snapshots(metric_key,metric_value,metadata) values($1,$2,$3::jsonb)",
      [`roi_clv_${key}`, Number(value), JSON.stringify({ source: "roi-clv-coverage-v1" })]);
  }
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(gatedReport, null, 2)}\n`);
console.log(JSON.stringify(gatedReport, null, 2));
