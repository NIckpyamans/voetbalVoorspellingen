import crypto from "crypto";

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function sha256(value, encoding = "hex") {
  return crypto.createHash("sha256").update(value).digest(encoding);
}

function encodePathPart(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizePrefix(value) {
  return String(value || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");
}

export function getR2Config(env = process.env) {
  const accountId = env.CLOUDFLARE_R2_ACCOUNT_ID || env.R2_ACCOUNT_ID || "";
  const accessKeyId = env.CLOUDFLARE_R2_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY || "";
  const bucket = env.CLOUDFLARE_R2_BUCKET || env.R2_BUCKET || "";
  const endpoint =
    env.CLOUDFLARE_R2_ENDPOINT ||
    env.R2_ENDPOINT ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const prefix = normalizePrefix(env.CLOUDFLARE_R2_PREFIX || env.R2_PREFIX || "voetbalvoorspellingen/raw");
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: endpoint.replace(/\/+$/g, ""),
    prefix,
    region: env.CLOUDFLARE_R2_REGION || env.R2_REGION || "auto",
    service: "s3",
    configured: Boolean(accessKeyId && secretAccessKey && bucket && endpoint),
  };
}

export function buildR2ObjectKey(config, relativeKey) {
  const prefix = normalizePrefix(config?.prefix || "");
  const key = normalizePrefix(relativeKey);
  return prefix ? `${prefix}/${key}` : key;
}

function buildSignedR2Request({ config, key, method = "GET", body = Buffer.alloc(0), contentType = null, metadata = {} }) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ""), "utf8");
  const url = new URL(config.endpoint);
  const objectPath = `/${encodePathPart(config.bucket)}/${String(key).split("/").map(encodePathPart).join("/")}`;
  const target = `${config.endpoint}${objectPath}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(bytes);
  const metadataHeaders = Object.fromEntries(
    Object.entries(metadata || {})
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
      .map(([name, value]) => [`x-amz-meta-${String(name).toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`, String(value)])
  );
  const headers = {
    ...(contentType ? { "content-type": contentType } : {}),
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...metadataHeaders,
  };
  const canonicalHeaders = Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}:${String(value).trim()}\n`)
    .join("");
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalRequest = [method, objectPath, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/${config.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, config.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign, "hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { target, bytes, headers: { ...headers, authorization } };
}

export async function putR2Object({ config = getR2Config(), key, body, contentType = "application/octet-stream", metadata = {} }) {
  if (!config.configured) {
    return { ok: false, skipped: true, reason: "r2_not_configured" };
  }
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ""), "utf8");
  const signed = buildSignedR2Request({ config, key, method: "PUT", body: bytes, contentType, metadata });
  const response = await fetch(signed.target, {
    method: "PUT",
    headers: {
      ...signed.headers,
      "content-length": String(bytes.length),
    },
    body: bytes,
  });
  const responseText = response.ok ? "" : await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`R2 upload failed ${response.status} ${response.statusText}: ${responseText.slice(0, 500)}`);
  }
  return {
    ok: true,
    skipped: false,
    bucket: config.bucket,
    key,
    bytes: bytes.length,
    etag: response.headers.get("etag"),
    endpoint: config.endpoint,
  };
}

export async function getR2Object({ config = getR2Config(), key }) {
  if (!config.configured) return { ok: false, skipped: true, reason: "r2_not_configured" };
  const signed = buildSignedR2Request({ config, key, method: "GET" });
  const response = await fetch(signed.target, { method: "GET", headers: signed.headers });
  if (response.status === 404) return { ok: false, skipped: true, reason: "not_found" };
  const responseText = response.ok ? null : await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`R2 download failed ${response.status} ${response.statusText}: ${String(responseText || "").slice(0, 500)}`);
  }
  return {
    ok: true,
    skipped: false,
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
    etag: response.headers.get("etag"),
    bytes: Number(response.headers.get("content-length") || 0),
  };
}
