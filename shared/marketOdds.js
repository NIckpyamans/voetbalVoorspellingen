// Marktoddsparen uit gratis football-data.co.uk seizoens-CSV's voor de compacte
// wedstrijdopslag. Doel: de marktbaseline (model versus marktfavoriet) laten
// rusten op closing marktodds voor alle beoordeelde wedstrijden in de gedekte
// competities, in plaats van alleen op de dunne oddsAtPrediction-captures.
//
// Fair-use van football-data.co.uk: de bestanden zijn bedoeld voor priv- en
// academisch gebruik, met maximaal twee geautomatiseerde ophalingen per week.
// scripts/build-market-odds.js respecteert dat met een 7-dagen-drempel.
//
// Alles hier is puur en testbaar; het script dat ophaalt en wegschrijft staat
// in scripts/build-market-odds.js.

import { canonicalDedupeTeam } from "./matchNormalization.js";

export const MARKET_ODDS_SCHEMA = "market-odds-v1";

// Sleutels uit de wedstrijdopslag (record.lg) -> CSV-codes van
// football-data.co.uk. Competities buiten deze lijst ( Europa Cup,
// vriendschappelijk) hebben geen gratis CSV met odds en vallen terug op de
// pre-match oddsAtPrediction-captures.
export const LEAGUE_CODE_BY_LEAGUE = {
  "England - Premier League": "E0",
  "England - Championship": "E1",
  "Germany - Bundesliga": "D1",
  "Germany - 2. Bundesliga": "D2",
  "Italy - Serie A": "I1",
  "Spain - LaLiga": "SP1",
  "France - Ligue 1": "F1",
  "France - Ligue 2": "F2",
  "Netherlands - Eredivisie": "N1",
  "Netherlands - Eerste Divisie": "N2",
  "Belgium - Pro League": "B1",
  "Portugal - Liga Portugal": "P1",
};

function clubKey(value) {
  return canonicalDedupeTeam(value)
    || String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Zelfde sleutelvorming aan beide kanten van de koppeling (store-record en
// script), zodat lookup en build nooit van elkaar kunnen afwijken.
export function marketOddsKey(date, home, away) {
  const day = String(date || "").slice(0, 10);
  if (!day || !home || !away) return "";
  return `${day}|${clubKey(home)}|${clubKey(away)}`;
}

// Favoriet = laagste decimal odd; die keuze is invariant onder de-vig, exact
// dezelfde regel als de oddsAtPrediction-tak in shared/matchStore.js.
export function favoriteFromOdds(home, draw, away) {
  const values = [Number(home), Number(draw), Number(away)];
  if (!values.every((value) => Number.isFinite(value) && value > 1.01)) return null;
  return [["H", values[0]], ["D", values[1]], ["A", values[2]]]
    .sort((left, right) => left[1] - right[1])[0][0];
}

// Seizoensleutel van football-data.co.uk: competities starten in juli/augustus.
// 2026-04 -> "2526", 2026-07 -> "2627", 2026-10 -> "2627", 2026-06 -> "2526".
export function footballDataSeason(date) {
  const parts = String(date || "").slice(0, 10).split("-").map(Number);
  const [year, month] = parts;
  if (!year || !month) return null;
  const start = month >= 7 ? year : year - 1;
  const yy = String(start % 100).padStart(2, "0");
  const nextYy = String((start + 1) % 100).padStart(2, "0");
  return `${yy}${nextYy}`;
}

function parseFootballDate(value) {
  const match = String(value || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

// Robuste CSV-parser met quote-ondersteuning (identiek aan de bewezen parser
// in scripts/backfill-historical-odds-closing.js).
function parseCsv(text) {
  const rows = [];
  let current = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      current.push(field);
      field = "";
    } else if (char === "\n") {
      current.push(field);
      rows.push(current);
      current = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || current.length) {
    current.push(field);
    rows.push(current);
  }
  const header = rows.shift() || [];
  return rows
    .filter((row) => row.length > 1)
    .map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] ?? ""])));
}

// Volgorde: marktconsensus-closing eerst, dan marktconsensus, dan enkele
// bookmakers als afsluiting. Alleen triples boven 1.01 tellen.
const ODDS_COLUMN_PREFERENCE = [
  ["AvgClosing", "AvgCH", "AvgCD", "AvgCA"],
  ["MarketAvg", "AvgH", "AvgD", "AvgA"],
  ["Bet365Closing", "B365CH", "B365CD", "B365CA"],
  ["Bet365", "B365H", "B365D", "B365A"],
  ["PinnacleClosing", "PSCH", "PSCD", "PSCA"],
  ["Pinnacle", "PSH", "PSD", "PSA"],
  ["Pinnacle", "PH", "PD", "PA"],
];

function pickOdds(row) {
  for (const [bookmaker, homeKey, drawKey, awayKey] of ODDS_COLUMN_PREFERENCE) {
    const home = Number(row[homeKey]);
    const draw = Number(row[drawKey]);
    const away = Number(row[awayKey]);
    if ([home, draw, away].every((value) => Number.isFinite(value) && value > 1.01)) {
      return { bookmaker, home, draw, away };
    }
  }
  return null;
}

// Parseert een seizoens-CSV tot gekoppelde rijen. `leagueCode` wordt meegegeven
// zodat de koppeling per competitie kan selecteren zonder de bestandsnaam.
export function parseFootballDataCsv(text, leagueCode) {
  const parsed = [];
  for (const row of parseCsv(String(text || ""))) {
    const date = parseFootballDate(row.Date);
    const home = String(row.HomeTeam || "").trim();
    const away = String(row.AwayTeam || "").trim();
    const homeGoals = Number(row.FTHG);
    const awayGoals = Number(row.FTAG);
    if (!date || !home || !away) continue;
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
    parsed.push({ date, home, away, homeGoals, awayGoals, leagueCode, odds: pickOdds(row) });
  }
  return parsed;
}

// Koppelt store-records aan CSV-rijen: datum + competitie + einduitslag moeten
// overeenkomen, clubnamen dienen als tiebreak (score 0-2). Bij meerdere
// evenwaardige kandidaten wordt overgeslagen (geen gokken op de verkeerde wedstrijd).
// Records met al een pre-match mk (oddsAtPrediction) worden nooit aangeraakt.
export function buildMarketOddsEntries(records = [], csvRows = [], options = {}) {
  const leagueCodes = options.leagueCodes || LEAGUE_CODE_BY_LEAGUE;
  const bySlot = new Map();
  for (const row of csvRows) {
    if (!row?.date || !row.leagueCode) continue;
    const slot = `${row.date}|${row.leagueCode}`;
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(row);
  }
  const entries = {};
  const stats = {
    existingPreMatch: 0,
    eligible: 0,
    uncoveredLeague: 0,
    noCandidate: 0,
    ambiguous: 0,
    noOdds: 0,
    joined: 0,
  };
  for (const record of records) {
    if (!record) continue;
    if (record.mk !== undefined) {
      stats.existingPreMatch += 1;
      continue;
    }
    if (typeof record.hit !== "boolean" || !record.ao) continue;
    const leagueCode = leagueCodes[record.lg];
    if (!leagueCode) {
      stats.uncoveredLeague += 1;
      continue;
    }
    stats.eligible += 1;
    const candidates = (bySlot.get(`${record.d}|${leagueCode}`) || [])
      .filter((row) => row.homeGoals === record.hs && row.awayGoals === record.as);
    if (!candidates.length) {
      stats.noCandidate += 1;
      continue;
    }
    const homeKey = clubKey(record.h);
    const awayKey = clubKey(record.a);
    const scored = candidates.map((row) => ({
      row,
      score: (clubKey(row.home) === homeKey ? 1 : 0) + (clubKey(row.away) === awayKey ? 1 : 0),
    }));
    const best = Math.max(...scored.map((entry) => entry.score));
    const top = scored.filter((entry) => entry.score === best);
    if (top.length !== 1) {
      stats.ambiguous += 1;
      continue;
    }
    if (!top[0].row.odds) {
      stats.noOdds += 1;
      continue;
    }
    const { home, draw, away } = top[0].row.odds;
    entries[marketOddsKey(record.d, record.h, record.a)] = [home, draw, away];
    stats.joined += 1;
  }
  return { entries, stats };
}
