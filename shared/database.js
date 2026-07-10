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

function hasNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function uniqueTruthy(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function payloadBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

function chunkObjectEntries(object, size = 250) {
  const entries = Object.entries(object || {});
  const chunks = [];
  for (let index = 0; index < entries.length; index += size) {
    chunks.push(Object.fromEntries(entries.slice(index, index + size)));
  }
  return chunks;
}

function buildAppStateSegments(store, options = {}) {
  const dateFilter = Array.isArray(options.dateKeys) && options.dateKeys.length ? new Set(options.dateKeys) : null;
  const segments = [];
  for (const [key, value] of Object.entries(store || {})) {
    if (key === "matches" || key === "predictions") {
      for (const [dateKey, rows] of Object.entries(value || {})) {
        if (dateFilter && !dateFilter.has(dateKey)) continue;
        segments.push({ group: key, key: String(dateKey), payload: rows || [] });
      }
      continue;
    }
    if (key === "predictionSnapshots") {
      const snapshots = dateFilter
        ? Object.fromEntries(
            Object.entries(value || {}).filter(([, snapshot]) => snapshot?.date && dateFilter.has(snapshot.date))
          )
        : value || {};
      const chunks = chunkObjectEntries(snapshots, 250);
      chunks.forEach((payload, index) => {
        const scope = dateFilter ? [...dateFilter].join("_") : "all";
        segments.push({ group: key, key: `${scope}:chunk-${String(index).padStart(5, "0")}`, payload });
      });
      continue;
    }
    segments.push({ group: "root", key, payload: value ?? null });
  }
  return segments;
}

export async function syncAppStateSegmentsToDatabase(store, options = {}) {
  const sql = getSql();
  if (!sql) return { skipped: true, reason: "database_url_missing" };
  const segments = buildAppStateSegments(store, options);
  for (const segment of segments) {
    await sql.query(
      `
        insert into app_state_segments (segment_group, segment_key, payload, payload_bytes, updated_at)
        values ($1, $2, $3::jsonb, $4, now())
        on conflict (segment_group, segment_key) do update set
          payload = excluded.payload,
          payload_bytes = excluded.payload_bytes,
          updated_at = excluded.updated_at
        where (
          app_state_segments.payload,
          app_state_segments.payload_bytes
        ) is distinct from (
          excluded.payload,
          excluded.payload_bytes
        )
      `,
      [segment.group, segment.key, JSON.stringify(segment.payload), payloadBytes(segment.payload)]
    );
  }
  let prunedSegments = 0;
  const snapshotKeys = segments
    .filter((segment) => segment.group === "predictionSnapshots")
    .map((segment) => segment.key);
  const dateFilter = Array.isArray(options.dateKeys) && options.dateKeys.length ? options.dateKeys : null;
  if (dateFilter) {
    const scope = dateFilter.map(String).join("_");
    const rows = await sql.query(
      `delete from app_state_segments
       where segment_group = 'predictionSnapshots'
         and segment_key like $1
         and not (segment_key = any($2::text[]))
       returning segment_key`,
      [`${scope}:%`, snapshotKeys]
    );
    prunedSegments += rows.length;
  } else {
    const rows = snapshotKeys.length
      ? await sql.query(
          `delete from app_state_segments
           where segment_group = 'predictionSnapshots'
             and not (segment_key = any($1::text[]))
           returning segment_key`,
          [snapshotKeys]
        )
      : await sql.query("delete from app_state_segments where segment_group = 'predictionSnapshots' returning segment_key");
    prunedSegments += rows.length;
  }
  return {
    skipped: false,
    segments: segments.length,
    prunedSegments,
    bytes: segments.reduce((sum, segment) => sum + payloadBytes(segment.payload), 0),
  };
}

export async function readDatabaseServerStore(options = {}) {
  const sql = getSql();
  if (!sql) return null;
  const dateLimit = Math.min(Math.max(Number(options.dateLimit || 30), 1), 120);
  const includePredictionSnapshots = options.includePredictionSnapshots === true;
  const rows = await sql.query(
    `
      select segment_group, segment_key, payload, updated_at
      from app_state_segments
      where segment_group = 'root'
      union all
      select segment_group, segment_key, payload, updated_at
      from (
        select segment_group, segment_key, payload, updated_at
        from app_state_segments
        where segment_group = 'matches'
        order by segment_key desc
        limit $1
      ) recent_matches
      union all
      select segment_group, segment_key, payload, updated_at
      from (
        select segment_group, segment_key, payload, updated_at
        from app_state_segments
        where segment_group = 'predictions'
        order by segment_key desc
        limit $1
      ) recent_predictions
      ${includePredictionSnapshots ? "union all select segment_group, segment_key, payload, updated_at from app_state_segments where segment_group = 'predictionSnapshots'" : ""}
      order by segment_group, segment_key
    `,
    [dateLimit]
  );
  if (!rows.length) return null;
  const store = { matches: {}, predictions: {}, predictionSnapshots: {} };
  let latestUpdatedAt = null;
  for (const row of rows) {
    const group = row.segment_group;
    const key = row.segment_key;
    const payload = row.payload;
    latestUpdatedAt = !latestUpdatedAt || Date.parse(row.updated_at) > Date.parse(latestUpdatedAt)
      ? row.updated_at
      : latestUpdatedAt;
    if (group === "matches" || group === "predictions") {
      store[group][key] = Array.isArray(payload) ? payload : [];
    } else if (group === "predictionSnapshots") {
      Object.assign(store.predictionSnapshots, payload || {});
    } else if (group === "root") {
      store[key] = payload;
    }
  }
  return {
    store,
    branch: "postgres-app-state",
    sourceUrl: "neon:app_state_segments",
    cached: false,
    updatedAt: latestUpdatedAt,
  };
}

export function buildMatchSourceCoverage(match = {}, prediction = null) {
  const homeStats = match.homeSeasonStats || {};
  const awayStats = match.awaySeasonStats || {};
  const marketCalibration = prediction?.marketCalibration || match.marketCalibration || {};
  const entries = [
    {
      key: "fixture",
      label: "Fixture",
      available: Boolean(match.id && match.homeTeamName && match.awayTeamName && (match.kickoff || match.date)),
      source: match.dataSource || match.source || "worker-json",
    },
    {
      key: "result",
      label: "Eindstand",
      available: Boolean(parseScore(match.score) || hasNumber(match.homeScore) || hasNumber(match.awayScore)),
      source: match.resultSource || match.dataSource || null,
    },
    {
      key: "h2h",
      label: "Head-to-head",
      available: Boolean(match.h2h?.played || match.h2h?.results?.length || match.h2hStatus === "filled"),
      source: match.h2h?.agent?.sources?.[0] || match.h2h?.source || null,
    },
    {
      key: "form",
      label: "Vorm",
      available: Boolean(match.homeForm || match.awayForm || homeStats.gamesPlayed || awayStats.gamesPlayed),
      source: homeStats.source || awayStats.source || "worker-form",
    },
    {
      key: "standings",
      label: "Stand",
      available: hasNumber(match.homePos) || hasNumber(match.awayPos),
      source: match.standingsSource || homeStats.source || awayStats.source || null,
    },
    {
      key: "weather",
      label: "Weer",
      available: Boolean(match.weather?.conditions || hasNumber(match.weather?.temperature)),
      source: match.weather?.source || "Open-Meteo",
    },
    {
      key: "xg_style",
      label: "xG/stijl",
      available:
        hasNumber(homeStats.xG) ||
        hasNumber(awayStats.xG) ||
        hasNumber(homeStats.shotsFor) ||
        hasNumber(awayStats.shotsFor) ||
        Boolean(homeStats.externalSources?.length || awayStats.externalSources?.length),
      source: uniqueTruthy([
        ...(homeStats.externalSources || []),
        ...(awayStats.externalSources || []),
        homeStats.source,
        awayStats.source,
      ])[0] || null,
    },
    {
      key: "odds",
      label: "Odds/closing",
      available:
        Boolean(prediction?.oddsAtPrediction || prediction?.odds) ||
        Number(marketCalibration.closingCoverage || 0) > 0,
      source: marketCalibration.source || prediction?.oddsProviderStatus || null,
    },
  ];
  const available = entries.filter((entry) => entry.available).length;
  return {
    score: entries.length ? available / entries.length : 0,
    percent: entries.length ? Math.round((available / entries.length) * 100) : 0,
    available,
    total: entries.length,
    entries,
    sources: uniqueTruthy(entries.map((entry) => entry.source)),
    generatedAt: new Date().toISOString(),
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
  const sourceCoverage = match.sourceCoverage || match.freeSourceCoverage || buildMatchSourceCoverage(match);
  await sql.query(
    `
      insert into matches (
        match_id, source_match_id, data_source, league, season, kickoff_at,
        home_team_id, away_team_id, home_team_name, away_team_name, team_identity,
        status, status_normalized, date_key, raw_payload, weather_payload, source_coverage, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb, now())
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
        weather_payload = excluded.weather_payload,
        source_coverage = excluded.source_coverage,
        updated_at = now()
      where (
        matches.source_match_id, matches.data_source, matches.league, matches.season, matches.kickoff_at,
        matches.home_team_id, matches.away_team_id, matches.home_team_name, matches.away_team_name,
        matches.team_identity, matches.status, matches.status_normalized, matches.date_key,
        matches.raw_payload, matches.weather_payload, matches.source_coverage
      ) is distinct from (
        excluded.source_match_id, excluded.data_source, excluded.league, excluded.season, excluded.kickoff_at,
        excluded.home_team_id, excluded.away_team_id, excluded.home_team_name, excluded.away_team_name,
        excluded.team_identity, excluded.status, excluded.status_normalized, excluded.date_key,
        excluded.raw_payload, excluded.weather_payload, excluded.source_coverage
      )
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
      JSON.stringify({ ...match, freeSourceCoverage: sourceCoverage }),
      JSON.stringify(match.weather || {}),
      JSON.stringify(sourceCoverage),
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
        where (
          match_results.final_home_goals, match_results.final_away_goals,
          match_results.actual_outcome, match_results.result_source
        ) is distinct from (
          excluded.final_home_goals, excluded.final_away_goals,
          excluded.actual_outcome, excluded.result_source
        )
      `,
      [String(match.id), score.home, score.away, outcomeFromGoals(score.home, score.away), match.dataSource || "worker-json"]
    );
  }

  return true;
}

function indexSnapshotsByMatch(store) {
  const byPredictionId = new Map();
  const byMatchId = new Map();
  for (const snapshot of Object.values(store?.predictionSnapshots || {})) {
    if (!snapshot?.predictionId || !snapshot?.matchId) continue;
    byPredictionId.set(String(snapshot.predictionId), snapshot);
    const current = byMatchId.get(String(snapshot.matchId));
    const currentTime = Date.parse(current?.generatedAt || "") || 0;
    const nextTime = Date.parse(snapshot.generatedAt || "") || 0;
    if (!current || nextTime >= currentTime) byMatchId.set(String(snapshot.matchId), snapshot);
  }
  return { byPredictionId, byMatchId };
}

async function upsertPredictionEvaluation(sql, matchId, review, snapshotIndexes) {
  if (!matchId || !review) return false;
  const directPredictionId = review.predictionId ? String(review.predictionId) : null;
  const snapshot =
    (directPredictionId && snapshotIndexes.byPredictionId.get(directPredictionId)) ||
    snapshotIndexes.byMatchId.get(String(matchId));
  const predictionId = directPredictionId || snapshot?.predictionId;
  if (!predictionId) return false;

  await sql.query(
    `
      insert into prediction_evaluations (
        prediction_id, match_id, exact_hit, outcome_hit, probability_outcome_hit,
        brier_score, log_loss, roi, roi_status, clv, clv_status, evaluation_source, evaluated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      on conflict (prediction_id) do update set
        match_id = excluded.match_id,
        exact_hit = excluded.exact_hit,
        outcome_hit = excluded.outcome_hit,
        probability_outcome_hit = excluded.probability_outcome_hit,
        brier_score = excluded.brier_score,
        log_loss = excluded.log_loss,
        roi = excluded.roi,
        roi_status = excluded.roi_status,
        clv = excluded.clv,
        clv_status = excluded.clv_status,
        evaluation_source = excluded.evaluation_source,
        evaluated_at = excluded.evaluated_at
    `,
    [
      String(predictionId),
      String(matchId),
      review.exactHit ?? null,
      review.outcomeHit ?? null,
      review.probabilityOutcomeHit ?? null,
      review.brierScore ?? null,
      review.logLoss ?? null,
      review.roi ?? null,
      review.roiStatus || null,
      review.clv ?? null,
      review.clvStatus || null,
      review.evaluationSource || "json-post-match-review",
      asIso(review.evaluatedAt || review.createdAt || review.reviewedAt) || new Date().toISOString(),
    ]
  );
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
      where (
        prediction_snapshots.match_id, prediction_snapshots.generated_at, prediction_snapshots.cutoff_at,
        prediction_snapshots.model_version, prediction_snapshots.feature_schema_version,
        prediction_snapshots.algorithm_version, prediction_snapshots.input_snapshot_hash,
        prediction_snapshots.input_snapshot, prediction_snapshots.features, prediction_snapshots.probabilities,
        prediction_snapshots.confidence, prediction_snapshots.confidence_raw, prediction_snapshots.calibration,
        prediction_snapshots.expected_score, prediction_snapshots.explanation,
        prediction_snapshots.data_completeness, prediction_snapshots.feature_source_metadata,
        prediction_snapshots.leakage_guard, prediction_snapshots.prediction_payload
      ) is distinct from (
        excluded.match_id, excluded.generated_at, excluded.cutoff_at,
        excluded.model_version, excluded.feature_schema_version,
        excluded.algorithm_version, excluded.input_snapshot_hash,
        excluded.input_snapshot, excluded.features, excluded.probabilities,
        excluded.confidence, excluded.confidence_raw, excluded.calibration,
        excluded.expected_score, excluded.explanation,
        excluded.data_completeness, excluded.feature_source_metadata,
        excluded.leakage_guard, excluded.prediction_payload
      )
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
    const capturedAt = asIso(odds.capturedAt) || generatedAt;
    const kickoffAt = asIso(match?.kickoff || snapshot.kickoff);
    const availableBeforeKickoff = Boolean(capturedAt && kickoffAt && Date.parse(capturedAt) < Date.parse(kickoffAt));
    const minutesBeforeKickoff = availableBeforeKickoff
      ? Math.floor((Date.parse(kickoffAt) - Date.parse(capturedAt)) / 60000)
      : null;
    await sql.query(
      `
        insert into odds_snapshots (
          odds_snapshot_id, prediction_id, provider, bookmaker, market, home, draw, away,
          captured_at, odds_role, available_before_kickoff, minutes_before_kickoff, status, missing_reason
        )
        values ($1, $2, $3, $4, '1X2', $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
        capturedAt,
        availableBeforeKickoff ? "prematch" : "unknown",
        availableBeforeKickoff,
        minutesBeforeKickoff,
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

  const appState = await syncAppStateSegmentsToDatabase(store, options);
  const matchById = indexMatches(store);
  const snapshotIndexes = indexSnapshotsByMatch(store);
  const dateFilter = Array.isArray(options.dateKeys) && options.dateKeys.length ? new Set(options.dateKeys) : null;
  let matches = 0;
  let predictionSnapshots = 0;
  let predictionEvaluations = 0;

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

  for (const [matchId, review] of Object.entries(store?.postMatchReviews || {})) {
    const match = matchById.get(String(matchId));
    if (dateFilter && match?.date && !dateFilter.has(match.date)) continue;
    if (await upsertPredictionEvaluation(sql, matchId, review, snapshotIndexes)) predictionEvaluations += 1;
  }

  return { skipped: false, matches, predictionSnapshots, predictionEvaluations, appState };
}

export async function readDatabaseDay(dateKey, options = {}) {
  const sql = getSql();
  if (!sql) return { ok: false, source: "database-not-configured", matches: [], predictions: [] };

  const limit = Math.min(Math.max(Number(options.limit || 500), 1), 2000);
  const matches = await sql.query(
    `
      select
        m.match_id,
        m.raw_payload,
        m.weather_payload,
        m.source_coverage,
        ms.*,
        (
          select jsonb_agg(to_jsonb(tms) order by tms.side)
          from team_match_stats tms
          where tms.match_id = m.match_id
        ) as team_match_stats_payload,
        (
          select jsonb_build_object(
            'providers', jsonb_agg(distinct hos.provider),
            'bookmakers', jsonb_agg(distinct hos.bookmaker),
            'samples', count(*),
            'avgHome', avg(hos.home),
            'avgDraw', avg(hos.draw),
            'avgAway', avg(hos.away)
          )
          from historical_odds_snapshots hos
          where hos.match_id = m.match_id
        ) as historical_odds_payload
      from matches m
      left join match_stats ms on ms.match_id = m.match_id
      where m.date_key = $1 and m.identity_status = 'resolved'
      order by m.kickoff_at nulls last, m.home_team_name, m.away_team_name
      limit $2
    `,
    [dateKey, limit]
  );
  const predictions = await sql.query(
    `
      select ps.prediction_payload
      from prediction_snapshots ps
      join matches m on m.match_id = ps.match_id
      where m.date_key = $1 and m.identity_status = 'resolved'
      order by ps.generated_at desc
      limit $2
    `,
    [dateKey, limit]
  );

  return {
    ok: true,
    source: "postgres",
    matches: matches.map((row) => {
      if (!row.raw_payload) return null;
      const matchStats = {
        halftimeHomeGoals: row.halftime_home_goals,
        halftimeAwayGoals: row.halftime_away_goals,
        homeXg: row.home_xg,
        awayXg: row.away_xg,
        homeShots: row.home_shots,
        awayShots: row.away_shots,
        homeShotsOnTarget: row.home_shots_on_target,
        awayShotsOnTarget: row.away_shots_on_target,
        homeCorners: row.home_corners,
        awayCorners: row.away_corners,
        statsSource: row.stats_source,
      };
      return {
        ...row.raw_payload,
        weather: row.raw_payload.weather || row.weather_payload || undefined,
        freeSourceCoverage: row.raw_payload.freeSourceCoverage || row.source_coverage || undefined,
        sourceCoverage: row.raw_payload.sourceCoverage || row.source_coverage || undefined,
        dbFeatureContext: {
          matchStats,
          teamMatchStats: row.team_match_stats_payload || [],
          historicalOdds: row.historical_odds_payload || null,
          featureSources: [
            row.stats_source ? "match_stats" : null,
            row.team_match_stats_payload?.length ? "team_match_stats" : null,
            row.historical_odds_payload?.samples ? "historical_odds_snapshots" : null,
            row.weather_payload && Object.keys(row.weather_payload).length ? "weather_payload" : null,
          ].filter(Boolean),
        },
      };
    }).filter(Boolean),
    predictions: predictions.map((row) => row.prediction_payload).filter(Boolean),
  };
}

export async function readDatabaseHistoryItems(options = {}) {
  const sql = getSql();
  if (!sql) return null;
  const limit = Math.min(Math.max(Number(options.limit || 1000), 1), 5000);
  const rows = await sql.query(
    `
      select
        pe.*,
        ps.generated_at,
        ps.cutoff_at,
        ps.model_version,
        ps.feature_schema_version,
        ps.input_snapshot_hash,
        ps.data_completeness,
        ps.expected_score,
        ps.confidence,
        ps.confidence_raw,
        ps.prediction_payload->>'homeTeam' as payload_home_team,
        ps.prediction_payload->>'awayTeam' as payload_away_team,
        ps.prediction_payload->>'league' as payload_league,
        ps.prediction_payload#>>'{inputSnapshot,homeTeam}' as input_home_team,
        ps.prediction_payload#>>'{inputSnapshot,awayTeam}' as input_away_team,
        ps.prediction_payload#>>'{inputSnapshot,league}' as input_league,
        ps.prediction_payload->>'predHomeGoals' as payload_pred_home_goals,
        ps.prediction_payload->>'predAwayGoals' as payload_pred_away_goals,
        ps.prediction_payload#>>'{review,actualScore}' as payload_actual_score,
        ps.prediction_payload#>>'{review,totalGoalError}' as payload_total_goal_error,
        ps.prediction_payload#>>'{review,predictedOutcome}' as payload_predicted_outcome,
        ps.prediction_payload#>>'{review,actualOutcome}' as payload_actual_outcome,
        ps.prediction_payload->>'exactScoreConfidence' as payload_exact_score_confidence,
        ps.prediction_payload->>'oddsStatus' as payload_odds_status,
        ps.prediction_payload->>'oddsProviderStatus' as payload_odds_provider_status,
        ps.prediction_payload->>'oddsMissingReason' as payload_odds_missing_reason,
        ps.prediction_payload->'oddsAtPrediction' as payload_odds_at_prediction,
        ps.prediction_payload->'odds' as payload_odds,
        ps.prediction_payload->'calibration' as payload_calibration,
        ps.prediction_payload->'qualityGate' as payload_quality_gate,
        ps.prediction_payload#>'{modelEdges,qualityGate}' as model_quality_gate,
        ps.prediction_payload#>'{modelEdges,sourceReliability}' as model_source_reliability,
        ps.prediction_payload#>'{modelEdges,leagueCalibration}' as model_league_calibration,
        ps.prediction_payload#>>'{modelEdges,modelName}' as model_edge_name,
        ps.prediction_payload#>>'{modelEdges,modelAgreement}' as model_edge_agreement,
        ps.prediction_payload#>>'{modelEdges,riskProfile}' as model_edge_risk_profile,
        ps.prediction_payload->>'modelName' as payload_model_name,
        ps.prediction_payload->>'bestBetRank' as payload_best_bet_rank,
        ps.prediction_payload->>'topConfidencePick' as payload_top_confidence_pick,
        ps.prediction_payload->>'topExactScorePick' as payload_top_exact_score_pick,
        ps.prediction_payload->'topExactReasons' as payload_top_exact_reasons,
        ps.prediction_payload->'exactScoreReasons' as payload_exact_score_reasons,
        ps.prediction_payload->>'predictedBtts' as payload_predicted_btts,
        ps.prediction_payload->>'actualBtts' as payload_actual_btts,
        ps.prediction_payload->>'bttsHit' as payload_btts_hit,
        ps.prediction_payload->>'predictedOver25' as payload_predicted_over25,
        ps.prediction_payload->>'actualOver25' as payload_actual_over25,
        ps.prediction_payload->>'over25Hit' as payload_over25_hit,
        m.league,
        m.home_team_name,
        m.away_team_name,
        mr.final_home_goals,
        mr.final_away_goals,
        mr.actual_outcome
      from prediction_evaluations pe
      join prediction_snapshots ps on ps.prediction_id = pe.prediction_id
      join matches m on m.match_id = pe.match_id
      left join match_results mr on mr.match_id = pe.match_id
      order by pe.evaluated_at desc
      limit $1
    `,
    [limit]
  );
  return rows.map((row) => {
    const expectedScore = row.expected_score || {};
    const predHome = row.payload_pred_home_goals ?? expectedScore.home ?? null;
    const predAway = row.payload_pred_away_goals ?? expectedScore.away ?? null;
    const actualScore =
      row.final_home_goals != null && row.final_away_goals != null
        ? `${row.final_home_goals}-${row.final_away_goals}`
        : row.payload_actual_score || null;
    return {
      matchId: row.match_id,
      predictionId: row.prediction_id,
      predictedScore: predHome != null && predAway != null ? `${predHome}-${predAway}` : expectedScore.label || null,
      actualScore,
      exactHit: row.exact_hit,
      outcomeHit: row.outcome_hit,
      probabilityOutcomeHit: row.probability_outcome_hit,
      totalGoalError: row.payload_total_goal_error ?? null,
      createdAt: row.evaluated_at ? Date.parse(row.evaluated_at) : Date.now(),
      evaluatedAt: row.evaluated_at,
      homeTeamName: row.home_team_name || row.payload_home_team || row.input_home_team || null,
      awayTeamName: row.away_team_name || row.payload_away_team || row.input_away_team || null,
      league: row.league || row.payload_league || row.input_league || null,
      predictedOutcome: row.payload_predicted_outcome || null,
      actualOutcome: row.actual_outcome || row.payload_actual_outcome || null,
      confidence: row.confidence,
      confidenceRaw: row.confidence_raw,
      calibration: row.payload_calibration || null,
      exactScoreConfidence: row.payload_exact_score_confidence || null,
      brierScore: row.brier_score,
      logLoss: row.log_loss,
      roi: row.roi,
      roiStatus: row.roi_status,
      clv: row.clv,
      clvStatus: row.clv_status,
      generatedAt: row.generated_at,
      cutoffAt: row.cutoff_at,
      modelVersion: row.model_version,
      featureSchemaVersion: row.feature_schema_version,
      inputSnapshotHash: row.input_snapshot_hash,
      evaluationSource: row.evaluation_source,
      leakageGuard: null,
      oddsAtPrediction: row.payload_odds_at_prediction || row.payload_odds || null,
      oddsStatus: row.payload_odds_status || null,
      oddsProviderStatus: row.payload_odds_provider_status || null,
      oddsMissingReason: row.payload_odds_missing_reason || null,
      featureSourceMetadata: null,
      featureImportance: [],
      sourceReliability: row.model_source_reliability || null,
      qualityGate: row.payload_quality_gate || row.model_quality_gate || row.data_completeness || null,
      leagueCalibration: row.model_league_calibration || null,
      sourceTimestampCoverage: null,
      bestBetRank: Number(row.payload_best_bet_rank || 0) || null,
      topConfidencePick: row.payload_top_confidence_pick === true || row.payload_top_confidence_pick === "true",
      topExactScorePick: row.payload_top_exact_score_pick === true || row.payload_top_exact_score_pick === "true",
      topExactReasons: Array.isArray(row.payload_top_exact_reasons) ? row.payload_top_exact_reasons : Array.isArray(row.payload_exact_score_reasons) ? row.payload_exact_score_reasons : [],
      predictedBtts: row.payload_predicted_btts ?? null,
      actualBtts: row.payload_actual_btts ?? null,
      bttsHit: row.payload_btts_hit ?? null,
      predictedOver25: row.payload_predicted_over25 ?? null,
      actualOver25: row.payload_actual_over25 ?? null,
      over25Hit: row.payload_over25_hit ?? null,
      modelName: row.payload_model_name || row.model_edge_name || null,
      modelAgreement: Number(row.model_edge_agreement || 0),
      riskProfile: row.model_edge_risk_profile || null,
    };
  });
}

export async function readDatabaseCounts() {
  const sql = getSql();
  if (!sql) return { databaseConfigured: false };
  const [counts] = await sql.query(`
    select
      (select count(*)::int from matches) as matches,
      (select count(*)::int from prediction_snapshots) as prediction_snapshots,
      (select count(*)::int from prediction_evaluations) as prediction_evaluations,
      (select count(*)::int from source_records) as source_records,
      (select count(*)::int from source_audit) as source_audit,
      (select count(*)::int from odds_snapshots) as odds_snapshots,
      (select count(*)::int from historical_odds_snapshots) as historical_odds_snapshots,
      (select count(*)::int from match_stats) as match_stats,
      (select count(*)::int from team_match_stats) as team_match_stats,
      (select count(*)::int from competition_season_clubs) as competition_season_clubs,
      (select count(*)::int from standings_snapshots where source = 'season-reset-zero') as zero_standings_snapshots,
      (select count(*)::int from h2h_edges) as h2h_edges
  `);
  return { databaseConfigured: true, ...counts };
}

function dbAliasKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|afc|sc|club|football|voetbal)\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function aliasVariants(value) {
  const base = dbAliasKey(value);
  const variants = new Set([base]);
  const compact = base.replace(/-/g, "");
  if (compact && compact !== base) variants.add(compact);
  const withoutCityPrefix = base.replace(/^(real|sporting|atletico|athletic|olympique|inter|ac)-/, "");
  if (withoutCityPrefix && withoutCityPrefix !== base) variants.add(withoutCityPrefix);
  const withoutSuffix = base.replace(/-(fc|cf|afc|sc|club)$/, "");
  if (withoutSuffix && withoutSuffix !== base) variants.add(withoutSuffix);
  return [...variants].filter(Boolean);
}

async function resolveClubIdByAlias(sql, providedId, teamName) {
  if (providedId) {
    const [exactClub] = await sql.query("select club_id from clubs where club_id = $1 limit 1", [String(providedId)]);
    if (exactClub?.club_id) return { clubId: exactClub.club_id, source: "provided_id" };
  }

  const variants = aliasVariants(teamName);
  if (!variants.length) return { clubId: providedId ? String(providedId) : null, source: "unresolved" };

  const [aliasRow] = await sql.query(
    `
      select club_id, normalized_alias
      from club_aliases
      where normalized_alias = any($1::text[])
      order by array_position($1::text[], normalized_alias) nulls last
      limit 1
    `,
    [variants]
  );
  if (aliasRow?.club_id) return { clubId: aliasRow.club_id, source: "club_aliases", matchedAlias: aliasRow.normalized_alias };

  const [nameRow] = await sql.query(
    `
      select club_id, name
      from clubs
      where lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) = any($1::text[])
      limit 1
    `,
    [variants]
  );
  if (nameRow?.club_id) return { clubId: nameRow.club_id, source: "club_name", matchedAlias: dbAliasKey(nameRow.name) };

  return { clubId: providedId ? String(providedId) : null, source: "unresolved" };
}

async function resolveMatchIdByFixture(sql, { matchId, dateKey, homeClubId, awayClubId, homeTeamName, awayTeamName }) {
  if (matchId) {
    const [exactMatch] = await sql.query("select match_id from matches where match_id = $1 limit 1", [String(matchId)]);
    if (exactMatch?.match_id) return { matchId: exactMatch.match_id, source: "provided_match_id" };
  }
  if (dateKey && homeClubId && awayClubId) {
    const [fixtureMatch] = await sql.query(
      `
        select match_id
        from matches
        where date_key = $1
          and identity_status = 'resolved'
          and home_club_id = $2
          and away_club_id = $3
        order by kickoff_at nulls last, updated_at desc
        limit 1
      `,
      [dateKey, homeClubId, awayClubId]
    );
    if (fixtureMatch?.match_id) return { matchId: fixtureMatch.match_id, source: "date_club_fixture" };
  }
  if (dateKey && homeTeamName && awayTeamName) {
    const [nameMatch] = await sql.query(
      `
        select match_id
        from matches
        where date_key = $1
          and identity_status = 'resolved'
          and lower(home_team_name) = lower($2)
          and lower(away_team_name) = lower($3)
        order by kickoff_at nulls last, updated_at desc
        limit 1
      `,
      [dateKey, String(homeTeamName), String(awayTeamName)]
    );
    if (nameMatch?.match_id) return { matchId: nameMatch.match_id, source: "date_team_name_fixture" };
  }
  return { matchId: matchId ? String(matchId) : null, source: "unresolved" };
}

export async function readDatabaseFeatureContext({
  matchId,
  homeClubId,
  awayClubId,
  competitionId,
  dateKey,
  homeTeamName,
  awayTeamName,
} = {}) {
  const sql = getSql();
  if (!sql) return null;
  const homeResolution = await resolveClubIdByAlias(sql, homeClubId, homeTeamName);
  const awayResolution = await resolveClubIdByAlias(sql, awayClubId, awayTeamName);
  const resolvedHomeClubId = homeResolution.clubId;
  const resolvedAwayClubId = awayResolution.clubId;
  const matchResolution = await resolveMatchIdByFixture(sql, {
    matchId,
    dateKey,
    homeClubId: resolvedHomeClubId,
    awayClubId: resolvedAwayClubId,
    homeTeamName,
    awayTeamName,
  });
  const resolvedMatchId = matchResolution.matchId;
  const byMatch = resolvedMatchId
    ? await sql.query(
        `
          select
            ms.*,
            m.weather_payload,
            (
              select jsonb_agg(to_jsonb(tms) order by tms.side)
              from team_match_stats tms
              where tms.match_id = $1
            ) as team_match_stats_payload,
            (
              select jsonb_build_object(
                'samples', count(*),
                'avgHome', avg(home),
                'avgDraw', avg(draw),
                'avgAway', avg(away)
              )
              from historical_odds_snapshots
              where match_id = $1
            ) as historical_odds_payload
          from matches m
          left join match_stats ms on ms.match_id = m.match_id
          where m.match_id = $1
          limit 1
        `,
        [resolvedMatchId]
      )
    : [];
  const row = byMatch[0] || {};
  const teamSeasonRows = resolvedHomeClubId || resolvedAwayClubId
    ? await sql.query(
        `
          select club_id, style_profile, xg_for, xg_against, matches_played
          from team_season_stats
          where club_id = any($1)
          order by updated_at desc
          limit 4
        `,
        [[resolvedHomeClubId, resolvedAwayClubId].filter(Boolean)]
      )
    : [];
  const h2hRows = resolvedHomeClubId && resolvedAwayClubId
    ? await sql.query(
        `
          select *
          from h2h_edges
          where home_club_id = least($1::text, $2::text)
            and away_club_id = greatest($1::text, $2::text)
            and ($3::text is null or competition_id = $3::text)
          order by updated_at desc
          limit 1
        `,
        [resolvedHomeClubId, resolvedAwayClubId, competitionId || null]
      )
    : [];
  return {
    matchId: resolvedMatchId || matchId,
    requestedMatchId: matchId || null,
    matchResolution,
    requestedHomeClubId: homeClubId || null,
    requestedAwayClubId: awayClubId || null,
    resolvedHomeClubId,
    resolvedAwayClubId,
    homeResolution,
    awayResolution,
    aliasMatched:
      homeResolution.source === "club_aliases" ||
      homeResolution.source === "club_name" ||
      awayResolution.source === "club_aliases" ||
      awayResolution.source === "club_name",
    dateKey,
    matchStats: row.match_id
      ? {
          homeXg: row.home_xg,
          awayXg: row.away_xg,
          homeShots: row.home_shots,
          awayShots: row.away_shots,
          homeCorners: row.home_corners,
          awayCorners: row.away_corners,
          statsSource: row.stats_source,
        }
      : {},
    teamMatchStats: row.team_match_stats_payload || [],
    historicalOdds: row.historical_odds_payload || null,
    weather: row.weather_payload || null,
    teamSeasonStyle: teamSeasonRows,
    h2hEdge: h2hRows[0] || null,
    featureSources: [
      row.stats_source ? "match_stats" : null,
      row.team_match_stats_payload?.length ? "team_match_stats" : null,
      row.historical_odds_payload?.samples ? "historical_odds_snapshots" : null,
      teamSeasonRows.length ? "team_season_stats" : null,
      h2hRows.length ? "h2h_edges" : null,
    ].filter(Boolean),
  };
}
