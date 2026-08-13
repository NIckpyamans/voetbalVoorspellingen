#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { isHiddenInternationalOrWorldCupEntity } from "../shared/competitionVisibility.js";
import { buildR2ObjectKey, getR2Config, putR2Object } from "../shared/cloudflare-r2.js";

const ROOT = process.cwd();
const OUTPUT_JSON = path.join(ROOT, "data", "phase-reliability.json");
const MONITOR_JSON = path.join(ROOT, "monitor", "phase-reliability-rebuild.json");
const MIN_PHASE_ROWS = Math.max(1, Number(process.env.PHASE_RELIABILITY_MIN_ROWS || 5));

function phaseFromRow(row) {
  const league = String(row.league || "").toLowerCase();
  // Legacy snapshots labelled some club friendlies as "league". Competition
  // identity is authoritative here so friendlies keep their own calibration.
  if (/friendl|oefen/.test(league)) return "friendly";
  const explicit = String(row.phase_bucket || "").trim();
  if (explicit) return explicit;
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

function parseScore(value) {
  const match = String(value || "").match(/(\d+)\s*[-:]\s*(\d+)/);
  return match ? { home: Number(match[1]), away: Number(match[2]) } : { home: null, away: null };
}

function localEvaluationRows() {
  const filePath = path.join(ROOT, "training", "training-snapshot.json");
  if (!fs.existsSync(filePath)) return [];
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const unique = new Map();
  for (const row of Array.isArray(payload?.rows) ? payload.rows : []) {
    if (!row?.snapshotBacked || !/^(FT|AET|PEN)$/i.test(String(row?.status || ""))) continue;
    const review = row.review || {};
    const matchId = String(row.matchId || review.matchId || "").trim();
    if (!matchId) continue;
    const actual = parseScore(row.score || review.actualScore);
    const predicted = parseScore(review.predictedScore);
    if (actual.home === null || actual.away === null) continue;
    unique.set(matchId, {
      prediction_id: row.predictionId || review.predictionId || null,
      expected_score: predicted,
      phase_bucket: review.phaseBucket || null,
      league: row.league || review.league || null,
      final_home_goals: actual.home,
      final_away_goals: actual.away,
      outcome_hit: Boolean(review.outcomeHit),
      exact_hit: Boolean(review.exactHit),
    });
  }
  return [...unique.values()];
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  let databaseAvailable = false;
  let databaseError = sql ? null : "database_not_configured";
  let rows = [];
  if (sql) try {
    rows = await sql.query(`
    select ps.prediction_id, ps.expected_score, ps.prediction_payload->>'phaseBucket' as phase_bucket,
      m.league, mr.final_home_goals, mr.final_away_goals, pe.outcome_hit, pe.exact_hit
    from prediction_evaluations pe
    join prediction_snapshots ps on ps.prediction_id = pe.prediction_id
    join matches m on m.match_id = pe.match_id
    join match_results mr on mr.match_id = pe.match_id
    where pe.evaluation_source = 'scheduled-database-evaluator'
      and mr.actual_outcome in ('H','D','A')
    `);
    databaseAvailable = true;
  } catch (error) {
    databaseError = error?.message || String(error);
  }
  const source = databaseAvailable && rows.length ? "prediction_evaluations" : "immutable_training_fallback";
  if (source === "immutable_training_fallback") rows = localEvaluationRows();

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
      source,
      generatedAt: new Date().toISOString(),
      minRows: MIN_PHASE_ROWS,
      mature: row.matches >= MIN_PHASE_ROWS,
    };

    if (databaseAvailable) await sql.query(
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

  const activeProfileIds = Object.keys(phaseReliability).map((phase) => `phase_reliability_${phase}`);
  if (databaseAvailable) await sql.query(
    `
      delete from calibration_profiles
      where calibration_profile_id like 'phase_reliability_%'
        and not (calibration_profile_id = any($1::text[]))
    `,
    [activeProfileIds]
  );

  const payload = {
    phaseReliability,
    lastRun: new Date().toISOString(),
    workerVersion: "phase-reliability-db-rebuild",
  };
  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.mkdirSync(path.dirname(MONITOR_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(payload, null, 2)}\n`);
  const r2Config = getR2Config();
  let r2 = { ok: false, skipped: true, reason: "r2_not_configured" };
  if (r2Config.configured) {
    r2 = await putR2Object({
      config: r2Config,
      key: buildR2ObjectKey(r2Config, "model/phase-reliability.json"),
      body: `${JSON.stringify(payload)}\n`,
      contentType: "application/json",
      metadata: { source, phases: String(Object.keys(phaseReliability).length) },
    }).catch((error) => ({ ok: false, skipped: false, error: error?.message || String(error) }));
  }
  fs.writeFileSync(
    MONITOR_JSON,
    `${JSON.stringify(
      {
        generatedAt: payload.lastRun,
        source,
        evaluatedRows: rows.length,
        database: { configured: Boolean(sql), available: databaseAvailable, error: databaseError },
        r2,
        phaseCount: Object.keys(phaseReliability).length,
        rows: Object.values(phaseReliability),
        recommendation:
          Object.keys(phaseReliability).length > 0
            ? `Phase reliability is gevuld uit ${source}. Gebruik dit pas zwaar bij voldoende unieke samples per phase.`
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
