import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentHash, stableJson, writeJsonAtomic } from "../../shared/data-publication.js";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("data publication primitives", () => {
  it("creates stable hashes independent of object key insertion order", () => {
    expect(stableJson({ b: 2, a: 1 })).toBe(stableJson({ a: 1, b: 2 }));
    expect(contentHash({ b: 2, a: 1 })).toBe(contentHash({ a: 1, b: 2 }));
  });

  it("atomically publishes valid JSON and returns its integrity metadata", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "data-publication-"));
    temporaryDirectories.push(directory);
    const destination = path.join(directory, "nested", "snapshot.json");
    const payload = { status: "ok", nested: { b: 2, a: 1 } };
    const result = writeJsonAtomic(destination, payload, { pretty: true });
    expect(JSON.parse(fs.readFileSync(destination, "utf8"))).toEqual(payload);
    expect(result.hash).toBe(contentHash(payload));
    expect(fs.readdirSync(path.dirname(destination))).toEqual(["snapshot.json"]);
  });
});
