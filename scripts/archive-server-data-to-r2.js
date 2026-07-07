#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { gzipSync } from "zlib";
import { buildR2ObjectKey, getR2Config, putR2Object } from "../shared/cloudflare-r2.js";

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();
const FILES = [
  "server_data.json",
  "data/meta.json",
  "data/standings.json",
].filter((file) => fs.existsSync(path.join(ROOT, file)));

function digest(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

function objectKey(relativePath, hash) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `exports/year=${year}/month=${month}/day=${day}/${relativePath.replace(/[\\/]+/g, "__")}-${stamp}-${hash}.json.gz`;
}

const r2Config = getR2Config();
const uploads = [];
for (const relativePath of FILES) {
  const absolutePath = path.join(ROOT, relativePath);
  const raw = fs.readFileSync(absolutePath);
  const compressed = gzipSync(raw, { level: 9 });
  const hash = digest(raw);
  const key = buildR2ObjectKey(r2Config, objectKey(relativePath, hash));
  let upload = null;
  if (APPLY && r2Config.configured) {
    upload = await putR2Object({
      config: r2Config,
      key,
      body: compressed,
      contentType: "application/json",
      metadata: {
        source: "repo-export",
        file: relativePath,
        uncompressedBytes: String(raw.length),
      },
    });
  }
  uploads.push({
    file: relativePath,
    bytes: raw.length,
    compressedBytes: compressed.length,
    objectKey: key,
    upload,
  });
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  mode: APPLY ? "apply" : "audit",
  r2Configured: r2Config.configured,
  files: uploads,
}, null, 2));
