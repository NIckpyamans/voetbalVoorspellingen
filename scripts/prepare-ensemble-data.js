#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const SNAPSHOT_FILE = path.join(ROOT, "training", "training-snapshot.json");
const EXPORT_FILE = path.join(ROOT, "training", "catboost-ready.json");
const CONFIG_FILE = path.join(ROOT, "training", "ensemble-config.json");

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function main() {
  const snapshot = readJsonSafe(SNAPSHOT_FILE, { rows: [] });
  const config = readJsonSafe(CONFIG_FILE, { primaryFeatures: [] });
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];

  const exportRows = rows
    .filter((row) => row.featureVector && row.label)
    .map((row) => {
      const features = {};
      for (const key of config.primaryFeatures || []) {
        features[key] = Number(row.featureVector?.[key] || 0);
      }

      return {
        matchId: row.matchId,
        date: row.date,
        league: row.league,
        label: row.label,
        features,
      };
    });

  fs.mkdirSync(path.dirname(EXPORT_FILE), { recursive: true });
  fs.writeFileSync(
    EXPORT_FILE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        modelTarget: config.target || "1X2",
        totalRows: exportRows.length,
        rows: exportRows,
      },
      null,
      2
    )
  );

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        totalRows: exportRows.length,
        output: EXPORT_FILE,
      },
      null,
      2
    ) + "\n"
  );
}

main();
