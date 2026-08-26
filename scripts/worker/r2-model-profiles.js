import crypto from "crypto";
import { buildR2ObjectKey, getR2Config, getR2Object, putR2Object } from "../../shared/cloudflare-r2.js";
import { mergePhaseReliability } from "./phase-reliability-policy.js";

export const ACTIVE_CALIBRATION_KEY = "model/calibration/active.json";
export const PHASE_RELIABILITY_KEY = "model/phase-reliability.json";

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function parseObjectBody(object) {
  if (!object?.ok) return null;
  try {
    return JSON.parse(object.body.toString("utf8"));
  } catch {
    return null;
  }
}

export function validateActiveCalibration(payload) {
  if (!payload || payload.schemaVersion !== "league-calibration-r2-v1") return null;
  if (payload.active !== true || payload.promotionGate?.canPromote !== true) return null;
  if (!payload.profiles || typeof payload.profiles !== "object" || !Object.keys(payload.profiles).length) return null;
  return payload;
}

export async function publishActiveCalibration({ profiles, promotionGate, source, generatedAt = new Date().toISOString(), config = getR2Config() }) {
  if (!config.configured) return { ok: false, skipped: true, reason: "r2_not_configured" };
  if (!promotionGate?.canPromote || !profiles || !Object.keys(profiles).length) {
    return { ok: false, skipped: true, reason: "promotion_gate_or_profiles_missing" };
  }

  const activeKey = buildR2ObjectKey(config, ACTIVE_CALIBRATION_KEY);
  const current = parseObjectBody(await getR2Object({ config, key: activeKey }).catch(() => null));
  const base = {
    schemaVersion: "league-calibration-r2-v1",
    active: true,
    generatedAt,
    source,
    promotionGate,
    profiles,
    previousVersionKey: current?.versionKey || null,
  };
  const serializedBase = JSON.stringify(base);
  const versionKey = `model/calibration/versions/${generatedAt.replace(/[:.]/g, "-")}-${digest(serializedBase)}.json`;
  const artifact = { ...base, versionKey };
  const body = `${JSON.stringify(artifact)}\n`;

  await putR2Object({
    config,
    key: buildR2ObjectKey(config, versionKey),
    body,
    contentType: "application/json",
    metadata: { type: "league-calibration", active: "false" },
  });
  const pointer = await putR2Object({
    config,
    key: activeKey,
    body,
    contentType: "application/json",
    metadata: { type: "league-calibration", active: "true" },
  });
  return { ...pointer, versionKey, previousVersionKey: artifact.previousVersionKey };
}

export function applyR2ModelProfiles(store, { calibration, phaseReliability }) {
  const applied = { calibrationProfiles: 0, phaseProfiles: 0, skippedForDrift: [] };
  const validCalibration = validateActiveCalibration(calibration);
  if (validCalibration) {
    const blocked = new Set(
      (store.backtestSegmentation?.driftAlerts || [])
        .filter((alert) => alert?.scope === "league" && alert?.severity === "high")
        .map((alert) => String(alert.key || ""))
    );
    for (const [league, profile] of Object.entries(validCalibration.profiles)) {
      if (blocked.has(league)) {
        applied.skippedForDrift.push(league);
        continue;
      }
      store.leagueCalibrationProfiles[league] = {
        ...profile,
        source: profile.source || "r2_approved_calibration",
        activeVersionKey: validCalibration.versionKey,
        promotedAt: validCalibration.generatedAt,
      };
      applied.calibrationProfiles += 1;
    }
    store.activeCalibrationArtifact = {
      source: "cloudflare_r2",
      generatedAt: validCalibration.generatedAt,
      versionKey: validCalibration.versionKey,
      previousVersionKey: validCalibration.previousVersionKey || null,
      profiles: applied.calibrationProfiles,
    };
  }

  const phaseProfiles = phaseReliability?.phaseReliability;
  if (phaseProfiles && typeof phaseProfiles === "object") {
    const taggedProfiles = Object.fromEntries(
      Object.entries(phaseProfiles).map(([phase, profile]) => [
        phase,
        { ...profile, source: profile?.source || phaseReliability?.source || "cloudflare_r2" },
      ])
    );
    const merged = mergePhaseReliability(store.phaseReliability, taggedProfiles);
    store.phaseReliability = merged.profiles;
    applied.phaseProfiles = Object.keys(merged.profiles).length;
    applied.phaseDecisions = merged.decisions;
  }
  return applied;
}

export async function hydrateR2ModelProfiles(store, config = getR2Config()) {
  if (!config.configured) return { configured: false, calibrationProfiles: 0, phaseProfiles: 0 };
  const [calibrationObject, phaseObject] = await Promise.all([
    getR2Object({ config, key: buildR2ObjectKey(config, ACTIVE_CALIBRATION_KEY) }).catch(() => null),
    getR2Object({ config, key: buildR2ObjectKey(config, PHASE_RELIABILITY_KEY) }).catch(() => null),
  ]);
  return {
    configured: true,
    ...applyR2ModelProfiles(store, {
      calibration: parseObjectBody(calibrationObject),
      phaseReliability: parseObjectBody(phaseObject),
    }),
  };
}
