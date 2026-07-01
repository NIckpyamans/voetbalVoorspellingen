#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { isHiddenInternationalOrWorldCupEntity } from "../shared/competitionVisibility.js";

const ROOT = process.cwd();
loadLocalEnv(ROOT);

function readJsonSafe(relativePath, fallback) {
  try {
    const filePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

const training = readJsonSafe(path.join("training", "catboost-ready.json"), {});
const target = Number(training?.trainingPolicy?.nextTargetRows || process.env.SNAPSHOT_NEXT_TARGET_ROWS || 150);
const snapshotBackedRows = Number(training?.snapshotBackedRows || 0);
const totalRows = Number(training?.totalRows || 0);
const gap = Math.max(0, target - snapshotBackedRows);
const sql = getSql();

let database = { configured: false };
if (sql) {
  const [counts] = await sql.query(`
    select
      (select count(1)::int from prediction_snapshots) prediction_snapshots,
      (select count(1)::int from prediction_snapshots ps join matches m on m.match_id=ps.match_id where ps.generated_at < m.kickoff_at) prematch_snapshots,
      (select count(1)::int from prediction_evaluations where evaluation_source='scheduled-database-evaluator') scheduled_evaluations,
      (select count(1)::int from prediction_evaluations pe join prediction_snapshots ps on ps.prediction_id=pe.prediction_id) snapshot_evaluations,
      (select count(1)::int from matches where kickoff_at > now()) future_matches,
      (select count(1)::int from matches where kickoff_at > now() and kickoff_at <= now() + interval '14 days') future_matches_14d
  `);
  const snapshotEvaluationsByLeague = await sql.query(`
    select coalesce(m.league, 'unknown') league, count(1)::int rows
    from prediction_snapshots ps
    join prediction_evaluations pe on pe.prediction_id = ps.prediction_id
    join matches m on m.match_id = ps.match_id
    join match_results mr on mr.match_id = ps.match_id
    where ps.generated_at <= coalesce(m.kickoff_at, ps.generated_at)
      and mr.actual_outcome in ('H','D','A')
    group by coalesce(m.league, 'unknown')
    order by rows desc
  `);
  const futureMatchesByLeague = await sql.query(`
    select coalesce(league, 'unknown') league, count(1)::int rows
    from matches
    where kickoff_at > now()
    group by coalesce(league, 'unknown')
    order by rows desc
  `);
  const clubSnapshotEvaluations = snapshotEvaluationsByLeague
    .filter((row) => !isHiddenInternationalOrWorldCupEntity({ league: row.league }))
    .reduce((sum, row) => sum + Number(row.rows || 0), 0);
  const futureClubMatches = futureMatchesByLeague
    .filter((row) => !isHiddenInternationalOrWorldCupEntity({ league: row.league }))
    .reduce((sum, row) => sum + Number(row.rows || 0), 0);
  database = {
    configured: true,
    ...counts,
    club_snapshot_evaluations: clubSnapshotEvaluations,
    future_club_matches: futureClubMatches,
    snapshot_evaluations_by_league: snapshotEvaluationsByLeague.slice(0, 12),
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  training: {
    totalRows,
    snapshotBackedRows,
    fallbackRows: Number(training?.fallbackRows || 0),
    target,
    gap,
    maturity: training?.trainingPolicy?.maturity || "unknown",
  },
  database,
  automation: {
    workerCadence: "3x per dag volledige worker + 2-uurlijkse live score refresh",
    learningCadence: "dagelijks train:prepare",
    recommendedNext:
      gap > 0
        ? "Laat worker en learning doorlopen; verhoog snapshot-backed rows door meer toekomstige clubwedstrijden en pre-match snapshots vast te leggen."
        : "Snapshot target gehaald; start league/phase recalibration op club-only dataset.",
  },
  nextFocus:
    gap > 0
      ? ["meer clubfixtures in venster", "worker snapshot cadence bewaken", "prediction evaluation dagelijks blijven draaien"]
      : ["league/phase recalibration", "exact-score calibration later"],
};

fs.mkdirSync(path.join(ROOT, "monitor"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "monitor", "snapshot-growth-monitor.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
