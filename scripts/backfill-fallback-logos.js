#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { isGeneratedLogoUrl, logoLookupNames, normalizeClubName } from "../shared/clubLogos.js";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const LIMIT = Math.max(1, Number(process.env.LOGO_BACKFILL_LIMIT || 80));
const REPORT_PATH = path.join(ROOT, "monitor", "logo-backfill-report.json");
const CACHE_PATH = path.join(ROOT, "monitor", "logo-resolution-cache.json");
const USER_AGENT = "voetbalvoorspellingen-logo-backfill/1.0";
const DELAY_MS = Math.max(0, Number(process.env.LOGO_BACKFILL_DELAY_MS || 1600));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function uniq(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function isLikelyImageUrl(value) {
  return /^https?:\/\//i.test(String(value || "")) && !isGeneratedLogoUrl(value);
}

async function fetchJson(url) {
  if (DELAY_MS) await sleep(DELAY_MS);
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") || 30);
    await sleep(Math.min(120_000, Math.max(30_000, retryAfter * 1000)));
    const retry = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!retry.ok) return null;
    return retry.json();
  }
  if (!response.ok) return null;
  return response.json();
}

async function imageReachable(url) {
  if (!isLikelyImageUrl(url)) return false;
  for (const method of ["HEAD", "GET"]) {
    try {
      const response = await fetch(url, {
        method,
        headers: { Accept: "image/png,image/webp,image/*", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
      const type = response.headers.get("content-type") || "";
      if (response.ok && (type.startsWith("image/") || method === "HEAD")) return true;
    } catch {
      // Try the next method/source.
    }
  }
  return false;
}

async function resolveTheSportsDbLogo(teamName) {
  for (const name of logoLookupNames(teamName)) {
    const payload = await fetchJson(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(name)}`).catch(() => null);
    const teams = Array.isArray(payload?.teams) ? payload.teams : [];
    const soccer = teams.find((team) => String(team?.strSport || "").toLowerCase().includes("soccer")) || teams[0];
    const badge = String(soccer?.strBadge || soccer?.strTeamBadge || soccer?.strLogo || "").trim();
    if (await imageReachable(badge)) {
      return { url: badge, source: "thesportsdb", matchedName: name };
    }
  }
  return null;
}

async function resolveProviderLogo(teamName, teamId, dataSource) {
  const source = String(dataSource || "").toLowerCase();
  const id = String(teamId || "").trim();
  const candidates = [];
  if (/^\d+$/.test(id) && source.includes("sofa")) {
    candidates.push({ url: `https://api.sofascore.app/api/v1/team/${id}/image`, source: "sofascore-id" });
  }
  if (/^\d+$/.test(id) && source.includes("espn")) {
    candidates.push({ url: `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`, source: "espn-id" });
  }
  for (const candidate of candidates) {
    if (await imageReachable(candidate.url)) return { ...candidate, matchedName: teamName };
  }
  return null;
}

async function resolveLogo(teamName, teamId, dataSource) {
  const cache = resolveLogo.cache || (resolveLogo.cache = readJsonSafe(CACHE_PATH, {}));
  const key = normalizeClubName(teamName) || String(teamName || "").toLowerCase();
  if (cache[key]?.url && (await imageReachable(cache[key].url))) return cache[key];
  return (await resolveTheSportsDbLogo(teamName)) || (await resolveProviderLogo(teamName, teamId, dataSource));
}

function collectLogoMisses(segments) {
  const teams = new Map();
  for (const segment of segments) {
    for (const match of Array.isArray(segment.payload) ? segment.payload : []) {
      for (const side of ["home", "away"]) {
        const name = side === "home" ? match.homeTeamName || match.homeTeam : match.awayTeamName || match.awayTeam;
        const logo = side === "home" ? match.homeLogo || match.homeTeamLogo : match.awayLogo || match.awayTeamLogo;
        if (!name || (logo && !isGeneratedLogoUrl(logo))) continue;
        const key = normalizeClubName(name) || String(name).toLowerCase();
        const row = teams.get(key) || {
          key,
          name: String(name),
          teamIds: new Set(),
          dataSources: new Set(),
          seen: 0,
          aliases: logoLookupNames(name).slice(0, 8),
        };
        row.seen += 1;
        const teamId = side === "home" ? match.homeTeamId : match.awayTeamId;
        if (teamId) row.teamIds.add(String(teamId));
        if (match.dataSource || match.source) row.dataSources.add(String(match.dataSource || match.source));
        teams.set(key, row);
      }
    }
  }
  return [...teams.values()]
    .map((row) => ({ ...row, teamIds: [...row.teamIds], dataSources: [...row.dataSources] }))
    .sort((a, b) => b.seen - a.seen || a.name.localeCompare(b.name))
    .slice(0, LIMIT);
}

function applyResolvedLogos(segments, resolvedByKey) {
  let updatedMatches = 0;
  let updatedLogoFields = 0;
  const changedSegments = [];
  for (const segment of segments) {
    let changed = false;
    const payload = (Array.isArray(segment.payload) ? segment.payload : []).map((match) => {
      const next = { ...match };
      let matchChanged = false;
      for (const side of ["home", "away"]) {
        const name = side === "home" ? next.homeTeamName || next.homeTeam : next.awayTeamName || next.awayTeam;
        const key = normalizeClubName(name) || String(name || "").toLowerCase();
        const resolved = resolvedByKey.get(key);
        if (!resolved?.url) continue;
        const logoKey = side === "home" ? "homeLogo" : "awayLogo";
        const altLogoKey = side === "home" ? "homeTeamLogo" : "awayTeamLogo";
        const current = next[logoKey] || next[altLogoKey] || "";
        if (current && !isGeneratedLogoUrl(current)) continue;
        next[logoKey] = resolved.url;
        next[altLogoKey] = resolved.url;
        changed = true;
        matchChanged = true;
        updatedLogoFields += 1;
      }
      if (matchChanged) updatedMatches += 1;
      return next;
    });
    if (changed) changedSegments.push({ ...segment, payload });
  }
  return { changedSegments, updatedMatches, updatedLogoFields };
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  if (!sql) throw new Error("DATABASE_URL/POSTGRES_URL ontbreekt");

  const segments = await sql.query(
    "select segment_key, payload from app_state_segments where segment_group = 'matches' order by segment_key"
  );
  const misses = collectLogoMisses(segments);
  const resolved = [];
  const unresolved = [];
  const resolvedByKey = new Map();

  for (const team of misses) {
    const teamIds = uniq(team.teamIds);
    const sources = uniq(team.dataSources);
    const result = await resolveLogo(team.name, teamIds[0], sources[0]);
    if (result?.url) {
      const row = { ...team, ...result };
      resolved.push(row);
      resolvedByKey.set(team.key, row);
      const cache = resolveLogo.cache || {};
      cache[team.key] = { url: result.url, source: result.source, matchedName: result.matchedName, cachedAt: new Date().toISOString() };
      fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
      fs.writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
    } else {
      unresolved.push(team);
    }
  }

  const update = applyResolvedLogos(segments, resolvedByKey);
  if (APPLY) {
    for (const segment of update.changedSegments) {
      await sql.query(
        `update app_state_segments
         set payload = $2::jsonb, payload_bytes = $3, updated_at = now()
         where segment_group = 'matches' and segment_key = $1`,
        [segment.segment_key, JSON.stringify(segment.payload), Buffer.byteLength(JSON.stringify(segment.payload), "utf8")]
      );
    }
  }

  const report = {
    ok: true,
    apply: APPLY,
    generatedAt: new Date().toISOString(),
    checkedTeams: misses.length,
    resolvedTeams: resolved.length,
    unresolvedTeams: unresolved.length,
    changedSegments: update.changedSegments.length,
    updatedMatches: update.updatedMatches,
    updatedLogoFields: update.updatedLogoFields,
    resolved: resolved.slice(0, 80),
    unresolved: unresolved.slice(0, 80),
    nextAction: APPLY
      ? "Controleer /api/logo-health; resterende fallbacks hebben extra alias of andere bron nodig."
      : "Run met --apply om gevonden echte logo's in app_state_segments te zetten.",
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
