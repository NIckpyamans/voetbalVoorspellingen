import { gunzipSync } from "zlib";
import { buildR2ObjectKey, getR2Config, getR2Object } from "./cloudflare-r2.js";

const memoryCache = new Map();
const TTL_MS = Number(process.env.DASHBOARD_R2_CACHE_TTL_MS || 60_000);

export async function readDashboardDayCache(dateKey) {
  if (process.env.DASHBOARD_R2_CACHE_ENABLED !== "true") return null;
  const cached = memoryCache.get(dateKey);
  if (cached && Date.now() - cached.ts < TTL_MS) return { ...cached.value, memoryCached: true };
  const config = getR2Config();
  if (!config.configured) return null;
  const key = buildR2ObjectKey(config, `dashboard-cache/days/${dateKey}.json.gz`);
  const object = await getR2Object({ config, key }).catch(() => null);
  if (!object?.ok || !object.body) return null;
  const value = JSON.parse(gunzipSync(object.body).toString("utf8"));
  const result = {
    ...value,
    source: value.source || "r2-dashboard-cache",
    r2Cache: { key, etag: object.etag, bytes: object.bytes || object.body.length },
  };
  memoryCache.set(dateKey, { ts: Date.now(), value: result });
  return result;
}
