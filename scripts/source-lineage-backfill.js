#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { neon } from "@neondatabase/serverless";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data", "days");
const SERVER_DATA_FILE = path.join(ROOT, "server_data.json");
const OUT_DIR = path.join(ROOT, "database", "backfills");
const SQL_FILE = path.join(OUT_DIR, "source-lineage.sql");
const MANIFEST_FILE = path.join(ROOT, "monitor", "source-lineage-backfill.json");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || String(process.env[key] || "").trim()) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

for (const fileName of [".env.local", ".env.production.local", ".env"]) {
  loadEnvFile(path.join(ROOT, fileName));
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function sqlString(value) {
  if (value == null || value === "") return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? {}))}::jsonb`;
}

function isoFromAny(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function compactMatchPayload(match) {
  return {
    id: match?.id || null,
    date: match?.date || null,
    kickoff: match?.kickoff || null,
    league: match?.league || null,
    homeTeamName: match?.homeTeamName || null,
    awayTeamName: match?.awayTeamName || null,
    status: match?.status || null,
    score: match?.score || null,
    dataSource: match?.dataSource || match?.source || null,
    h2hStatus: match?.h2hStatus || null,
    sourceAsOf: match?.sourceAsOf || null,
    dataCompletenessScore: match?.dataCompletenessScore ?? match?.dataCompleteness?.score ?? null,
  };
}

function compactPredictionPayload(prediction) {
  return {
    predictionId: prediction?.predictionId || null,
    matchId: prediction?.matchId || null,
    generatedAt: prediction?.generatedAt || null,
    cutoffAt: prediction?.cutoffAt || null,
    modelVersion: prediction?.modelVersion || prediction?.ensembleMeta?.baseModel || null,
    probabilities: {
      home: prediction?.homeProb ?? null,
      draw: prediction?.drawProb ?? null,
      away: prediction?.awayProb ?? null,
    },
    expectedScore: {
      home: prediction?.predHomeGoals ?? null,
      away: prediction?.predAwayGoals ?? null,
    },
    dataCompletenessScore: prediction?.dataCompletenessScore ?? prediction?.dataCompleteness?.score ?? null,
  };
}

function createSourceRecord({ provider, entityType, entityKey, fetchedAt, sourceTimestamp, trustScore, payload }) {
  const contentHash = stableHash(JSON.stringify(payload || {}));
  const id = `src_${stableHash(`${provider}|${entityType}|${entityKey}|${contentHash}`).slice(0, 24)}`;
  return {
    source_record_id: id,
    provider: provider || "unknown",
    source_url: null,
    entity_type: entityType,
    entity_key: entityKey,
    fetched_at: fetchedAt || new Date().toISOString(),
    source_timestamp: sourceTimestamp || null,
    content_hash: contentHash,
    trust_score: trustScore,
    payload,
  };
}

function sourceAuditRows(prediction, sourceRecordId) {
  const predictionId = prediction?.predictionId;
  const matchId = prediction?.matchId;
  if (!predictionId && !matchId) return [];
  const meta = prediction?.featureSourceMetadata || prediction?.inputSnapshot?.featureSourceMetadata || {};
  const rows = [];
  for (const [fieldName, info] of Object.entries(meta || {})) {
    const source = typeof info === "object" && info ? info.source || info.provider || null : null;
    const asOf = typeof info === "object" && info ? isoFromAny(info.asOf || info.capturedAt || info.generatedAt) : null;
    const available = typeof info === "object" && info ? Boolean(info.available ?? info.present ?? source) : Boolean(info);
    rows.push({
      prediction_id: predictionId,
      match_id: matchId,
      field_name: fieldName,
      available,
      source,
      as_of: asOf,
      source_timestamp_known: Boolean(asOf),
      note: sourceRecordId,
    });
  }
  if (!rows.length) {
    const standardFields = [
      ["prediction_payload", true, prediction?.dataSource || "json-cache"],
      ["h2h", Boolean(prediction?.h2h), prediction?.h2h?.source || prediction?.h2hStatus || null],
      ["form", Boolean(prediction?.homeForm || prediction?.awayForm), "json-cache"],
      ["lineupSummary", Boolean(prediction?.lineupSummary), prediction?.lineupSummary?.source || null],
      ["marketCalibration", Boolean(prediction?.marketCalibration), prediction?.marketCalibration?.source || null],
      ["dataCompleteness", Boolean(prediction?.dataCompleteness || prediction?.dataCompletenessScore != null), "prediction-engine"],
      ["xgShots", Boolean(prediction?.homeTeamProfile?.xG || prediction?.awayTeamProfile?.xG), "team-profile"],
    ];
    for (const [fieldName, available, source] of standardFields) {
      rows.push({
        prediction_id: predictionId,
        match_id: matchId,
        field_name: String(fieldName),
        available: Boolean(available),
        source: source ? String(source) : null,
        as_of: isoFromAny(prediction?.generatedAt),
        source_timestamp_known: Boolean(prediction?.generatedAt),
        note: sourceRecordId,
      });
    }
  }
  return rows;
}

function collectDays() {
  const days = new Map();
  const server = readJsonSafe(SERVER_DATA_FILE, {});
  for (const [date, matches] of Object.entries(server.matches || {})) {
    days.set(date, {
      ...(days.get(date) || {}),
      matches: Array.isArray(matches) ? matches : [],
      predictions: Array.isArray(server.predictions?.[date]) ? server.predictions[date] : [],
      lastRun: server.lastRun || null,
    });
  }
  if (fs.existsSync(DATA_DIR)) {
    for (const fileName of fs.readdirSync(DATA_DIR).filter((name) => name.endsWith(".json"))) {
      const date = fileName.replace(/\.json$/, "");
      const day = readJsonSafe(path.join(DATA_DIR, fileName), {});
      days.set(date, {
        ...(days.get(date) || {}),
        matches: Array.isArray(day.matches) ? day.matches : days.get(date)?.matches || [],
        predictions: Array.isArray(day.predictions) ? day.predictions : days.get(date)?.predictions || [],
        lastRun: day.lastRun || days.get(date)?.lastRun || null,
      });
    }
  }
  return days;
}

const sourceRecords = new Map();
const auditRows = [];
const days = collectDays();

for (const [date, day] of days.entries()) {
  const fetchedAt = isoFromAny(day.lastRun) || new Date().toISOString();
  for (const match of day.matches || []) {
    const entityKey = match?.id || `${date}|${match?.homeTeamName}|${match?.awayTeamName}`;
    const payload = compactMatchPayload({ ...match, date: match?.date || date });
    const record = createSourceRecord({
      provider: match?.dataSource || match?.source || "match-json-cache",
      entityType: "match",
      entityKey,
      fetchedAt,
      sourceTimestamp: isoFromAny(match?.sourceAsOf?.fixture || match?.sourceAsOf?.score || match?.kickoff || match?.date),
      trustScore: Number(match?.sourceReliability?.score ?? match?.dataCompletenessScore ?? 0.5),
      payload,
    });
    sourceRecords.set(record.source_record_id, record);
  }

  for (const prediction of day.predictions || []) {
    const entityKey = prediction?.predictionId || prediction?.matchId || `${date}|prediction`;
    const payload = compactPredictionPayload(prediction);
    const record = createSourceRecord({
      provider: prediction?.dataSource || "prediction-json-cache",
      entityType: "prediction_snapshot",
      entityKey,
      fetchedAt,
      sourceTimestamp: isoFromAny(prediction?.generatedAt || prediction?.cutoffAt),
      trustScore: Number(prediction?.dataCompletenessScore ?? prediction?.dataCompleteness?.score ?? 0.5),
      payload,
    });
    sourceRecords.set(record.source_record_id, record);
    auditRows.push(...sourceAuditRows(prediction, record.source_record_id));
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true });

const sql = [
  "-- Generated by scripts/source-lineage-backfill.js",
  `-- Generated at ${new Date().toISOString()}`,
  "begin;",
  ...[...sourceRecords.values()].map((row) =>
    [
      "insert into source_records (source_record_id, provider, source_url, entity_type, entity_key, fetched_at, source_timestamp, content_hash, trust_score, payload)",
      "values (",
      [
        sqlString(row.source_record_id),
        sqlString(row.provider),
        sqlString(row.source_url),
        sqlString(row.entity_type),
        sqlString(row.entity_key),
        sqlString(row.fetched_at),
        sqlString(row.source_timestamp),
        sqlString(row.content_hash),
        Number.isFinite(row.trust_score) ? String(row.trust_score) : "null",
        sqlJson(row.payload),
      ].join(", "),
      ") on conflict (source_record_id) do update set fetched_at = excluded.fetched_at, payload = excluded.payload;",
    ].join(" ")
  ),
  ...auditRows.map((row) =>
    [
      "insert into source_audit (prediction_id, field_name, available, source, as_of, source_timestamp_known, note)",
      "select ps.prediction_id,",
      [
        sqlString(row.field_name),
        row.available ? "true" : "false",
        sqlString(row.source),
        sqlString(row.as_of),
        row.source_timestamp_known ? "true" : "false",
        sqlString(row.note),
      ].join(", "),
      "from (select prediction_id from prediction_snapshots where",
      row.prediction_id
        ? `prediction_id = ${sqlString(row.prediction_id)}`
        : `match_id = ${sqlString(row.match_id)}`,
      "order by generated_at desc limit 1) ps",
      "where not exists (select 1 from source_audit where prediction_id = ps.prediction_id and field_name =",
      `${sqlString(row.field_name)} and coalesce(note, '') = ${sqlString(row.note)});`,
    ].join(" ")
  ),
  "commit;",
  "",
].join("\n");

fs.writeFileSync(SQL_FILE, sql);

const manifest = {
  generatedAt: new Date().toISOString(),
  status: "generated",
  days: days.size,
  sourceRecords: sourceRecords.size,
  sourceAuditRows: auditRows.length,
  sqlFile: path.relative(ROOT, SQL_FILE).replace(/\\/g, "/"),
  databaseConfigured: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL),
};

async function applySqlWithNeon(databaseUrl) {
  const sql = neon(databaseUrl);
  const statements = splitSqlStatements(fs.readFileSync(SQL_FILE, "utf8"));
  const predictionSnapshots = await sql.query(
    "select prediction_id, match_id, generated_at from prediction_snapshots order by generated_at desc"
  );
  const latestPredictionByMatch = new Map();
  const predictionIds = new Set();
  for (const snapshot of predictionSnapshots) {
    if (snapshot?.prediction_id) predictionIds.add(String(snapshot.prediction_id));
    if (snapshot?.match_id && !latestPredictionByMatch.has(String(snapshot.match_id))) {
      latestPredictionByMatch.set(String(snapshot.match_id), String(snapshot.prediction_id));
    }
  }
  const shouldApplyAudit = predictionIds.size > 0;
  let appliedStatements = 0;
  let skippedAuditStatements = 0;

  for (const statement of statements) {
    if (/\binsert\s+into\s+source_audit\b/i.test(statement)) {
      skippedAuditStatements += 1;
      continue;
    }
    await sql.query(statement);
    appliedStatements += 1;
  }
  const appliedAuditRows = shouldApplyAudit
    ? await applyAuditRowsWithNeon(sql, auditRows, { latestPredictionByMatch, predictionIds })
    : 0;
  const [appliedCounts] = await sql.query(`
    select
      (select count(*)::int from source_records) as source_records,
      (select count(*)::int from source_audit) as source_audit,
      (select count(*)::int from prediction_snapshots) as prediction_snapshots
  `);

  manifest.applyStatus = "applied";
  manifest.applyMethod = "neon-serverless";
  manifest.appliedStatements = appliedStatements;
  manifest.skippedAuditStatements = skippedAuditStatements;
  manifest.appliedAuditRows = appliedAuditRows;
  manifest.appliedCounts = appliedCounts;
  if (!shouldApplyAudit) {
    manifest.auditBackfillStatus = "skipped_until_prediction_snapshots_exist";
  } else {
    manifest.auditBackfillStatus = "applied";
  }
}

async function applyAuditRowsWithNeon(sql, rows, context) {
  const [before] = await sql.query("select count(*)::int as count from source_audit");
  const mapped = [];
  for (const row of rows) {
    const predictionId = row.prediction_id
      ? context.predictionIds.has(String(row.prediction_id))
        ? String(row.prediction_id)
        : null
      : context.latestPredictionByMatch.get(String(row.match_id || ""));
    if (!predictionId) continue;
    mapped.push({ ...row, prediction_id: predictionId });
  }

  const batchSize = 250;
  for (let offset = 0; offset < mapped.length; offset += batchSize) {
    const batch = mapped.slice(offset, offset + batchSize);
    const params = [];
    const values = batch.map((row, index) => {
      const base = index * 7;
      params.push(
        row.prediction_id,
        row.field_name,
        Boolean(row.available),
        row.source || null,
        row.as_of || null,
        Boolean(row.source_timestamp_known),
        row.note || null
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });
    await sql.query(
      `
        insert into source_audit (
          prediction_id, field_name, available, source, as_of, source_timestamp_known, note
        )
        select
          v.prediction_id,
          v.field_name,
          v.available::boolean,
          v.source,
          v.as_of::timestamptz,
          v.source_timestamp_known::boolean,
          v.note
        from (values ${values.join(", ")}) as v(
          prediction_id, field_name, available, source, as_of, source_timestamp_known, note
        )
        where not exists (
          select 1
          from source_audit existing
          where existing.prediction_id = v.prediction_id
            and existing.field_name = v.field_name
            and coalesce(existing.note, '') = coalesce(v.note, '')
        )
      `,
      params
    );
  }
  const [after] = await sql.query("select count(*)::int as count from source_audit");
  return Math.max(Number(after?.count || 0) - Number(before?.count || 0), 0);
}

function splitSqlStatements(input) {
  const statements = [];
  let current = "";
  let quote = null;
  let dollarTag = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    current += char;

    if (dollarTag) {
      if (input.slice(index, index + dollarTag.length) === dollarTag) {
        current += input.slice(index + 1, index + dollarTag.length);
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }

    if (quote) {
      if (char === quote && next === quote) {
        current += next;
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "$") {
      const match = input.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag.slice(1);
        index += dollarTag.length - 1;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      const newline = input.indexOf("\n", index + 2);
      const commentEnd = newline === -1 ? input.length - 1 : newline;
      current += input.slice(index + 1, commentEnd + 1);
      index = commentEnd;
      continue;
    }

    if (char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
    }
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL || "";
if (databaseUrl) {
  const result = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", SQL_FILE], {
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    manifest.applyMethod = "neon-serverless";
    manifest.psqlFallbackReason = result.error.message;
    try {
      await applySqlWithNeon(databaseUrl);
    } catch (error) {
      manifest.applyStatus = "failed";
      manifest.applyError = error.message;
      process.exitCode = 1;
    }
  } else {
    manifest.applyStatus = result.status === 0 ? "applied" : "failed";
    manifest.applyMethod = "psql";
    if (result.status !== 0) process.exitCode = result.status || 1;
  }
} else {
  manifest.applyStatus = "skipped_database_url_needed";
  manifest.nextStep = "Vul DATABASE_URL, POSTGRES_URL of SUPABASE_DB_URL en draai npm run db:source-lineage:backfill opnieuw.";
}

fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
