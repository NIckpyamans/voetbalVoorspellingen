#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const distAssets = path.join(process.cwd(), "dist", "assets");
const legacyAssets = {
  js: ["index-B02sB06v.js"],
  css: ["index-D31vjibT.css"],
};

function latestAsset(extension) {
  const prefix = "index-";
  const suffix = `.${extension}`;
  const files = fs
    .readdirSync(distAssets)
    .filter((file) => file.startsWith(prefix) && file.endsWith(suffix))
    .map((file) => ({
      file,
      mtime: fs.statSync(path.join(distAssets, file)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (!files.length) {
    throw new Error(`Geen ${suffix} asset gevonden in ${distAssets}`);
  }

  return files[0].file;
}

for (const [extension, legacyNames] of Object.entries(legacyAssets)) {
  const source = latestAsset(extension);
  for (const legacyName of legacyNames) {
    if (legacyName === source) continue;
    fs.copyFileSync(path.join(distAssets, source), path.join(distAssets, legacyName));
    console.log(`[copy-legacy-assets] ${legacyName} -> ${source}`);
  }
}
