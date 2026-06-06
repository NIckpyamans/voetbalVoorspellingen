import crypto from "crypto";
import { setCorsHeaders } from "../shared/cors.js";
import { databaseConfigured, getSql } from "../shared/database.js";

const ALLOWED_CATEGORIES = new Set(["weather", "h2h", "xg", "oddsHistory", "seasonReset"]);

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
  if (!databaseConfigured()) return res.status(503).json({ ok: false, error: "database_not_configured" });

  const body = await readBody(req).catch(() => null);
  const category = String(body?.category || "");
  const competitionId = String(body?.competitionId || "").slice(0, 160);
  const competitionLabel = String(body?.competitionLabel || "").slice(0, 240);
  if (!ALLOWED_CATEGORIES.has(category) || (!competitionId && !competitionLabel)) {
    return res.status(400).json({ ok: false, error: "invalid_repair_request" });
  }

  const requestId = `repair_${crypto.createHash("sha1").update(`${competitionId}|${competitionLabel}|${category}`).digest("hex").slice(0, 20)}`;
  const sql = getSql();
  const [row] = await sql.query(
    `
      insert into coverage_repair_requests (
        request_id, competition_id, competition_label, category, status, requested_by
      )
      values ($1, nullif($2, ''), $3, $4, 'pending', $5)
      on conflict (request_id) do update set
        status = case when coverage_repair_requests.status = 'running' then 'running' else 'pending' end,
        requested_at = case when coverage_repair_requests.status = 'running' then coverage_repair_requests.requested_at else now() end,
        completed_at = case when coverage_repair_requests.status = 'running' then coverage_repair_requests.completed_at else null end,
        last_error = null
      returning request_id, status, requested_at
    `,
    [requestId, competitionId, competitionLabel, category, String(req.headers?.["user-agent"] || "").slice(0, 240)]
  );
  return res.status(202).json({ ok: true, queued: true, request: row });
}
