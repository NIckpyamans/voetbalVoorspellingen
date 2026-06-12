#!/usr/bin/env node

import fs from "fs";
import path from "path";

const root = process.cwd();
const catalogPath = path.join(root, "config", "competition-catalog.json");
const indexPath = path.join(root, "data", "competitions", "index.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const previousSeason = [...new Set((index.competitions || []).map((item) => item.season))]
  .filter((season) => season !== catalog.season)
  .sort()
  .at(-1);
let updated = 0;

for (const competition of catalog.competitions || []) {
  if ((competition.teams || []).length >= Number(competition.expectedTeams || 0)) continue;
  const sourceEntry = (index.competitions || []).find((item) =>
    item.season === previousSeason && item.slug === competition.slug && item.archiveFile
  );
  if (!sourceEntry) continue;
  const archivePath = path.join(root, ...String(sourceEntry.archiveFile).split("/"));
  if (!fs.existsSync(archivePath)) continue;
  const archive = JSON.parse(fs.readFileSync(archivePath, "utf8"));
  const teams = [...new Set((archive.teams || archive.standings || []).map((item) =>
    String(item?.name || item?.teamName || item || "").trim()
  ).filter(Boolean))].sort();
  if (teams.length !== Number(competition.expectedTeams || 0)) continue;
  competition.teams = teams;
  competition.membershipStatus = "previous_season_baseline";
  competition.membershipSource = sourceEntry.archiveFile;
  updated += 1;
}

catalog.generatedAt = new Date().toISOString();
fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
console.log(JSON.stringify({ ok: true, season: catalog.season, previousSeason, updated }, null, 2));
