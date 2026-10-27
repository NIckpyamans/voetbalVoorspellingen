#!/usr/bin/env node
// Bouwt data/market-odds.json: marktoddsparen uit gratis football-data.co.uk
// seizoens-CSV's, gekoppeld aan beoordeelde wedstrijden in de compacte
// wedstrijdopslag, zodat de marktbaseline op veel meer dan alleen de
// oddsAtPrediction-captures (7%) rust.
//
//   node scripts/build-market-odds.js            # ophaal wanneer >7 dagen oud of ontbreekt
//   node scripts/build-market-odds.js --fetch    # altijd ophalen
//   node scripts/build-market-odds.js --offline  # nooit ophalen, alleen rapporteren
//
// Fair-use: football-data.co.uk staat maximaal twee geautomatiseerde
// ophalingen per week toe voor niet-commercieel priv-gebruik. De 7-dagen-
// drempel houdt de workflow op maximaal een ophaling per week.
//
// Bij netwerkfouten blijft het bestaande bestand ongemoeid en eindigt het
// script zonder fout: de pipeline breekt nooit door een onbereikbare bron.

import fs from "node:fs";
import path from "node:path";
import { loadMatchStore } from "../shared/matchStore.js";
import {
  LEAGUE_CODE_BY_LEAGUE,
  MARKET_ODDS_SCHEMA,
  buildMarketOddsEntries,
  footballDataSeason,
  parseFootballDataCsv,
} from "../shared/marketOdds.js";

const dataDir = path.join(process.cwd(), "data");
const file = path.join(dataDir, "market-odds.json");
const FETCH = process.argv.includes("--fetch");
const OFFLINE = process.argv.includes("--offline");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readExisting() {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchRows(season, code) {
  const url = `https://www.football-data.co.uk/mmz4281/${season}/${code}.csv`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseFootballDataCsv(await response.text(), code);
}

async function main() {
  const existing = readExisting();
  const { store } = loadMatchStore(dataDir);
  const records = Object.values(store?.matches || {});

  // Alleen seizoenen en competities die nodig zijn voor de openstaande
  // koppelingen: dat scheelt URL's (en respecteert de fair-use-drempel).
  const neededSeasons = new Set();
  const neededCodes = new Set();
  for (const record of records) {
    if (!record || record.mk !== undefined) continue;
    if (typeof record.hit !== "boolean" || !record.ao) continue;
    const leagueCode = LEAGUE_CODE_BY_LEAGUE[record.lg];
    const season = footballDataSeason(record.d);
    if (leagueCode && season) {
      neededCodes.add(leagueCode);
      neededSeasons.add(season);
    }
  }

  const ageMs = existing?.fetchedAt ? Date.now() - Date.parse(existing.fetchedAt) : Infinity;
  const stale = ageMs > MAX_AGE_MS;
  const shouldFetch = !OFFLINE && (FETCH || !existing || stale);

  const status = {
    action: "kept",
    fetchedAt: existing?.fetchedAt || null,
    entries: Object.keys(existing?.entries || {}).length,
    neededSeasons: [...neededSeasons].sort(),
    neededCodes: [...neededCodes].sort(),
    urls: 0,
    rows: 0,
    errors: [],
  };

  if (!shouldFetch) {
    console.log(JSON.stringify(status));
    return;
  }

  const rows = [];
  for (const season of [...neededSeasons].sort()) {
    for (const code of [...neededCodes].sort()) {
      status.urls += 1;
      try {
        rows.push(...(await fetchRows(season, code)));
      } catch (error) {
        status.errors.push(`${season}/${code}: ${error?.message || error}`);
      }
    }
  }
  status.rows = rows.length;

  if (!rows.length) {
    // Geen bruikbare respons: bestaand bestand bewaren, geen lege dekking pushen.
    status.action = existing ? "fetch_failed_kept_existing" : "fetch_failed_no_file";
    console.log(JSON.stringify(status));
    if (status.errors.length) console.warn(JSON.stringify(status.errors.slice(0, 5)));
    return;
  }

  const { entries, stats } = buildMarketOddsEntries(records, rows);
  const payload = {
    schema: MARKET_ODDS_SCHEMA,
    fetchedAt: new Date().toISOString(),
    seasons: [...neededSeasons].sort(),
    leagues: [...neededCodes].sort(),
    // Bestaande paren blijven staan (gedeeltelijke ophaling wist geen dekking).
    entries: { ...(existing?.entries || {}), ...entries },
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`);
  status.action = "rebuilt";
  status.fetchedAt = payload.fetchedAt;
  status.entries = Object.keys(payload.entries).length;
  status.join = stats;
  console.log(JSON.stringify(status));
}

main().catch((error) => {
  console.error(`[market-odds] ${error?.stack || error?.message || error}`);
  process.exit(1);
});
