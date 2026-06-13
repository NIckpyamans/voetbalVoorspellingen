#!/usr/bin/env node

import fs from "fs";
import path from "path";

const root = process.cwd();
const catalogPath = path.join(root, "config", "competition-catalog.json");
const indexPath = path.join(root, "data", "competitions", "index.json");
const force = process.argv.includes("--force");

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const previousIndex = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, "utf8")) : { competitions: [] };
const generatedAt = Date.now();
const plannedEntries = [];
const existingCurrentByKey = new Map(
  (previousIndex.competitions || [])
    .filter((item) => item.season === catalog.season)
    .map((item) => [item.key, item])
);

for (const competition of catalog.competitions || []) {
  const relativePath = `data/competitions/${catalog.season}/${competition.slug}.json`;
  const filePath = path.join(root, ...relativePath.split("/"));
  const archive = {
    key: `${catalog.season}__${competition.slug}`,
    season: catalog.season,
    league: competition.league,
    slug: competition.slug,
    status: "planned",
    competitionType: competition.type,
    format: competition.format,
    membershipStatus: competition.membershipStatus,
    expectedTeams: competition.expectedTeams,
    generatedAt,
    teamCount: (competition.teams || []).length,
    teams: competition.teams || [],
    standings: [],
    totalMatches: 0,
    finishedMatches: 0,
    scheduledMatches: 0,
    liveMatches: 0,
    matches: [],
    previousSeason: "2025-2026",
    source: "config/competition-catalog.json",
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (force || !fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify(archive, null, 2));
  const plannedEntry = {
    key: archive.key,
    season: archive.season,
    league: archive.league,
    slug: archive.slug,
    status: archive.status,
    totalMatches: 0,
    finishedMatches: 0,
    scheduledMatches: 0,
    liveMatches: 0,
    firstMatchDate: null,
    lastMatchDate: null,
    teamCount: archive.teamCount,
    membershipStatus: archive.membershipStatus,
    expectedTeams: archive.expectedTeams,
    archiveFile: relativePath,
  };
  const existing = existingCurrentByKey.get(archive.key);
  plannedEntries.push(existing && (existing.totalMatches > 0 || existing.status !== "planned") ? existing : plannedEntry);
}

const historical = (previousIndex.competitions || [])
  .filter((item) => item.season !== catalog.season)
  .map((item) => {
    const canClose = Number(item.liveMatches || 0) === 0 && Number(item.scheduledMatches || 0) === 0;
    if (!canClose || item.status === "closed") return item;
    const archivePath = item.archiveFile ? path.join(root, ...item.archiveFile.split("/")) : null;
    if (archivePath && fs.existsSync(archivePath)) {
      const archive = JSON.parse(fs.readFileSync(archivePath, "utf8"));
      fs.writeFileSync(archivePath, JSON.stringify({ ...archive, status: "closed", closedAt: generatedAt }));
    }
    return { ...item, status: "closed", closedAt: generatedAt };
  });
const competitions = [...plannedEntries, ...historical];
const index = {
  generatedAt,
  activeSeason: catalog.season,
  totalCompetitions: competitions.length,
  activeCount: competitions.filter((item) => item.status === "active").length,
  plannedCount: competitions.filter((item) => item.status === "planned").length,
  closedCount: competitions.filter((item) => item.status === "closed").length,
  competitions,
};
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log(JSON.stringify({ ok: true, season: catalog.season, planned: plannedEntries.length, historical: historical.length, force }, null, 2));
