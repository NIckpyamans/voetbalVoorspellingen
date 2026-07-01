#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { isHiddenInternationalOrWorldCupEntity } from "../shared/competitionVisibility.js";

const ROOT = process.cwd();
const OUTPUT_JSON = path.join(ROOT, "data", "phase-reliability.json");
const MONITOR_JSON = path.join(ROOT, "monitor", "phase-reliability-rebuild.json");
const MIN_PHASE_ROWS = Math.max(1, Number(process.env.PHASE_RELIABILITY_MIN_ROWS || 5));

function phaseFromRow(row) {
  const explicit = String(row.phase_bucket || "").trim();
  if (explicit) return explicit;
  const league = String(row.league || "").toLowerCase();
  if (league.includes("friendly") || league.includes("oefen")) return "friendly";
  if (league.includes("champions league") || league.includes("europa league") || league.includes("conference league")) {
    return "qualification";
  }
  if (league.includes("cup") || league.includes("beker")) return "cup";
  return "league";
}

function expectedGoals(expectedScore) {
  const home = Number(expectedScore?.home);
  const away = Number(expectedScore?.away);
  return {
    home: Number.isFinite(home) ? home : null,
    away: Number.isFinite(away) ? away : null,
  };
}

function reliabilityScore(row) {
  const outcome = Number(row.outcomeHitRate || 0);
  const exact = Number(row.exactHitRate || 0);
  const goalError = Number(row.avgGoalError || 2);
  const sample = Math.min(1, Number(row.matches || 0) / 50);
  return Number(Math.max(0.1, Math.min(0.95, outcome * 0.48 + exact * 0.18 + (1 / (1 + goalError)) * 0.22 + sample * 0.12)).toFixed(3));
}

function summarizePhase(row) {
  if (row.matches < MIN_PHASE_ROWS) return `${row.phase}: ${row.matches} sample(s), nog dunne fase-reviewdata`;
  return `${row.phase}: ${Math.round(row.outcomeHitRate * 100)}% 1X2, ${Math.round(row.exactHitRate * 100)}% exact uit ${row.matches} review(s)`;
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  if (!sql) process.exit(2);

  const rows = await sql.query(`
    select ps.prediction_id, ps.expected_score, ps.prediction_payload->>'phaseBucket' as phase_bucket,
      m.league, mr.final_home_goals, mr.final_away_goals, pe.outcome_hit, pe.exact_hit
    from prediction_evaluations pe
    join prediction_snapshots ps on ps.prediction_id = pe.prediction_id
    join matches m on m.match_id = pe.match_id
    join match_results mr on mr.match_id = pe.match_id
    where pe.evaluation_source = 'scheduled-database-evaluator'
      and mr.actual_outcome in ('H','D','A')
  `);

  const groups = new Map();
  for (const row of rows) {
    if (isHiddenInternationalOrWorldCupEntity({ league: row.league, phaseBucket: row.phase_bucket })) continue;
    const phase = phaseFromRow(row);
    const group = groups.get(phase) || {
      phase,
      matches: 0,
      outcomeHits: 0,
      exactHits: 0,
      totalGoalError: 0,
      goalErrorRows: 0,
    };
    group.matches += 1;
    if (row.outcome_hit) group.outcomeHits += 1;
    if (row.exact_hit) group.exactHits += 1;
    const expected = expectedGoals(row.expected_score);
    if (expected.home !== null && expected.away !== null) {
      group.totalGoalError += Math.abs(expected.home - Number(row.final_home_goals)) + Math.abs(expected.away - Number(row.final_away_goals));
      group.goalErrorRows += 1;
    }
    groups.set(phase, group);
  }

  const phaseReliability = {};
  for (const group of groups.values()) {
    const row = {
      phase: group.phase,
      matches: group.matches,
      outcomeHitRate: Number((group.outcomeHits / Math.max(group.matches, 1)).toFixed(3)),
      exactHitRate: Number((group.exactHits / Math.max(group.matches, 1)).toFixed(3)),
      avgGoalError: group.goalErrorRows ? Number((group.totalGoalError / group.goalErrorRows).toFixed(3)) : null,
    };
    phaseReliability[group.phase] = {
      ...row,
      reliabilityScore: reliabilityScore(row),
      summary: summarizePhase(row),
      source: "prediction_evaluations",
      generatedAt: new Date().toISOString(),
      minRows: MIN_PHASE_ROWS,
      mature: row.matches >= MIN_PHASE_ROWS,
    };

    await sql.query(
      `
        insert into calibration_profiles(
          calibration_profile_id, competition_id, phase_bucket, sample_size,
          brier_score, log_loss, average_absolute_error, profile, generated_at
        )
        values($1,null,$2,$3,null,null,$4,$5::jsonb,now())
        on conflict(calibration_profile_id) do update set
          phase_bucket = excluded.phase_bucket,
          sample_size = excluded.sample_size,
          average_absolute_error = excluded.average_absolute_error,
          profile = excluded.profile,
          generated_at = now()
      `,
      [
        `phase_reliability_${group.phase}`,
        group.phase,
        row.matches,
        row.avgGoalError,
        JSON.stringify(phaseReliability[group.phase]),
      ]
    );
  }

  const payload = {
    phaseReliability,
    lastRun: new Date().toISOString(),
    workerVersion: "phase-reliability-db-rebuild",
  };
  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.mkdirSync(path.dirname(MONITOR_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(
    MONITOR_JSON,
    `${JSON.stringify(
      {
        generatedAt: payload.lastRun,
        phaseCount: Object.keys(phaseReliability).length,
        rows: Object.values(phaseReliability),
        recommendation:
          Object.keys(phaseReliability).length > 0
            ? "Phase reliability is gevuld uit Neon-evaluaties. Gebruik dit pas zwaar bij voldoende samples per phase."
            : "Nog geen phase reliability beschikbaar; er zijn meer geëvalueerde snapshotvoorspellingen nodig.",
      },
      null,
      2
    )}\n`
  );

  console.log(JSON.stringify({ phaseCount: Object.keys(phaseReliability).length, phases: Object.keys(phaseReliability) }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
