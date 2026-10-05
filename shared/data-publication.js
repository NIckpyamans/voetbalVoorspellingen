import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

export function writeTextAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const text = String(value);
  try {
    fs.writeFileSync(temporaryPath, text, { flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* Preserve the original publication error. */ }
    throw error;
  }
  return { bytes: Buffer.byteLength(text), hash: contentHash(text) };
}

export function writeJsonAtomic(filePath, value, { pretty = false } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const serialized = `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`;
  try {
    fs.writeFileSync(temporaryPath, serialized, { flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* Preserve the original publication error. */ }
    throw error;
  }
  return { bytes: Buffer.byteLength(serialized), hash: contentHash(value) };
}
