export const FOTMOB_STANDINGS_LEAGUES = Object.freeze({
  "Belgium - Pro League": { id: 40, countryCode: "BEL" },
  "Belgium - Challenger Pro League": { id: 264, countryCode: "BEL" },
  "England - Premier League": { id: 47, countryCode: "ENG" },
  "England - Championship": { id: 48, countryCode: "ENG" },
  "France - Ligue 1": { id: 53, countryCode: "FRA" },
  "France - Ligue 2": { id: 110, countryCode: "FRA" },
  "Germany - Bundesliga": { id: 54, countryCode: "GER" },
  "Germany - 2. Bundesliga": { id: 146, countryCode: "GER" },
  "Italy - Serie A": { id: 55, countryCode: "ITA" },
  "Italy - Serie B": { id: 86, countryCode: "ITA" },
  "Netherlands - Eredivisie": { id: 57, countryCode: "NED" },
  "Netherlands - Eerste Divisie": { id: 111, countryCode: "NED" },
  "Portugal - Liga Portugal": { id: 61, countryCode: "POR" },
  "Portugal - Liga Portugal 2": { id: 185, countryCode: "POR" },
  "Spain - LaLiga": { id: 87, countryCode: "ESP" },
  "Spain - LaLiga2": { id: 140, countryCode: "ESP" },
});

export function fotmobSeasonFromDate(dateISO) {
  const parsed = new Date(`${String(dateISO || "").slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const startYear = parsed.getUTCMonth() >= 6 ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
}

function scoreParts(value) {
  const match = String(value || "").match(/^(\d+)\s*-\s*(\d+)$/);
  return match ? { gf: Number(match[1]), ga: Number(match[2]) } : { gf: 0, ga: 0 };
}

export function normalizeFotmobStanding(payload, label, expectedLeagueId, season = null) {
  if (Number(payload?.details?.id) !== Number(expectedLeagueId)) return null;
  const rawRows = payload?.table?.[0]?.data?.table?.all;
  if (!Array.isArray(rawRows) || rawRows.length < 2) return null;

  const rows = rawRows.map((row, index) => {
    const score = scoreParts(row?.scoresStr);
    return {
      pos: Number(row?.idx || index + 1),
      team: String(row?.name || row?.shortName || "").trim(),
      teamId: row?.id ? `fotmob-${row.id}` : "",
      p: Number(row?.played || 0),
      w: Number(row?.wins || 0),
      d: Number(row?.draws || 0),
      l: Number(row?.losses || 0),
      gf: score.gf,
      ga: score.ga,
      pts: Number(row?.pts || 0),
    };
  }).filter((row) => row.team);
  if (rows.length < 2 || rows.some((row) => !Number.isFinite(row.p) || !Number.isFinite(row.pts))) return null;

  const resultKeys = (payload?.fixtures?.allMatches || [])
    .filter((match) => match?.status?.finished && match?.home?.name && match?.away?.name)
    .map((match) => `${String(match.status.utcTime || "").slice(0, 10)}|${match.home.name}|${match.away.name}`)
    .filter((key) => key[0] !== "|");

  return {
    label,
    season,
    rows,
    updated: Date.now(),
    source: "fotmob",
    sources: [{
      source: "fotmob",
      rows: rows.length,
      totalPlayed: rows.reduce((sum, row) => sum + row.p, 0),
    }],
    resultKeys,
    lastResultDate: null,
  };
}

export function selectCurrentStandingCandidate(candidates, strength) {
  const valid = (candidates || []).filter((item) => item?.rows?.length);
  if (!valid.length) return null;
  const currentFotmob = valid.find((item) => item.source === "fotmob");
  if (currentFotmob) return currentFotmob;
  return [...valid].sort((left, right) => strength(right) - strength(left))[0];
}

export async function fetchFotmobStanding(label, dateISO, fetchJson) {
  const competition = FOTMOB_STANDINGS_LEAGUES[label];
  const season = fotmobSeasonFromDate(dateISO);
  if (!competition || !season || typeof fetchJson !== "function") return null;
  const url = new URL("https://www.fotmob.com/api/data/leagues");
  url.searchParams.set("id", String(competition.id));
  url.searchParams.set("ccode3", `${competition.countryCode}_MA`);
  url.searchParams.set("season", season);
  const payload = await fetchJson(url.toString(), {
    Referer: "https://www.fotmob.com/",
    "Accept-Language": "en-US,en;q=0.9",
  });
  return normalizeFotmobStanding(payload, label, competition.id, season);
}
