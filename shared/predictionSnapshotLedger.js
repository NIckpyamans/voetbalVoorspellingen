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

// Een ledger-bestand groeit mee met elke run. Zonder limiet kan één JSON.parse
// de Node-heap vullen; dat crasht de hele run i.p.v. een duidelijke fout te geven.
export const SNAPSHOT_LEDGER_DEFAULT_MAX_JSON_BYTES = 96 * 1024 * 1024;

export class SnapshotLedgerTooLargeError extends Error {
  constructor(label, limit) {
    super(`Snapshot ledger ${label} is groter dan ${limit} bytes; weigert het volledig in geheugen te parsen`);
    this.name = "SnapshotLedgerTooLargeError";
    this.code = "ledger_too_large";
  }
}

export function snapshotLedgerMaxJsonBytes(env = process.env) {
  const configured = Number(env.SNAPSHOT_LEDGER_MAX_JSON_BYTES);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : SNAPSHOT_LEDGER_DEFAULT_MAX_JSON_BYTES;
}

// Decodeert een (eventueel gzip-) ledgerbuffer naar tekst. De grootte wordt vóór
// JSON.parse gecontroleerd: gunzip stopt zodra de outputlimiet wordt overschreden.
export function decodeLedgerJson(buffer, label = "ledger", maxBytes = snapshotLedgerMaxJsonBytes()) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length > maxBytes) throw new SnapshotLedgerTooLargeError(label, maxBytes);
  if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return bytes.toString("utf8");
  try {
    return gunzipSync(bytes, { maxOutputLength: maxBytes }).toString("utf8");
  } catch (error) {
    if (error?.code === "ERR_BUFFER_TOO_LARGE") throw new SnapshotLedgerTooLargeError(label, maxBytes);
    throw error;
  }
}

function parseLedgerBuffer(buffer, label = "ledger") {
  if (!buffer?.length) return emptyLedger();
  return normalizeSnapshotLedger(JSON.parse(decodeLedgerJson(buffer, label)));
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

// Laadt maandshards één voor één: de ruwe bytes, de uitgepakte tekst en de geparste
// JSON van één maand zijn zo nooit tegelijk in geheugen voor alle maanden.
async function loadMonthShards({ config, entries, api = false, getObject = getR2Object }) {
  const shards = [];
  for (const entry of entries) {
    const month = entry?.month;
    if (!/^\d{4}-\d{2}$/.test(String(month || ""))) throw new Error(`Invalid month in R2 index: ${month}`);
    const hash = api ? entry.apiSha256 : entry.sha256;
    const relativeKey = api ? entry.apiKey : entry.key;
    if (!/^[a-f0-9]{64}$/.test(String(hash || "")) || relativeKey !== monthLedgerObjectKey(month, hash, api)) {
      throw new Error(`Invalid R2 monthly ledger reference for ${month}`);
    }
    const object = await getObject({ config, key: buildR2ObjectKey(config, relativeKey) });
    if (!object.ok) throw new Error(`R2 monthly ledger missing (${month}): ${object.reason || "unknown error"}`);
    const bytes = Buffer.isBuffer(object.body) ? object.body : Buffer.from(object.body);
    const json = decodeLedgerJson(bytes, `maand ${month}`);
    if (checksum(json) !== hash) throw new Error(`R2 monthly ledger checksum mismatch (${month})`);
    shards.push(normalizeSnapshotLedger(JSON.parse(json)));
  }
  return shards;
}

// Leest alleen de maandshards die een incrementele schrijfactie raakt. Ongewijzigde
// maanden worden via de manifest-verwijzing doorgegeven zonder ze te downloaden.
async function readTouchedR2Ledger({ config, ledger, getObject = getR2Object }) {
  const indexObject = await getObject({ config, key: buildR2ObjectKey(config, SNAPSHOT_LEDGER_MONTH_INDEX_R2_KEY) });
  if (!indexObject.ok) return readR2SnapshotLedger({ config, getObject });
  const manifest = JSON.parse(indexObject.body.toString("utf8"));
  if (manifest.version !== "v2-monthly-ledger" || !Array.isArray(manifest.months)) {
    throw new Error("R2 month index has an unsupported format");
  }
  const touched = new Set(partitionSnapshotLedgerByMonth(ledger).keys());
  const entries = manifest.months.filter((entry) => touched.has(entry?.month));
  const shards = await loadMonthShards({ config, entries, getObject });
  return { available: true, configured: true, source: "r2", ledger: mergeSnapshotLedgers(...shards), manifest, months: manifest.months.length, touchedMonths: entries.length };
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
  const objects = await loadMonthShards({ config, entries: manifest.months, api, getObject });
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

// Alleen de records die na het laden nieuw of gewijzigd zijn. Een run schrijft zo
// alleen zijn eigen delta terug in plaats van de hele geschiedenis opnieuw te verwerken.
export function ledgerDeltaSince(baseline, current) {
  const base = normalizeSnapshotLedger(baseline);
  const next = normalizeSnapshotLedger(current);
  const changed = (known, incoming) => Object.fromEntries(
    Object.entries(incoming || {}).filter(([id, value]) => value && known[id] !== value)
  );
  return normalizeSnapshotLedger({
    generatedAt: next.generatedAt,
    predictionSnapshots: changed(base.predictionSnapshots, next.predictionSnapshots),
    postMatchReviews: changed(base.postMatchReviews, next.postMatchReviews),
    evaluations: changed(base.evaluations, next.evaluations),
  });
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

// Goedkope groeimeting: leest alleen het maandmanifest en de lokale bestandsgrootte,
// nooit de ledger zelf. Zo kan de monitor de groei zien zonder dezelfde heap-piek te veroorzaken.
export async function readSnapshotLedgerStorageSummary({ root = process.cwd(), config = getR2Config(), getObject = getR2Object, env = process.env } = {}) {
  const limitBytes = snapshotLedgerMaxJsonBytes(env);
  const localPath = path.resolve(root, SNAPSHOT_LEDGER_LOCAL_FILE);
  const localRecoveryBytes = fs.existsSync(localPath) ? fs.statSync(localPath).size : 0;
  const summary = {
    limitBytes,
    localRecoveryBytes,
    localRecoveryUtilization: Number((localRecoveryBytes / limitBytes).toFixed(3)),
    r2: { configured: !!config.configured, months: 0, totalSnapshotsIndexed: 0, largestMonth: null, error: null },
  };
  if (config.configured) {
    try {
      const index = await getObject({ config, key: buildR2ObjectKey(config, SNAPSHOT_LEDGER_MONTH_INDEX_R2_KEY) });
      if (!index.ok) {
        summary.r2.error = index.reason || "index_unavailable";
      } else {
        const manifest = JSON.parse(index.body.toString("utf8"));
        const months = Array.isArray(manifest.months) ? manifest.months : [];
        summary.r2.months = months.length;
        summary.r2.totalSnapshotsIndexed = months.reduce((sum, entry) => sum + Number(entry?.snapshots || 0), 0);
        const largest = months.reduce((best, entry) => (Number(entry?.snapshots || 0) > Number(best?.snapshots || 0) ? entry : best), null);
        summary.r2.largestMonth = largest ? { month: largest.month, snapshots: Number(largest.snapshots || 0) } : null;
      }
    } catch (error) {
      summary.r2.error = error?.message || String(error);
    }
  }
  summary.warnings = [];
  if (summary.localRecoveryUtilization >= 0.5) summary.warnings.push("lokale recovery-ledger gebruikt 50% of meer van de parse-limiet");
  if (summary.r2.error) summary.warnings.push(`R2-manifest niet gelezen: ${summary.r2.error}`);
  return summary;
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
  // touchedOnly: alleen de maanden die deze (incrementele) batch raakt worden gelezen.
  // Zonder die optie blijft het volledige samenvoegpad gelden.
  const current = options.mergeRemote === false
    ? { available: false, ledger: emptyLedger(), manifest: null }
    : options.touchedOnly
      ? await readTouchedR2Ledger({ config, ledger, getObject })
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
    touchedMonths: monthsToWrite.size,
    primaryUploads,
    apiUploads,
    bytes: primaryBytes,
    apiBytes,
    apiUpload: { ok: true, uploads: apiUploads, bytes: apiBytes },
    ledger: merged,
  };
}
