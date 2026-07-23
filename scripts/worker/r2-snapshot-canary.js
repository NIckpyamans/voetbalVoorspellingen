import crypto from "node:crypto";
import { buildR2ObjectKey, getR2Config, getR2Object, putR2Object } from "../../shared/cloudflare-r2.js";
import { evaluateImmutableSnapshot } from "./snapshot-evaluation.js";

const CANARY_KEY = "health/snapshot-evaluation-canary.json";

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function buildSnapshotCanary(now = new Date()) {
  const generatedAt = now.toISOString();
  const kickoff = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  return {
    version: "v1-r2-snapshot-evaluation-canary",
    generatedAt,
    snapshot: {
      predictionId: "r2-canary-prediction",
      matchId: "r2-canary-match",
      generatedAt,
      cutoffAt: generatedAt,
      kickoff,
      probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
      expectedScore: { home: 1, away: 0 },
    },
    result: { finalHomeGoals: 1, finalAwayGoals: 0, actualOutcome: "H" },
  };
}

export function verifySnapshotCanary(payload) {
  const evaluation = evaluateImmutableSnapshot(payload?.snapshot, payload?.result, {
    evaluationSource: "r2-snapshot-canary",
  });
  if (!evaluation) return { ok: false, reason: "snapshot_not_evaluable" };
  if (evaluation.outcomeHit !== true || evaluation.exactHit !== true) {
    return { ok: false, reason: "unexpected_evaluation", evaluation };
  }
  return { ok: true, evaluation };
}

export async function runSnapshotCanary(options = {}) {
  const config = options.config || getR2Config();
  if (!config.configured) return { ok: false, configured: false, reason: "r2_not_configured" };

  const payload = buildSnapshotCanary(options.now || new Date());
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
  const checksum = digest(body);
  const key = buildR2ObjectKey(config, options.relativeKey || CANARY_KEY);
  const upload = await (options.putObject || putR2Object)({
    config,
    key,
    body,
    contentType: "application/json",
    metadata: { checksum, canary: "snapshot-evaluation" },
  });
  if (!upload?.ok) return { ok: false, configured: true, key, stage: "write", upload };

  const object = await (options.getObject || getR2Object)({ config, key });
  if (!object?.ok) return { ok: false, configured: true, key, stage: "read", object };
  const readChecksum = digest(object.body);
  if (readChecksum !== checksum) {
    return { ok: false, configured: true, key, stage: "checksum", checksum, readChecksum };
  }

  const verification = verifySnapshotCanary(JSON.parse(object.body.toString("utf8")));
  return {
    ok: verification.ok,
    configured: true,
    key,
    bytes: object.body.length,
    checksum,
    stage: verification.ok ? "complete" : "evaluation",
    evaluation: verification.evaluation || null,
    reason: verification.reason || null,
  };
}
