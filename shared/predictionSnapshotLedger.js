import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { buildR2ObjectKey, getR2Config, getR2Object, putR2Object } from "./cloudflare-r2.js";
import { classifyPredictionSnapshotWindow } from "../scripts/worker/snapshot-policy.js";

export const SNAPSHOT_LEDGER_VERSION = "v1-immutable-r2-ledger";
export const SNAPSHOT_LEDGER_R2_KEY = "prediction-snapshots/active/ledger.json.gz";
export const SNAPSHOT_API_LEDGER_R2_KEY = "prediction-snapshots/active/api-ledger.json.gz";
export const SNAPSHOT_LEDGER_MONTH_INDEX_R2_KEY = "prediction-snapshots/active/month-index.json";
export const SNAPSHOT_LEDGER_LOCAL_FILE = path.join("data", "recovery", "prediction-snapshot-ledger.json.gz");

function emptyLedger() {
  return {
    version: SNAPSHOT_LEDGER_VERSION,
    generatedAt: null,
    predictionSnapshots: {},
    predictionSnapshotIndex: {},
    postMatchReviews: {},
    evaluations: {},
  };
}

function parseLedgerBuffer(buffer) {
  if (!buffer?.length) return emptyLedger();
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const json = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  return normalizeSnapshotLedger(JSON.parse(json));
}

function compactSnapshotForApi(snapshot) {
  if (!snapshot?.predictionId || !snapshot?.matchId) return null;
  return {
    predictionId: snapshot.predictionId,
    matchId: snapshot.matchId,
    generatedAt: snapshot.generatedAt,
    cutoffAt: snapshot.cutoffAt,
    kickoff: snapshot.kickoff,
    status: snapshot.status,
    schemaVersion: snapshot.schemaVersion,
    featureSchemaVersion: snapshot.featureSchemaVersion,
    modelVersion: snapshot.modelVersion,
    algorithmVersion: snapshot.algorithmVersion,
    workerVersion: snapshot.workerVersion,
    date: snapshot.date,
    league: snapshot.league,
    season: snapshot.season,
    homeTeam: snapshot.homeTeam,
    awayTeam: snapshot.awayTeam,
    homeTeamId: snapshot.homeTeamId || null,
    awayTeamId: snapshot.awayTeamId || null,
    teamIdentity: snapshot.teamIdentity || snapshot.inputSnapshot?.teamIdentity || null,
    inputSnapshotHash: snapshot.inputSnapshotHash,
    features: snapshot.features || null,
    probabilities: snapshot.probabilities || null,
    confidence: snapshot.confidence ?? null,
    confidenceRaw: snapshot.confidenceRaw ?? null,
    expectedScore: snapshot.expectedScore || null,
    oddsAtPrediction: snapshot.oddsAtPrediction || null,
    oddsStatus: snapshot.oddsStatus || null,
    oddsMissingReason: snapshot.oddsMissingReason || null,
    oddsProviderStatus: snapshot.oddsProviderStatus || null,
    oddsProviderDiagnostics: snapshot.oddsProviderDiagnostics || null,
    roiStatus: snapshot.roiStatus || null,
    clvStatus: snapshot.clvStatus || null,
    sourceAsOf: snapshot.sourceAsOf || snapshot.inputSnapshot?.sourceAsOf || null,
    lineupStatus: snapshot.lineupStatus || snapshot.inputSnapshot?.lineupStatus || null,
    refereeStatus: snapshot.refereeStatus || snapshot.inputSnapshot?.refereeStatus || null,
    featureSourceMetadata: snapshot.featureSourceMetadata || snapshot.inputSnapshot?.featureSourceMetadata || null,
    leakageGuard: snapshot.leakageGuard || null,
    dataCompleteness: snapshot.dataCompleteness || null,
    missingData: snapshot.missingData || [],
  };
}

export function compactSnapshotLedgerForApi(value) {
  const compact = compactSnapshotLedgerForLocalRecovery(value);
  const predictionSnapshots = {};
  for (const snapshot of Object.values(compact.predictionSnapshots || {})) {
    const selected = compactSnapshotForApi(snapshot);
    if (selected) predictionSnapshots[selected.predictionId] = selected;
  }
  return normalizeSnapshotLedger({ ...compact, predictionSnapshots });
}

export function normalizeSnapshotLedger(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    version: source.version || SNAPSHOT_LEDGER_VERSION,
    generatedAt: source.generatedAt || null,
    predictionSnapshots: source.predictionSnapshots || source.snapshots || {},
    predictionSnapshotIndex: source.predictionSnapshotIndex || {},
    postMatchReviews: source.postMatchReviews || source.reviews || {},
    evaluations: source.evaluations || {},
  };
}

function newerRecord(left, right) {
  if (!left) return right;
  if (!right) return left;
  const leftTime = Date.parse(left.evaluatedAt || left.createdAt || left.generatedAt || "") || 0;
  const rightTime = Date.parse(right.evaluatedAt || right.createdAt || right.generatedAt || "") || 0;
  return rightTime >= leftTime ? right : left;
}

export function mergeSnapshotLedgers(...values) {
  const merged = emptyLedger();
  for (const value of values) {
    const ledger = normalizeSnapshotLedger(value);
    for (const [predictionId, snapshot] of Object.entries(ledger.predictionSnapshots)) {
      if (!predictionId || !snapshot) continue;
      // Prediction snapshots are immutable: the first complete record wins.
      if (!merged.predictionSnapshots[predictionId]) merged.predictionSnapshots[predictionId] = snapshot;
    }
    for (const [matchId, review] of Object.entries(ledger.postMatchReviews)) {
      merged.postMatchReviews[matchId] = newerRecord(merged.postMatchReviews[matchId], review);
    }
    for (const [predictionId, evaluation] of Object.entries(ledger.evaluations)) {
      merged.evaluations[predictionId] = newerRecord(merged.evaluations[predictionId], evaluation);
    }
  }

  const index = {};
  for (const snapshot of Object.values(merged.predictionSnapshots)) {
    if (!snapshot?.predictionId || !snapshot?.matchId) continue;
    if (!index[snapshot.matchId]) index[snapshot.matchId] = [];
    if (!index[snapshot.matchId].includes(snapshot.predictionId)) index[snapshot.matchId].push(snapshot.predictionId);
  }
  for (const ids of Object.values(index)) {
    ids.sort((a, b) =>
      Date.parse(merged.predictionSnapshots[a]?.generatedAt || "") - Date.parse(merged.predictionSnapshots[b]?.generatedAt || "")
    );
  }
  merged.predictionSnapshotIndex = index;
  merged.generatedAt = new Date().toISOString();
  return merged;
}

function compactSnapshotLedgerForLocalRecoverySnapshot(snapshot) {
  const allowed = new Set(["t24", "t75", "t45", "t20"]);
  const eligibleByTimestamp = [snapshot?.generatedAt, snapshot?.cutoffAt]
    .filter(Boolean)
    .map((timestamp) => classifyPredictionSnapshotWindow(snapshot?.kickoff, timestamp));
  const storedWindow = allowed.has(snapshot?.snapshotWindow) ? snapshot.snapshotWindow : null;
  const snapshotWindow = storedWindow || eligibleByTimestamp.find((window) => allowed.has(window)) || eligibleByTimestamp[0] || "outside";
  return { ...snapshot, snapshotWindow };
}

export function compactSnapshotLedgerForLocalRecovery(value) {
  const source = normalizeSnapshotLedger(value);
  const selected = new Map();
  for (const snapshot of Object.values(source.predictionSnapshots || {})) {
    if (!snapshot?.predictionId || !snapshot?.matchId) continue;
    const modelVersion = snapshot.modelVersion || snapshot.prediction?.modelVersion || "unknown";
    const normalizedSnapshot = compactSnapshotLedgerForLocalRecoverySnapshot(snapshot);
    const snapshotWindow = normalizedSnapshot.snapshotWindow;
    const key = `${snapshot.matchId}|${modelVersion}|${snapshotWindow}`;
    const current = selected.get(key);
    const currentTime = Date.parse(current?.generatedAt || current?.cutoffAt || "") || 0;
    const candidateTime = Date.parse(snapshot.generatedAt || snapshot.cutoffAt || "") || 0;
    if (!current || candidateTime >= currentTime) selected.set(key, normalizedSnapshot);
  }
  const predictionSnapshots = Object.fromEntries(
    [...selected.values()].map((snapshot) => [snapshot.predictionId, snapshot])
  );
  const keptPredictionIds = new Set(Object.keys(predictionSnapshots));
  return mergeSnapshotLedgers({
    ...source,
    predictionSnapshots,
    evaluations: Object.fromEntries(
      Object.entries(source.evaluations || {}).filter(([predictionId]) => keptPredictionIds.has(predictionId))
    ),
  });
}

function monthForRecord(record, fallback) {
  const timestamp = Date.parse(record?.generatedAt || record?.cutoffAt || record?.kickoff || record?.date || record?.evaluatedAt || record?.createdAt || record?.updatedAt || record?.settledAt || fallback || "");
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function recordTimestamp(record, fallback) {
  const timestamp = Date.parse(record?.evaluatedAt || record?.createdAt || record?.generatedAt || record?.cutoffAt || record?.kickoff || record?.date || fallback || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function partitionSnapshotLedgerByMonth(value) {
  const source = normalizeSnapshotLedger(value);
  const partitions = new Map();
  const ensure = (month) => {
    if (!month) return null;
    if (!partitions.has(month)) partitions.set(month, { predictionSnapshots: {}, postMatchReviews: {}, evaluations: {} });
    return partitions.get(month);
  };
  const snapshotMonthById = new Map();
  const latestMonthByMatch = new Map();

  for (const [predictionId, snapshot] of Object.entries(source.predictionSnapshots || {})) {
    const month = monthForRecord(snapshot, null);
    if (!month || !snapshot) continue;
    ensure(month).predictionSnapshots[predictionId] = snapshot;
    snapshotMonthById.set(predictionId, month);
    const current = latestMonthByMatch.get(snapshot.matchId);
    if (!current || recordTimestamp(snapshot, null) >= current.timestamp) {
      latestMonthByMatch.set(snapshot.matchId, { month, timestamp: recordTimestamp(snapshot, null) });
    }
  }

  for (const [predictionId, evaluation] of Object.entries(source.evaluations || {})) {
    const month = snapshotMonthById.get(predictionId) || monthForRecord(evaluation, null);
    if (month && evaluation) ensure(month).evaluations[predictionId] = evaluation;
  }
  for (const [matchId, review] of Object.entries(source.postMatchReviews || {})) {
    const month = monthForRecord(review, null) || latestMonthByMatch.get(matchId)?.month;
    if (month && review) ensure(month).postMatchReviews[matchId] = review;
  }

  return new Map([...partitions.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, records]) => {
    const ledger = mergeSnapshotLedgers({ ...records, version: source.version });
    const timestamps = [
      ...Object.values(records.predictionSnapshots).map((record) => recordTimestamp(record, source.generatedAt)),
      ...Object.values(records.evaluations).map((record) => recordTimestamp(record, source.generatedAt)),
      ...Object.values(records.postMatchReviews).map((record) => recordTimestamp(record, source.generatedAt)),
    ].filter(Boolean);
    ledger.generatedAt = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : source.generatedAt;
    return [month, ledger];
  }));
}

function monthLedgerObjectKey(month, hash, api = false) {
  const [year, monthNumber] = month.split("-");
  return `prediction-snapshots/year=${year}/month=${monthNumber}/${api ? "api-ledger" : "ledger"}-${hash}.json.gz`;
}

function checksum(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function readPartitionedR2Ledger({ config, legacyKey, api = false, getObject = getR2Object }) {
  const indexKey = buildR2ObjectKey(config, SNAPSHOT_LEDGER_MONTH_INDEX_R2_KEY);
  const indexObject = await getObject({ config, key: indexKey });
  if (!indexObject.ok) {
    if (indexObject.reason !== "not_found") throw new Error(`R2 month index unavailable: ${indexObject.reason || "unknown error"}`);
    const legacy = await getObject({ config, key: buildR2ObjectKey(config, legacyKey) });
    if (!legacy.ok) return { available: false, ledger: emptyLedger(), key: buildR2ObjectKey(config, legacyKey), reason: legacy.reason };
    const ledger = parseLedgerBuffer(legacy.body);
    return { available: true, ledger, key: buildR2ObjectKey(config, legacyKey), bytes: legacy.body.length, legacy: true, manifest: null };
  }

  const manifest = JSON.parse(indexObject.body.toString("utf8"));
  if (manifest.version !== "v2-monthly-ledger" || !Array.isArray(manifest.months)) {
    throw new Error("R2 month index has an unsupported format");
  }
  const objects = await Promise.all(manifest.months.map(async (entry) => {
    const month = entry?.month;
    if (!/^\d{4}-\d{2}$/.test(String(month || ""))) throw new Error(`Invalid month in R2 index: ${month}`);
    const hash = api ? entry.apiSha256 : entry.sha256;
    const relativeKey = api ? entry.apiKey : entry.key;
    if (!/^[a-f0-9]{64}$/.test(String(hash || "")) || relativeKey !== monthLedgerObjectKey(month, hash, api)) {
      throw new Error(`Invalid R2 monthly ledger reference for ${month}`);
    }
    const key = buildR2ObjectKey(config, relativeKey);
    const object = await getObject({ config, key });
    if (!object.ok) throw new Error(`R2 monthly ledger missing (${month}): ${object.reason || "unknown error"}`);
    const bytes = Buffer.isBuffer(object.body) ? object.body : Buffer.from(object.body);
    const json = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
    if (checksum(json) !== hash) throw new Error(`R2 monthly ledger checksum mismatch (${month})`);
    return normalizeSnapshotLedger(JSON.parse(json));
  }));
  return {
    available: true,
    ledger: mergeSnapshotLedgers(...objects),
    key: indexKey,
    manifest,
    months: manifest.months.length,
  };
}

export function ledgerFromStore(store) {
  return normalizeSnapshotLedger({
    generatedAt: new Date().toISOString(),
    predictionSnapshots: store?.predictionSnapshots || {},
    predictionSnapshotIndex: store?.predictionSnapshotIndex || {},
    postMatchReviews: store?.postMatchReviews || {},
    evaluations: store?.predictionEvaluations || {},
  });
}

export function hydrateStoreFromSnapshotLedger(store, ledger) {
  const merged = mergeSnapshotLedgers(ledgerFromStore(store), ledger);
  store.predictionSnapshots = merged.predictionSnapshots;
  store.predictionSnapshotIndex = merged.predictionSnapshotIndex;
  store.postMatchReviews = merged.postMatchReviews;
  store.predictionEvaluations = merged.evaluations;
  return {
    snapshots: Object.keys(merged.predictionSnapshots).length,
    reviews: Object.keys(merged.postMatchReviews).length,
    evaluations: Object.keys(merged.evaluations).length,
  };
}

export function readLocalSnapshotLedger(root = process.cwd()) {
  const filePath = path.resolve(root, SNAPSHOT_LEDGER_LOCAL_FILE);
  if (!fs.existsSync(filePath)) return { available: false, source: "local_recovery", ledger: emptyLedger(), filePath };
  try {
    return { available: true, source: "local_recovery", ledger: parseLedgerBuffer(fs.readFileSync(filePath)), filePath };
  } catch (error) {
    return { available: false, source: "local_recovery", ledger: emptyLedger(), filePath, error: error?.message || String(error) };
  }
}

export function persistLocalSnapshotLedger(ledger, root = process.cwd()) {
  const filePath = path.resolve(root, SNAPSHOT_LEDGER_LOCAL_FILE);
  const current = readLocalSnapshotLedger(root);
  const merged = mergeSnapshotLedgers(current?.ledger, ledger);
  const compact = compactSnapshotLedgerForLocalRecovery(merged);
  const body = gzipSync(Buffer.from(JSON.stringify(compact), "utf8"), { level: 9 });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
  return { ok: true, filePath, bytes: body.length, ledger: compact };
}

export async function readR2SnapshotLedger(options = {}) {
  const config = options.config || getR2Config();
  const key = buildR2ObjectKey(config, options.relativeKey || SNAPSHOT_LEDGER_R2_KEY);
  if (!config.configured) return { configured: false, available: false, source: "r2", ledger: emptyLedger(), key };
  try {
    const result = options.relativeKey
      ? await readPartitionedR2Ledger({ config, legacyKey: options.relativeKey, getObject: options.getObject })
      : await readPartitionedR2Ledger({ config, legacyKey: SNAPSHOT_LEDGER_R2_KEY, getObject: options.getObject });
    return { configured: true, source: "r2", ...result };
  } catch (error) {
    return { configured: true, available: false, source: "r2", ledger: emptyLedger(), key, error: error?.message || String(error) };
  }
}

export async function readR2SnapshotApiLedger(options = {}) {
  const config = options.config || getR2Config();
  const key = buildR2ObjectKey(config, options.relativeKey || SNAPSHOT_API_LEDGER_R2_KEY);
  if (!config.configured) return { configured: false, available: false, source: "r2_api", ledger: emptyLedger(), key };
  try {
    const result = await readPartitionedR2Ledger({
      config,
      legacyKey: options.relativeKey || SNAPSHOT_API_LEDGER_R2_KEY,
      api: true,
      getObject: options.getObject,
    });
    return { configured: true, source: "r2_api", ...result };
  } catch (error) {
    return { configured: true, available: false, source: "r2_api", ledger: emptyLedger(), key, error: error?.message || String(error) };
  }
}

export async function loadSnapshotLedger(options = {}) {
  const local = options.includeLocal === false ? null : readLocalSnapshotLedger(options.root);
  const r2 = options.includeR2 === false ? null : await readR2SnapshotLedger(options);
  const ledger = mergeSnapshotLedgers(local?.ledger, r2?.ledger);
  return { ledger, sources: { local, r2 } };
}

export async function persistSnapshotLedger(ledger, options = {}) {
  const config = options.config || getR2Config();
  if (!config.configured) return { ok: false, skipped: true, reason: "r2_not_configured" };
  const putObject = options.putObject || putR2Object;
  const getObject = options.getObject || getR2Object;
  const current = options.mergeRemote === false
    ? { available: false, ledger: emptyLedger(), manifest: null }
    : await readR2SnapshotLedger({ config, getObject });
  if (current?.error) throw new Error(`Cannot safely update monthly R2 ledger: ${current.error}`);
  if (options.mergeRemote !== false && current?.reason === "not_found" && current?.configured && !options.allowInitialize) {
    throw new Error("Cannot safely update monthly R2 ledger: both month index and legacy ledger are missing");
  }
  const merged = mergeSnapshotLedgers(current?.ledger, ledger);
  const partitions = partitionSnapshotLedgerByMonth(merged);
  const previousEntries = new Map((current?.manifest?.months || []).map((entry) => [entry.month, entry]));
  const legacyLedger = current?.legacy ? current.ledger : null;
  const migrationPartitions = legacyLedger ? partitionSnapshotLedgerByMonth(legacyLedger) : new Map();
  const nextEntries = [];
  let primaryUploads = 0;
  let apiUploads = 0;
  let primaryBytes = 0;
  let apiBytes = 0;

  const monthsToWrite = new Map(partitions);
  for (const [month, monthLedger] of migrationPartitions) {
    if (!monthsToWrite.has(month)) monthsToWrite.set(month, monthLedger);
  }
  for (const [month, monthLedger] of [...monthsToWrite.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const previous = previousEntries.get(month);
    if (previous?.sha256 && previous.key !== monthLedgerObjectKey(month, previous.sha256)) {
      throw new Error(`Invalid existing R2 ledger reference for ${month}`);
    }
    const json = JSON.stringify(monthLedger);
    const apiLedger = compactSnapshotLedgerForApi(monthLedger);
    apiLedger.generatedAt = monthLedger.generatedAt;
    const apiJson = JSON.stringify(apiLedger);
    const jsonHash = checksum(json);
    const apiJsonHash = checksum(apiJson);
    const body = gzipSync(Buffer.from(json, "utf8"), { level: 9 });
    const apiBody = gzipSync(Buffer.from(apiJson, "utf8"), { level: 9 });
    if (previous?.sha256 !== jsonHash) {
      const upload = await putObject({
        config,
        key: buildR2ObjectKey(config, monthLedgerObjectKey(month, jsonHash)),
        body,
        contentType: "application/json",
        metadata: { version: SNAPSHOT_LEDGER_VERSION, month, sha256: jsonHash },
      });
      if (!upload?.ok) throw new Error(`R2 monthly snapshot upload failed for ${month}: ${upload?.reason || "unknown error"}`);
      primaryUploads += 1;
      primaryBytes += body.length;
    }
    if (previous?.apiSha256 !== apiJsonHash) {
      const upload = await putObject({
        config,
        key: buildR2ObjectKey(config, monthLedgerObjectKey(month, apiJsonHash, true)),
        body: apiBody,
        contentType: "application/json",
        metadata: { version: SNAPSHOT_LEDGER_VERSION, purpose: "bounded-api-index", month, sha256: apiJsonHash },
      });
      if (!upload?.ok) throw new Error(`R2 monthly API ledger upload failed for ${month}: ${upload?.reason || "unknown error"}`);
      apiUploads += 1;
      apiBytes += apiBody.length;
    }
    nextEntries.push({
      month,
      sha256: jsonHash,
      apiSha256: apiJsonHash,
      key: monthLedgerObjectKey(month, jsonHash),
      apiKey: monthLedgerObjectKey(month, apiJsonHash, true),
      snapshots: Object.keys(monthLedger.predictionSnapshots).length,
    });
  }
  for (const [month, previous] of previousEntries) {
    if (nextEntries.some((entry) => entry.month === month)) continue;
    nextEntries.push(previous);
  }
  nextEntries.sort((left, right) => left.month.localeCompare(right.month));

  const manifest = { version: "v2-monthly-ledger", generatedAt: new Date().toISOString(), months: nextEntries };
  const manifestUpload = await putObject({
    config,
    key: buildR2ObjectKey(config, SNAPSHOT_LEDGER_MONTH_INDEX_R2_KEY),
    body: `${JSON.stringify(manifest)}\n`,
    contentType: "application/json",
    metadata: { version: manifest.version, months: String(nextEntries.length) },
  });
  if (!manifestUpload?.ok) throw new Error(`R2 monthly ledger index update failed: ${manifestUpload?.reason || "unknown error"}`);

  return {
    ok: true,
    skipped: false,
    key: buildR2ObjectKey(config, SNAPSHOT_LEDGER_MONTH_INDEX_R2_KEY),
    months: nextEntries.length,
    primaryUploads,
    apiUploads,
    bytes: primaryBytes,
    apiBytes,
    apiUpload: { ok: true, uploads: apiUploads, bytes: apiBytes },
    ledger: merged,
  };
}
