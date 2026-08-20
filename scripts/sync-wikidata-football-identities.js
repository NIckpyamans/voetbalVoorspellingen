#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "data", "wikidata-football-identities.json");
const MAX_TEAMS = Math.max(1, Number(process.env.WIKIDATA_TEAM_LIMIT || 260));
const USER_AGENT = "voetbalvoorspellingen/1.0 (cached football identity enrichment)";

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function wikimedia(params, attempt = 1) {
  const url = new URL("https://www.wikidata.org/w/api.php");
  for (const [key, value] of Object.entries({ format: "json", origin: "*", ...params })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (response.status === 429) {
    if (attempt >= 4) throw new Error("Wikidata HTTP 429 na 4 pogingen");
    await sleep(Math.min(30, Number(response.headers.get("retry-after") || 5)) * 1000);
    return wikimedia(params, attempt + 1);
  }
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  return response.json();
}

function claimEntity(entity, property) { return entity?.claims?.[property]?.[0]?.mainsnak?.datavalue?.value?.id || null; }
function coordinates(entity) {
  const value = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
  return value && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) ? { latitude: value.latitude, longitude: value.longitude } : null;
}

async function entities(ids) {
  if (!ids.length) return {};
  const result = await wikimedia({ action: "wbgetentities", ids: ids.join("|"), props: "labels|aliases|claims", languages: "en|nl" });
  return result.entities || {};
}

async function main() {
  const catalog = readJson(path.join(ROOT, "config", "competition-catalog.json"), {});
  const names = [...new Set((catalog.competitions || []).flatMap((competition) => competition.teams || []))].slice(0, MAX_TEAMS);
  const found = [];
  for (const name of names) {
    const result = await wikimedia({ action: "wbsearchentities", search: name, language: "en", uselang: "en", type: "item", limit: "5" }).catch(() => ({ search: [] }));
    const candidate = (result.search || []).find((item) => /football|soccer|association/i.test(`${item.description || ""}`)) || result.search?.[0];
    if (candidate?.id) found.push({ teamName: name, wikidataId: candidate.id });
    await sleep(80);
  }
  const entityMap = {};
  for (let index = 0; index < found.length; index += 40) Object.assign(entityMap, await entities(found.slice(index, index + 40).map((item) => item.wikidataId)));
  const venueIds = [...new Set(found.map((item) => claimEntity(entityMap[item.wikidataId], "P115")).filter(Boolean))];
  const venueMap = {};
  for (let index = 0; index < venueIds.length; index += 40) Object.assign(venueMap, await entities(venueIds.slice(index, index + 40)));
  const teams = found.map((item) => {
    const entity = entityMap[item.wikidataId] || {};
    const venueId = claimEntity(entity, "P115");
    const venue = venueMap[venueId] || {};
    return {
      ...item,
      label: entity.labels?.en?.value || entity.labels?.nl?.value || item.teamName,
      aliases: [...new Set([...(entity.aliases?.en || []), ...(entity.aliases?.nl || [])].map((alias) => alias.value).filter(Boolean))],
      countryId: claimEntity(entity, "P17"),
      venue: venueId ? { wikidataId: venueId, name: venue.labels?.en?.value || venue.labels?.nl?.value || null, coordinates: coordinates(venue) } : null,
    };
  });
  const report = { schemaVersion: "wikidata-football-identities-v1", generatedAt: new Date().toISOString(), license: "CC0", requested: names.length, matched: teams.length, teams };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report)}\n`);
  console.log(JSON.stringify({ ...report, teams: undefined }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((error) => { console.error(error); process.exit(1); });
