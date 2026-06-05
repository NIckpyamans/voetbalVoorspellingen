import crypto from "crypto";
import fs from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";

let cachedSql = null;

export function loadLocalEnv(root = process.cwd()) {
  for (const fileName of [".env.local", ".env.production.local", ".env"]) {
    const filePath = path.join(root, fileName);
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      if (process.env[key]) continue;
      process.env[key] = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  }
}

export function getDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL || "";
}

export function databaseConfigured() {
  return Boolean(getDatabaseUrl().trim());
}

export function getSql() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl.trim()) return null;
  if (!cachedSql) cachedSql = neon(databaseUrl);
  return cachedSql;
}

function digest(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 16);
}

function parseScore(score) {
  const match = String(score || "").match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  return { home: Number(match[1]), away: Number(match[2]) };
}

function outcomeFromGoals(home, away) {
  if (home > away) return "H";
  if (away > home) return "A";
  return "D";
}

function statusNormalized(match) {
  const status = String(match?.status || "").toUpperCase();
  if (["FT", "AET", "PEN"].includes(status)) return "finished";
  if (["LIVE", "HT"].includes(status)) return "live";
  if (["POSTP", "CANC", "ABD"].includes(status)) return "postponed";
  return "scheduled";
}

function dateKeyFromMatch(match, fallbackDate = null) {
  return match?.date || fallbackDate || String(match?.kickoff || "").slice(0, 10) || null;
}

function asIso(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function probabilitiesFromPrediction(prediction) {
  return {
    home: Number(prediction?.homeProb || prediction?.probabilities?.home || 0),
    draw: Number(prediction?.drawProb || prediction?.probabilities?.draw || 0),
    away: Number(prediction?.awayProb || prediction?.probabilities?.away || 0),
  };
}

function expectedScoreFromPrediction(prediction) {
  return {
    home: Number(prediction?.predHomeGoals ?? prediction?.expectedScore?.home ?? 0),
    away: Number(prediction?.predAwayGoals ?? prediction?.expectedScore?.away ?? 0),
    label:
      prediction?.expectedScore?.label ||
      `${Number(prediction?.predHomeGoals ?? prediction?.expectedScore?.home ?? 0)}-${Number(
        prediction?.predAwayGoals ?? prediction?.expectedScore?.away ?? 0
      )}`,
  };
}

function indexMatches(store) {
  const matchById = new Map();
  for (const [dateKey, matches] of Object.entries(store?.matches || {})) {
    for (const match of matches || []) {
      if (match?.id) matchById.set(String(match.id), { ...match, date: dateKey });
    }
  }
  return matchById;
}

async function upsertMatch(sql, match, fallbackDate = null) {
  if (!match?.id || !match?.homeTeamName || !match?.awayTeamName) return false;
  const dateKey = dateKeyFromMatch(match, fallbackDate);
  await sql.query(
    `
      insert into matches (
        match_id, source_match_id, data_source, league, season, kickoff_at,
        home_team_id, away_team_id, home_team_name, away_team_name, team_identity,
        status, status_normalized, date_key, raw_payload, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15::jsonb, now())
      on conflict (match_id) do update set
        source_match_id = excluded.source_match_id,
        data_source = excluded.data_source,
        league = excluded.league,
        season = excluded.season,
        kickoff_at = excluded.kickoff_at,
        home_team_id = excluded.home_team_id,
        away_team_id = excluded.away_team_id,
        home_team_name = excluded.home_team_name,
        away_team_name = excluded.away_team_name,
        team_identity = excluded.team_identity,
        status = excluded.status,
        status_normalized = excluded.status_normalized,
        date_key = excluded.date_key,
        raw_payload = excluded.raw_payload,
        updated_at = now()
    `,
    [
      String(match.id),
      String(match.sourceMatchId || match.sourceId || match.id),
      match.dataSource || match.source || "worker-json",
      match.league || null,
      match.season || null,
      asIso(match.kickoff),
      match.homeTeamId ? String(match.homeTeamId) : null,
      match.awayTeamId ? String(match.awayTeamId) : null,
      String(match.homeTeamName),
      String(match.awayTeamName),
      JSON.stringify(match.teamIdentity || {}),
      match.status || null,
      statusNormalized(match),
      dateKey,
      JSON.stringify(match),
    ]
  );

  const score = parseScore(match.score);
  if (score && statusNormalized(match) === "finished") {
    await sql.query(
      `
        insert into match_results (match_id, final_home_goals, final_away_goals, actual_outcome, result_source, settled_at)
        values ($1, $2, $3, $4, $5, now())
        on conflict (match_id) do update set
          final_home_goals = excluded.final_home_goals,
          final_away_goals = excluded.final_away_goals,
          actual_outcome = excluded.actual_outcome,
          result_source = excluded.result_source,
          settled_at = excluded.settled_at
      `,
      [String(match.id), score.home, score.away, outcomeFromGoals(score.home, score.away), match.dataSource || "worker-json"]
    );
  }

  return true;
}

async function upsertPredictionSnapshot(sql, snapshot, matchById) {
  const predictionId = snapshot?.predictionId;
  const matchId = snapshot?.matchId;
  if (!predictionId || !matchId) return false;

  const match = matchById.get(String(matchId));
  if (!match) {
    await upsertMatch(sql, {
      id: matchId,
      date: snapshot.date || String(snapshot.kickoff || "").slice(0, 10) || null,
      kickoff: snapshot.kickoff || snapshot.generatedAt,
      league: snapshot.league,
      season: snapshot.season,
      homeTeamId: snapshot.homeTeamId,
      awayTeamId: snapshot.awayTeamId,
      homeTeamName: snapshot.homeTeam || "Home",
      awayTeamName: snapshot.awayTeam || "Away",
      status: "NS",
      teamIdentity: snapshot.teamIdentity || {},
      dataSource: "prediction-snapshot",
    });
  }

  const generatedAt = asIso(snapshot.generatedAt) || new Date().toISOString();
  const cutoffAt = asIso(snapshot.cutoffAt) || generatedAt;
  const predictionPayload = snapshot.prediction || {};

  await sql.query(
    `
      insert into prediction_snapshots (
        prediction_id, match_id, generated_at, cutoff_at, model_version,
        feature_schema_version, algorithm_version, input_snapshot_hash,
        input_snapshot, features, probabilities, confidence, confidence_raw,
        calibration, expected_score, explanation, data_completeness,
        feature_source_metadata, leakage_guard, prediction_payload
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9::jsonb, $10::jsonb, $11::jsonb, $12, $13,
        $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb,
        $18::jsonb, $19::jsonb, $20::jsonb
      )
      on conflict (prediction_id) do update set
        match_id = excluded.match_id,
        generated_at = excluded.generated_at,
        cutoff_at = excluded.cutoff_at,
        model_version = excluded.model_version,
        feature_schema_version = excluded.feature_schema_version,
        algorithm_version = excluded.algorithm_version,
        input_snapshot_hash = excluded.input_snapshot_hash,
        input_snapshot = excluded.input_snapshot,
        features = excluded.features,
        probabilities = excluded.probabilities,
        confidence = excluded.confidence,
        confidence_raw = excluded.confidence_raw,
        calibration = excluded.calibration,
        expected_score = excluded.expected_score,
        explanation = excluded.explanation,
        data_completeness = excluded.data_completeness,
        feature_source_metadata = excluded.feature_source_metadata,
        leakage_guard = excluded.leakage_guard,
        prediction_payload = excluded.prediction_payload
    `,
    [
      String(predictionId),
      String(matchId),
      generatedAt,
      cutoffAt > generatedAt ? generatedAt : cutoffAt,
      snapshot.modelVersion || predictionPayload.modelVersion || null,
      snapshot.featureSchemaVersion || predictionPayload.featureSchemaVersion || null,
      snapshot.algorithmVersion || predictionPayload.algorithmVersion || null,
      snapshot.inputSnapshotHash || null,
      JSON.stringify(snapshot.inputSnapshot || {}),
      JSON.stringify(snapshot.features || predictionPayload.featureVector || {}),
      JSON.stringify(snapshot.probabilities || probabilitiesFromPrediction(predictionPayload)),
      Number(snapshot.confidence ?? predictionPayload.confidence ?? 0),
      Number(snapshot.confidenceRaw ?? predictionPayload.confidenceRaw ?? snapshot.confidence ?? 0),
      JSON.stringify(snapshot.calibration || {}),
      JSON.stringify(snapshot.expectedScore || expectedScoreFromPrediction(predictionPayload)),
      JSON.stringify(snapshot.explanation || {}),
      JSON.stringify(snapshot.dataCompleteness || predictionPayload.dataCompleteness || {}),
      JSON.stringify(snapshot.featureSourceMetadata || predictionPayload.featureSourceMetadata || {}),
      JSON.stringify(snapshot.leakageGuard || predictionPayload.leakageGuard || {}),
      JSON.stringify({ ...predictionPayload, predictionId, matchId, generatedAt, cutoffAt }),
    ]
  );

  const odds = snapshot.oddsAtPrediction || predictionPayload.oddsAtPrediction || predictionPayload.odds || null;
  if (odds) {
    await sql.query(
      `
        insert into odds_snapshots (
          odds_snapshot_id, prediction_id, provider, bookmaker, market, home, draw, away,
          captured_at, status, missing_reason
        )
        values ($1, $2, $3, $4, '1X2', $5, $6, $7, $8, $9, $10)
        on conflict (odds_snapshot_id) do nothing
      `,
      [
        `odds_${digest(`${predictionId}|1x2`)}`,
        String(predictionId),
        snapshot.oddsProviderStatus || predictionPayload.oddsProviderStatus || "unknown",
        odds.bookmaker || null,
        odds.home ?? null,
        odds.draw ?? null,
        odds.away ?? null,
        asIso(odds.capturedAt) || generatedAt,
        snapshot.oddsStatus || predictionPayload.oddsStatus || "captured",
        snapshot.oddsMissingReason || predictionPayload.oddsMissingReason || null,
      ]
    );
  }

  return true;
}

export async function syncStoreToDatabase(store, options = {}) {
  const sql = getSql();
  if (!sql) return { skipped: true, reason: "database_url_missing" };

  const matchById = indexMatches(store);
  const dateFilter = Array.isArray(options.dateKeys) && options.dateKeys.length ? new Set(options.dateKeys) : null;
  let matches = 0;
  let predictionSnapshots = 0;

  for (const [dateKey, dayMatches] of Object.entries(store?.matches || {})) {
    if (dateFilter && !dateFilter.has(dateKey)) continue;
    for (const match of dayMatches || []) {
      if (await upsertMatch(sql, match, dateKey)) matches += 1;
    }
  }

  for (const snapshot of Object.values(store?.predictionSnapshots || {})) {
    if (dateFilter && snapshot?.date && !dateFilter.has(snapshot.date)) continue;
    if (await upsertPredictionSnapshot(sql, snapshot, matchById)) predictionSnapshots += 1;
  }

  return { skipped: false, matches, predictionSnapshots };
}

export async function readDatabaseDay(dateKey, options = {}) {
  const sql = getSql();
  if (!sql) return { ok: false, source: "database-not-configured", matches: [], predictions: [] };

  const limit = Math.min(Math.max(Number(options.limit || 500), 1), 2000);
  const matches = await sql.query(
    `
      select raw_payload
      from matches
      where date_key = $1
      order by kickoff_at nulls last, home_team_name, away_team_name
      limit $2
    `,
    [dateKey, limit]
  );
  const predictions = await sql.query(
    `
      select ps.prediction_payload
      from prediction_snapshots ps
      join matches m on m.match_id = ps.match_id
      where m.date_key = $1
      order by ps.generated_at desc
      limit $2
    `,
    [dateKey, limit]
  );

  return {
    ok: true,
    source: "postgres",
    matches: matches.map((row) => row.raw_payload).filter(Boolean),
    predictions: predictions.map((row) => row.prediction_payload).filter(Boolean),
  };
}

export async function readDatabaseCounts() {
  const sql = getSql();
  if (!sql) return { databaseConfigured: false };
  const [counts] = await sql.query(`
    select
      (select count(*)::int from matches) as matches,
      (select count(*)::int from prediction_snapshots) as prediction_snapshots,
      (select count(*)::int from source_records) as source_records,
      (select count(*)::int from source_audit) as source_audit,
      (select count(*)::int from odds_snapshots) as odds_snapshots
  `);
  return { databaseConfigured: true, ...counts };
}
