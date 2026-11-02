import { buildR2ObjectKey, getR2Object, putR2Object } from "../../shared/cloudflare-r2.js";

// Het gratis OddsPapi-plan geeft 250 requests per maand. De teller staat in R2 en
// niet in een gecommit bestand, zodat elke workflow-run hem ziet, ook als de run
// halverwege stopt of er meerdere runs tegelijk lopen.
export const ODDSPAPI_USAGE_R2_KEY = "oddspapi/usage.json";
export const ODDSPAPI_MONTHLY_LIMIT_DEFAULT = 250;
export const ODDSPAPI_MONTHLY_RESERVE_DEFAULT = 25;
export const ODDSPAPI_MAX_REQUESTS_PER_RUN_DEFAULT = 2;

export function oddspapiMonthId(date = new Date()) {
  const parsed = date instanceof Date ? date : new Date(date);
  const iso = Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
  return iso.slice(0, 7);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function oddspapiMonthlyLimit(env = process.env) {
  return Math.max(1, Math.floor(finite(env.ODDSPAPI_MONTHLY_LIMIT, ODDSPAPI_MONTHLY_LIMIT_DEFAULT)));
}

export function oddspapiMonthlyReserve(env = process.env) {
  return Math.max(0, Math.floor(finite(env.ODDSPAPI_MONTHLY_RESERVE, ODDSPAPI_MONTHLY_RESERVE_DEFAULT)));
}

export function oddspapiMaxRequestsPerRun(env = process.env) {
  return Math.max(1, Math.floor(finite(env.ODDSPAPI_MAX_REQUESTS_PER_RUN, ODDSPAPI_MAX_REQUESTS_PER_RUN_DEFAULT)));
}

export function emptyOddspapiUsage(month = oddspapiMonthId()) {
  return { schemaVersion: "oddspapi-usage-v1", month, requests: 0, runs: 0, preferredBookmaker: null, updatedAt: null };
}

export async function loadOddspapiUsage({ config, getObject = getR2Object, month = oddspapiMonthId() }) {
  const key = buildR2ObjectKey(config, ODDSPAPI_USAGE_R2_KEY);
  const object = await getObject({ config, key }).catch(() => null);
  let stored = null;
  if (object?.ok) {
    try {
      stored = JSON.parse(object.body.toString("utf8"));
    } catch {
      stored = null;
    }
  }
  // Een teller van vorige maand telt niet mee; de maandwissel reset hem.
  const usage = stored && stored.month === month ? { ...emptyOddspapiUsage(month), ...stored } : emptyOddspapiUsage(month);
  return { usage, key, stored };
}

// reserve blijft ongemoeid zodat een handmatige meting of een inhaalslag altijd
// nog kan, ook als de cron de maand bijna heeft volgemaakt.
export function oddspapiAllowance(usage, env = process.env) {
  const limit = oddspapiMonthlyLimit(env);
  const reserve = oddspapiMonthlyReserve(env);
  const used = Math.max(0, Math.floor(finite(usage?.requests, 0)));
  const remaining = Math.max(0, limit - reserve - used);
  return {
    month: usage?.month || oddspapiMonthId(),
    limit,
    reserve,
    used,
    remaining,
    perRunCap: Math.min(oddspapiMaxRequestsPerRun(env), remaining),
  };
}

export async function saveOddspapiUsage({ config, putObject = putR2Object, usage }) {
  const key = buildR2ObjectKey(config, ODDSPAPI_USAGE_R2_KEY);
  const payload = { ...usage, updatedAt: new Date().toISOString() };
  await putObject({
    config,
    key,
    body: `${JSON.stringify(payload, null, 2)}\n`,
    contentType: "application/json",
    metadata: { month: String(payload.month || "") },
  });
  return payload;
}