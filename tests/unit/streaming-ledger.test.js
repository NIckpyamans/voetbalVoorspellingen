import { expect, it } from "vitest";
import crypto from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { parseStreamingLedger, encodeStreamingLedger } from "../../shared/streamingLedger.js";
it("roundtrips nested records, unicode, escaped strings and index arrays with identical JSON checksum", async () => {
  const ledger = { version: "v1", generatedAt: null, predictionSnapshots: { a: { predictionId: "a", text: 'München \" \n', nested: [null, true, false, 2.5, {}] }, empty: {} }, predictionSnapshotIndex: { m: ["a"] }, postMatchReviews: { m: { score: "1-0" } }, evaluations: {} };
  const encoded = await encodeStreamingLedger(ledger);
  expect(gunzipSync(encoded.body).toString()).toBe(JSON.stringify(ledger));
  expect(encoded.sha256).toBe(crypto.createHash("sha256").update(JSON.stringify(ledger)).digest("hex"));
  expect(await parseStreamingLedger(encoded.body, encoded.sha256)).toEqual(ledger);
  await expect(parseStreamingLedger(encoded.body, "bad")).rejects.toThrow("checksum");
  await expect(parseStreamingLedger(encoded.body, encoded.sha256, { maxBytes: 10 })).rejects.toThrow("budget");
  await expect(parseStreamingLedger(encoded.body, encoded.sha256, { maxRecordBytes: 10 })).rejects.toThrow("budget");
});
it("rejects truncated JSON rather than returning partial data", async () => {
  await expect(parseStreamingLedger(gzipSync('{"predictionSnapshots":{"a":'))).rejects.toThrow();
});
