import fs from "fs";
import path from "path";

// Een provider met een account-/planblokkade levert per run alleen maar
// dezelfde fout op. Deze schakelaar onthoudt dat tussen runs, zodat H2H zich
// tijdelijk op de werkende bronnen richt in plaats van de geblokkeerde key te
// blijven bevragen.

const DEFAULT_TTL_HOURS = 24;
const ACCOUNT_BLOCKING_CATEGORIES = new Set(["auth_or_plan", "account_blocked"]);

export function providerCircuitPath(root = process.cwd()) {
  return path.join(root, "monitor", "provider-circuits.json");
}

export function loadProviderCircuits(root = process.cwd()) {
  try {
    const payload = JSON.parse(fs.readFileSync(providerCircuitPath(root), "utf8"));
    const providers = payload?.providers;
    return providers && typeof providers === "object" ? providers : {};
  } catch {
    return {};
  }
}

export function isProviderCircuitOpen(circuits, provider, now = Date.now()) {
  const openUntil = Date.parse(circuits?.[provider]?.openUntil || "");
  return Number.isFinite(openUntil) && openUntil > now;
}

export function shouldTripProviderCircuit(category) {
  return ACCOUNT_BLOCKING_CATEGORIES.has(String(category || ""));
}

export function tripProviderCircuit(circuits, provider, { reason, error = null, category = null, ttlHours = DEFAULT_TTL_HOURS, now = Date.now() } = {}) {
  const hours = Math.max(1, Number(ttlHours) || DEFAULT_TTL_HOURS);
  const previous = circuits?.[provider] || {};
  return {
    ...circuits,
    [provider]: {
      provider,
      openedAt: new Date(now).toISOString(),
      openUntil: new Date(now + hours * 3600000).toISOString(),
      reason: String(reason || category || "provider_blocked"),
      category: category || null,
      error: error ? String(error).slice(0, 300) : null,
      tripCount: Number(previous.tripCount || 0) + 1,
    },
  };
}

export function saveProviderCircuits(root, circuits, { generatedAt = new Date().toISOString() } = {}) {
  const file = providerCircuitPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ schemaVersion: "provider-circuits-v1", generatedAt, providers: circuits || {} }, null, 2)}\n`);
  return file;
}
