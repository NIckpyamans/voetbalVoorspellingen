import { canonicalDedupeTeam } from "../../shared/matchNormalization.js";

const LEAGUE_CODES = new Map([
  ["england - premier league", "E0"],
  ["england - championship", "E1"],
  ["germany - bundesliga", "D1"],
  ["germany - 2. bundesliga", "D2"],
  ["germany - 2 bundesliga", "D2"],
  ["france - ligue 1", "F1"],
  ["france - ligue1", "F1"],
  ["france - ligue 2", "F2"],
  ["france - ligue2", "F2"],
  ["netherlands - eredivisie", "N1"],
]);

const seasonCache = new Map();

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value);
  return cells;
}

export function parseFootballDataCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines.shift() || "");
  return lines.map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
}

function parseDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return `${year}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
}

function seasonFolders(kickoff) {
  const date = new Date(kickoff || Date.now());
  const currentStart = date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return Array.from({ length: 5 }, (_, index) => {
    const start = currentStart - index;
    return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`;
  });
}

function sameTeam(left, right) {
  return canonicalDedupeTeam(left) === canonicalDedupeTeam(right);
}

function isPair(row, homeName, awayName) {
  return (sameTeam(row.HomeTeam, homeName) && sameTeam(row.AwayTeam, awayName)) ||
    (sameTeam(row.HomeTeam, awayName) && sameTeam(row.AwayTeam, homeName));
}

async function fetchSeason(folder, code, fetchImpl) {
  const key = `${folder}/${code}`;
  if (seasonCache.has(key)) return seasonCache.get(key);
  const response = await fetchImpl(`https://www.football-data.co.uk/mmz4281/${folder}/${code}.csv`, {
    headers: { Accept: "text/csv,text/plain,*/*", "User-Agent": "FootyPredict H2H collector" },
  });
  const rows = response.ok ? parseFootballDataCsv(await response.text()) : [];
  seasonCache.set(key, rows);
  return rows;
}

export async function fetchFootballDataCoUkH2HProfile(match, options = {}) {
  const leagueCode = LEAGUE_CODES.get(String(match?.league || "").trim().toLowerCase());
  if (!leagueCode) return null;
  const fetchImpl = options.fetchImpl || fetch;
  const cutoff = Date.parse(match?.kickoff_at || "") || Date.now();
  const results = [];
  for (const folder of seasonFolders(match?.kickoff_at)) {
    const rows = await fetchSeason(folder, leagueCode, fetchImpl);
    for (const row of rows) {
      const date = parseDate(row.Date);
      const homeScore = Number(row.FTHG);
      const awayScore = Number(row.FTAG);
      if (!date || Date.parse(`${date}T23:59:59Z`) >= cutoff || !isPair(row, match.home_team_name, match.away_team_name)) continue;
      if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;
      results.push({
        date,
        league: match.league,
        homeTeam: row.HomeTeam,
        awayTeam: row.AwayTeam,
        homeScore,
        awayScore,
        source: "football-data.co.uk",
      });
    }
  }
  const unique = new Map(results.map((result) => [
    `${result.date}|${canonicalDedupeTeam(result.homeTeam)}|${canonicalDedupeTeam(result.awayTeam)}|${result.homeScore}-${result.awayScore}`,
    result,
  ]));
  const selected = [...unique.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-5);
  return selected.length
    ? { results: selected, source: "football-data.co.uk historical results", asOf: new Date().toISOString() }
    : null;
}

export function resetFootballDataH2HCacheForTests() {
  seasonCache.clear();
}
