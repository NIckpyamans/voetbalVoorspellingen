import crypto from "node:crypto";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import StreamJson from "stream-json";
import Assembler from "stream-json/Assembler.js";

// Parse dictionary records independently: never construct an unpacked month string.
// Only trusted, checksum-verified private ledger objects enter this reader.
export async function parseStreamingLedger(body, expectedHash, options = {}) {
  const maxBytes = options.maxBytes || 4 * 1024 ** 3;
  const maxRecordBytes = options.maxRecordBytes || 32 * 1024 ** 2;
  const hash = crypto.createHash("sha256");
  let bytes = 0, depth = 0, field = null, key = null, assembler = null, recordBytes = 0;
  const result = {};
  const dictionaries = new Set(["predictionSnapshots", "predictionSnapshotIndex", "postMatchReviews", "evaluations"]);
  const meter = new Transform({ transform(chunk, encoding, done) {
    bytes += chunk.length;
    if (bytes > maxBytes) return done(new Error("Streaming ledger exceeds total byte budget"));
    hash.update(chunk); done(null, chunk);
  }});
  const sink = new Writable({ objectMode: true, write(token, encoding, done) {
    try {
      const start = token.name === "startObject" || token.name === "startArray";
      const end = token.name === "endObject" || token.name === "endArray";
      if (token.name === "keyValue" && !assembler) {
        if (depth === 1) { field = token.value; if (dictionaries.has(field)) result[field] = {}; }
        else if (depth === 2 && dictionaries.has(field)) key = token.value;
      } else if (!assembler && depth === 2 && dictionaries.has(field) && key !== null && !end) {
        assembler = new Assembler(); recordBytes = 0;
      }
      if (assembler) {
        recordBytes += Buffer.byteLength(String(token.value ?? "")) + 1;
        if (recordBytes > maxRecordBytes) throw new Error("Ledger record exceeds byte budget");
        assembler.consume(token);
        if (assembler.done) { Object.defineProperty(result[field], key, { value: assembler.current, enumerable: true, configurable: true, writable: true }); assembler = null; key = null; }
      } else if (depth === 1 && /^(string|number|null|true|false)Value$/.test(token.name)) {
        const scalar = new Assembler(); scalar.consume(token); result[field] = scalar.current;
      }
      if (start) depth += 1;
      if (end) depth -= 1;
      done();
    } catch (error) { done(error); }
  }});
  const source = Readable.from([body]);
  const streams = [source];
  if (body[0] === 0x1f && body[1] === 0x8b) streams.push(createGunzip());
  streams.push(meter, StreamJson.parser({ streamKeys: false, streamStrings: false, streamNumbers: false }), sink);
  await pipeline(...streams);
  if (expectedHash && hash.digest("hex") !== expectedHash) throw new Error("R2 monthly ledger checksum mismatch");
  return result;
}

// Preserve the exact JSON structure/hash while gzip receives one record at a time.
export async function encodeStreamingLedger(ledger) {
  const hash = crypto.createHash("sha256");
  const chunks = [];
  function* jsonParts() {
    yield "{";
    let first = true;
    for (const [field, value] of Object.entries(ledger)) {
      if (!first) yield ","; first = false;
      yield JSON.stringify(field) + ":";
      if (value && typeof value === "object" && !Array.isArray(value)) {
        yield "{"; let firstRecord = true;
        for (const [key, record] of Object.entries(value)) {
          if (!firstRecord) yield ","; firstRecord = false;
          yield JSON.stringify(key) + ":" + JSON.stringify(record);
        }
        yield "}";
      } else yield JSON.stringify(value);
    }
    yield "}";
  }
  const meter = new Transform({ transform(chunk, encoding, done) { hash.update(chunk); done(null, chunk); } });
  await pipeline(Readable.from(jsonParts()), meter, createGzip({ level: 9 }), new Writable({ write(chunk, encoding, done) { chunks.push(chunk); done(); } }));
  return { body: Buffer.concat(chunks), sha256: hash.digest("hex") };
}
