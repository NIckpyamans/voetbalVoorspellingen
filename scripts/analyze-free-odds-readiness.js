#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  console.error("DATABASE_URL of POSTGRES_URL ontbreekt.");
  process.exit(2);
}

const catalog = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config", "free-odds-sources.json"), "utf8"));
const [coverage] = await sql.query(`
  select
    count(*)::int as snapshots,
    count(distinct match_id)::int as matches,
    count(distinct bookmaker)::int as bookmakers,
    count(*) filter (where home > 1 and draw > 1 and away > 1)::int as complete_1x2,
    count(*) filter (
      where closing_home > 1 and closing_draw > 1 and closing_away > 1
    )::int as closing_proxy_rows,
    count(*) filter (
      where captured_at is not null and closing_captured_at is not null and closing_captured_at > captured_at
    )::int as timestamped_clv_pairs
  from historical_odds_snapshots
`);
const providers = await sql.query(`
  select provider, bookmaker, count(*)::int as rows, count(distinct match_id)::int as matches
  from historical_odds_snapshots
  group by provider, bookmaker
  order by rows desc
`);

const timestampedClvPairs = Number(coverage?.timestamped_clv_pairs || 0);
const report = {
  generatedAt: new Date().toISOString(),
  policy: catalog.policy,
  sources: catalog.sources,
  database: coverage,
  providers,
  readiness: {
    historicalRoiBacktest: Number(coverage?.complete_1x2 || 0) > 0 ? "ready" : "missing_historical_odds",
    historicalCalibration: Number(coverage?.closing_proxy_rows || 0) > 0 ? "ready_with_closing_proxy" : "missing_closing_proxy",
    liveRoi: "blocked_without_timestamped_prematch_odds",
    liveClv: timestampedClvPairs > 0 ? "ready" : "blocked_without_separate_closing_timestamp",
  },
};
fs.mkdirSync(path.join(process.cwd(), "monitor"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "monitor", "free-odds-readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
