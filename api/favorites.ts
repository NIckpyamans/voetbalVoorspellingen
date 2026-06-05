import crypto from "crypto";
import { setCorsHeaders } from "../shared/cors.js";
import { databaseConfigured, getSql } from "../shared/database.js";

function digest(value: unknown) {
  return crypto.createHash("sha1").update(JSON.stringify(value || "")).digest("hex");
}

async function readBody(req: any) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(req, res, { methods: "POST, OPTIONS" });
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  if (!databaseConfigured()) return res.status(202).json({ ok: true, stored: false, reason: "database_not_configured" });

  const body = await readBody(req).catch(() => null);
  const favorites = Array.isArray(body?.favorites)
    ? body.favorites.map((value: unknown) => String(value || "").trim()).filter(Boolean).slice(0, 200)
    : [];
  const changedTeam = body?.changedTeam && typeof body.changedTeam === "object" ? body.changedTeam : null;
  const payload = {
    favorites,
    changedTeam,
    userAgent: String(req.headers?.["user-agent"] || "").slice(0, 240),
    receivedAt: new Date().toISOString(),
    note: "Client-side browser favorites sync for followed-club analysis context.",
  };
  const sql = getSql();
  await sql.query(
    `
      insert into source_records (
        source_record_id, provider, source_url, entity_type, entity_key, content_hash, trust_score, payload
      )
      values ($1, 'client-browser-favorites', '/api/favorites', 'followed_clubs', 'browser-localStorage', $2, 0.7, $3::jsonb)
      on conflict (source_record_id) do update set
        fetched_at = now(),
        content_hash = excluded.content_hash,
        payload = excluded.payload
    `,
    ["src_browser_favorites_latest", digest(payload), JSON.stringify(payload)]
  );
  return res.status(200).json({ ok: true, stored: true, favorites: favorites.length });
}
