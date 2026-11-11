import { buildR2ObjectKey, getR2Config, getR2Object } from "./cloudflare-r2.js";
import { parseStreamingLedger } from "./streamingLedger.js";
import {
  SNAPSHOT_LEDGER_MONTH_INDEX_R2_KEY,
  SNAPSHOT_LEDGER_R2_KEY,
  decodeLedgerJson,
  normalizeSnapshotLedger,
  readLocalSnapshotLedger,
} from "./predictionSnapshotLedger.js";

// Zelfde sleutelvorm als de maandshards van de grote R2-ledger. Bewust hier
// herhaald in plaats van geïmporteerd: de ledger-module exporteert alleen zijn
// schrijfroute, en deze reader moet daar onafhankelijk van kunnen lezen. Wijkt de
// vorm ooit af, dan faalt de referentiecontrole hieronder en lezen we niets —
// nooit stilzwijgend een verkeerd of onbevestigd object.
function monthLedgerKey(month, hash) {
  const [year, monthNumber] = String(month).split("-");
  return `prediction-snapshots/year=${year}/month=${monthNumber}/ledger-${hash}.json.gz`;
}

// Leest en valideert één maandshard. parseStreamingLedger verifieert de
// sha256-checksum van de bytes; de referentiecontrole hieronder bewijst dat de
// index naar precies dat object wijst.
async function readMonthShard({ config, entry, getObject }) {
  const month = entry?.month;
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) throw new Error(`Invalid month in R2 index: ${month}`);
  const hash = entry?.sha256;
  if (!/^[a-f0-9]{64}$/.test(String(hash || "")) || entry?.key !== monthLedgerKey(month, hash)) {
    throw new Error(`Invalid R2 monthly ledger reference for ${month}`);
  }
  const object = await getObject({ config, key: buildR2ObjectKey(config, entry.key) });
  if (!object.ok) throw new Error(`R2 monthly ledger missing (${month}): ${object.reason || "unknown error"}`);
  const bytes = Buffer.isBuffer(object.body) ? object.body : Buffer.from(object.body);
  return normalizeSnapshotLedger(await parseStreamingLedger(bytes, hash));
}

function pushEvaluatedResults(ledger, results) {
  const snapshots = ledger?.predictionSnapshots || {};
  for (const [predictionId, evaluation] of Object.entries(ledger?.evaluations || {})) {
    const snapshot = snapshots[predictionId];
    if (!snapshot || evaluation?.finalHomeGoals == null || evaluation?.finalAwayGoals == null) continue;
    const kickoff = snapshot.kickoff || evaluation.kickoff || snapshot.date || null;
    results.push({
      matchId: snapshot.matchId || evaluation.matchId || null,
      kickoff,
      date: String(snapshot.date || kickoff || "").slice(0, 10),
      league: snapshot.league || null,
      homeTeam: snapshot.homeTeam || snapshot.prediction?.homeTeam || null,
      awayTeam: snapshot.awayTeam || snapshot.prediction?.awayTeam || null,
      homeScore: Number(evaluation.finalHomeGoals),
      awayScore: Number(evaluation.finalAwayGoals),
      source: evaluation.evaluationSource || "immutable-r2-snapshot-ledger",
    });
  }
}

// Platte lijst met afgeronde uitslagen uit de R2-snapshotledger, zonder de
// volledige ledger-objectgraaf vast te houden. Tot 11-11-2026 laadde de
// H2H-backfill de hele ledger en stierf daarbij met exit 134 (heap-abort),
// waardoor de hoofdworker assembly en publicatie oversloeg. Hier wordt elke
// maandshard direct ingevouwen en daarna losgelaten, zodat de heap niet
// meegroeit met de geschiedenis.
export async function streamEvaluatedMatchResults(options = {}) {
  const config = options.config || getR2Config();
  const getObject = options.getObject || getR2Object;
  const results = [];
  const sources = {
    local: { available: false },
    r2: { configured: Boolean(config.configured), available: false, months: 0, error: null },
  };
  const local = options.includeLocal === false ? null : readLocalSnapshotLedger(options.root);
  if (local?.available) {
    pushEvaluatedResults(local.ledger, results);
    sources.local.available = true;
  }
  if (!config.configured || options.includeR2 === false) return { results, sources };
  try {
    const indexObject = await getObject({ config, key: buildR2ObjectKey(config, SNAPSHOT_LEDGER_MONTH_INDEX_R2_KEY) });
    if (!indexObject.ok) {
      // Zonder maandindex kan de monolithische legacy-ledger nog bestaan.
      const legacy = await getObject({ config, key: buildR2ObjectKey(config, SNAPSHOT_LEDGER_R2_KEY) });
      if (!legacy.ok) {
        sources.r2.error = legacy.reason || indexObject.reason || "ledger_unavailable";
        return { results, sources };
      }
      pushEvaluatedResults(normalizeSnapshotLedger(JSON.parse(decodeLedgerJson(legacy.body, "r2_legacy"))), results);
      sources.r2.available = true;
      sources.r2.legacy = true;
      return { results, sources };
    }
    const manifest = JSON.parse(indexObject.body.toString("utf8"));
    if (manifest.version !== "v2-monthly-ledger" || !Array.isArray(manifest.months)) {
      throw new Error("R2 month index has an unsupported format");
    }
    for (const entry of manifest.months) {
      pushEvaluatedResults(await readMonthShard({ config, entry, getObject }), results);
    }
    sources.r2.available = true;
    sources.r2.months = manifest.months.length;
  } catch (error) {
    sources.r2.error = error?.message || String(error);
  }
  return { results, sources };
}
