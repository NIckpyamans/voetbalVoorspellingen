#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { gunzipSync } from "zlib";
import { buildR2ObjectKey, getR2Config, putR2Object } from "../shared/cloudflare-r2.js";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const BASE_URL = String(process.env.TRANSFERMARKT_DATASET_BASE_URL || "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data").replace(/\/$/, "");
const MAX_BYTES = Math.max(1, Number(process.env.TRANSFERMARKT_MAX_OBJECT_BYTES || 512 * 1024 * 1024));
const DATASETS = ["clubs", "players", "games", "appearances", "game_events", "game_lineups", "transfers", "player_valuations"];
const OUTPUT = path.join(ROOT, "data", "transfermarkt-compact-profiles.json");

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export function normalizeClubName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|afc|cf|sc|club|fk|sv|ac|as)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function readCatalogTeams() {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "competition-catalog.json"), "utf8"));
  return [...new Set((catalog.competitions || []).flatMap((competition) => competition.teams || []).map(String))];
}

function mapToFollowedClub(clubName, followedNames) {
  const wanted = normalizeClubName(clubName);
  const exact = followedNames.find((name) => normalizeClubName(name) === wanted);
  if (exact) return exact;
  return followedNames.find((name) => {
    const candidate = normalizeClubName(name);
    return candidate.length >= 5 && wanted.length >= 5 && (candidate.includes(wanted) || wanted.includes(candidate));
  }) || null;
}

function compactProfiles(clubRows, playerRows) {
  const followedNames = readCatalogTeams();
  const clubs = {};
  const providerToFollowed = new Map();
  for (const row of clubRows) {
    const followedName = mapToFollowedClub(row.name, followedNames);
    if (!followedName || !row.club_id) continue;
    providerToFollowed.set(String(row.club_id), followedName);
    clubs[normalizeClubName(followedName)] = {
      provider: "transfermarkt-datasets",
      providerClubId: String(row.club_id),
      teamName: followedName,
      providerTeamName: row.name,
      competitionId: row.domestic_competition_id || null,
      squadSize: Number(row.squad_size || 0) || null,
      totalMarketValue: Number(row.total_market_value || 0) || null,
      players: [],
    };
  }
  for (const row of playerRows) {
    const followedName = providerToFollowed.get(String(row.current_club_id || ""));
    if (!followedName) continue;
    const club = clubs[normalizeClubName(followedName)];
    club.players.push({
      id: row.player_id ? `transfermarkt:${row.player_id}` : null,
      name: row.name || row.player_name || "",
      position: row.sub_position || row.position || "",
      nationality: row.country_of_citizenship || "",
      dateBorn: row.date_of_birth || null,
      preferredFoot: row.foot || null,
      heightCm: Number(row.height_in_cm || 0) || null,
      marketValueEur: Number(row.market_value_in_eur || 0) || null,
      highestMarketValueEur: Number(row.highest_market_value_in_eur || 0) || null,
      contractExpiration: row.contract_expiration_date || null,
      source: "Transfermarkt Datasets CC0 export",
      sources: ["Transfermarkt Datasets CC0 export"],
      availability: "onbekend",
      status: "onbekend",
    });
  }
  for (const club of Object.values(clubs)) {
    club.players = club.players.filter((player) => player.name).sort((a, b) => Number(b.marketValueEur || 0) - Number(a.marketValueEur || 0));
    club.playerCount = club.players.length;
  }
  return clubs;
}

async function fetchDataset(name) {
  const url = `${BASE_URL}/${name}.csv.gz`;
  const response = await fetch(url, { headers: { Accept: "application/gzip", "User-Agent": "voetbalvoorspellingen-dataset-sync/1.0" } });
  if (!response.ok) throw new Error(`${name} download failed: HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_BYTES) return { name, url, skipped: true, reason: "object_too_large", declaredSize };
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_BYTES) return { name, url, skipped: true, reason: "object_too_large", bytes: body.length };
  return { name, url, body, bytes: body.length, hash: crypto.createHash("sha256").update(body).digest("hex") };
}

async function main() {
  const r2 = getR2Config();
  const downloads = [];
  let clubRows = [];
  let playerRows = [];
  for (const name of DATASETS) {
    try {
      const dataset = await fetchDataset(name);
      if (!dataset.body) {
        downloads.push(dataset);
        continue;
      }
      const key = buildR2ObjectKey(r2, `external/transfermarkt/latest/${name}.csv.gz`);
      const upload = APPLY && r2.configured
        ? await putR2Object({ config: r2, key, body: dataset.body, contentType: "application/gzip", metadata: { source: "dcaribou-transfermarkt-datasets", sha256: dataset.hash } })
        : { ok: false, skipped: true, reason: APPLY ? "r2_not_configured" : "dry_run" };
      if (name === "clubs") clubRows = parseCsv(gunzipSync(dataset.body).toString("utf8"));
      if (name === "players") playerRows = parseCsv(gunzipSync(dataset.body).toString("utf8"));
      downloads.push({ name, url: dataset.url, bytes: dataset.bytes, hash: dataset.hash, objectKey: key, upload });
    } catch (error) {
      downloads.push({ name, error: error?.message || String(error) });
    }
  }
  const clubs = compactProfiles(clubRows, playerRows);
  const report = {
    schemaVersion: "transfermarkt-compact-v1",
    generatedAt: new Date().toISOString(),
    source: "dcaribou/transfermarkt-datasets",
    license: "CC0-1.0 repository export; retain source lineage",
    r2Configured: r2.configured,
    followedClubsMatched: Object.keys(clubs).length,
    playersMatched: Object.values(clubs).reduce((sum, club) => sum + club.players.length, 0),
    clubs,
    downloads,
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report)}\n`);
  if (APPLY && r2.configured) {
    await putR2Object({
      config: r2,
      key: buildR2ObjectKey(r2, "external/transfermarkt/latest/compact-profiles.json"),
      body: `${JSON.stringify(report)}\n`,
      contentType: "application/json",
      metadata: { source: "dcaribou-transfermarkt-datasets", profileCount: String(report.followedClubsMatched) },
    });
  }
  console.log(JSON.stringify({ ...report, clubs: undefined }, null, 2));
  if (!clubRows.length || !playerRows.length) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
