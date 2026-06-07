#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const minimumSample = Math.max(100, Number(process.env.ROI_CLV_MINIMUM_SAMPLE || 100));
const [report] = await sql.query(`
  select count(1)::int evaluations,
    count(1) filter(where roi is not null)::int roi_evaluations,
    count(1) filter(where clv is not null)::int clv_evaluations,
    round(coalesce(avg(roi) filter(where roi is not null),0),4) avg_roi,
    round(coalesce(avg(clv) filter(where clv is not null),0),4) avg_clv,
    (select count(1)::int from historical_odds_snapshots where available_before_kickoff=true) safe_prematch_odds,
    (select count(1)::int from historical_odds_snapshots where closing_captured_at is not null) closing_pairs
  from prediction_evaluations
`);
const roiReady = Number(report.safe_prematch_odds || 0) >= minimumSample && Number(report.roi_evaluations || 0) >= minimumSample;
const clvReady = Number(report.closing_pairs || 0) >= minimumSample && Number(report.clv_evaluations || 0) >= minimumSample;
const gatedReport = {
  ...report,
  minimum_sample: minimumSample,
  roi_ready: roiReady,
  clv_ready: clvReady,
  analysis_status: roiReady && clvReady ? "ready" : "waiting_for_minimum_sample",
  publishable_avg_roi: roiReady ? report.avg_roi : null,
  publishable_avg_clv: clvReady ? report.avg_clv : null,
};
for (const [key, value] of Object.entries(gatedReport)) {
  if (value !== null && (typeof value === "number" || typeof value === "boolean" || !Number.isNaN(Number(value)))) {
    await sql.query("insert into integrity_metric_snapshots(metric_key,metric_value,metadata) values($1,$2,$3::jsonb)",
      [`roi_clv_${key}`, Number(value), JSON.stringify({ source: "roi-clv-coverage-v1" })]);
  }
}
console.log(JSON.stringify(gatedReport, null, 2));
