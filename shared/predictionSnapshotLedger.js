import fs from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { buildR2ObjectKey, getR2Config, getR2Object, putR2Object } from "./cloudflare-r2.js";

export const SNAPSHOT_LEDGER_VERSION = "v1-immutable-r2-ledger";
export const SNAPSHOT_LEDGER_R2_KEY = "prediction-snapshots/active/ledger.json.gz";
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
  const body = gzipSync(Buffer.from(JSON.stringify(merged), "utf8"), { level: 9 });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
  return { ok: true, filePath, bytes: body.length, ledger: merged };
}

export async function readR2SnapshotLedger(options = {}) {
  const config = options.config || getR2Config();
  const key = buildR2ObjectKey(config, options.relativeKey || SNAPSHOT_LEDGER_R2_KEY);
  if (!config.configured) return { configured: false, available: false, source: "r2", ledger: emptyLedger(), key };
  try {
    const object = await getR2Object({ config, key });
    if (!object.ok) return { configured: true, available: false, source: "r2", ledger: emptyLedger(), key, reason: object.reason };
    return { configured: true, available: true, source: "r2", ledger: parseLedgerBuffer(object.body), key, bytes: object.body.length };
  } catch (error) {
    return { configured: true, available: false, source: "r2", ledger: emptyLedger(), key, error: error?.message || String(error) };
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
  const current = options.mergeRemote === false ? null : await readR2SnapshotLedger({ config });
  const merged = mergeSnapshotLedgers(current?.ledger, ledger);
  const body = gzipSync(Buffer.from(JSON.stringify(merged), "utf8"), { level: 9 });
  const key = buildR2ObjectKey(config, options.relativeKey || SNAPSHOT_LEDGER_R2_KEY);
  const upload = await putR2Object({
    config,
    key,
    body,
    contentType: "application/json",
    metadata: {
      version: SNAPSHOT_LEDGER_VERSION,
      snapshots: String(Object.keys(merged.predictionSnapshots).length),
      reviews: String(Object.keys(merged.postMatchReviews).length),
      evaluations: String(Object.keys(merged.evaluations).length),
    },
  });
  return { ...upload, ledger: merged };
}
