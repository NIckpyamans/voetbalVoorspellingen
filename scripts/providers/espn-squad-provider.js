const ESPN_TEAMS_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

export const ESPN_SQUAD_LEAGUE_CODES = {
  "Belgium - Pro League": "bel.1",
  "England - Championship": "eng.2",
  "England - Premier League": "eng.1",
  "Europe - Champions League": "uefa.champions",
  "Europe - Conference League": "uefa.europa.conf",
  "Europe - Europa League": "uefa.europa",
  "France - Ligue 1": "fra.1",
  "Germany - 2. Bundesliga": "ger.2",
  "Germany - Bundesliga": "ger.1",
  "Italy - Serie A": "ita.1",
  "Netherlands - Eredivisie": "ned.1",
  "Portugal - Liga Portugal": "por.1",
  "Spain - LaLiga": "esp.1",
  "World - Club Friendlies": "club.friendly",
};

export function normalizeEspnTeamName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|afc|sc|fk|as|rcd|ac)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function teamNames(team) {
  return [team?.displayName, team?.shortDisplayName, team?.name, team?.location]
    .map(normalizeEspnTeamName)
    .filter(Boolean);
}

export function findExactEspnTeam(teams, teamName) {
  const wanted = normalizeEspnTeamName(teamName);
  if (!wanted) return null;
  return (teams || []).find((team) => teamNames(team).includes(wanted)) || null;
}

export function parseEspnRoster(payload) {
  return (Array.isArray(payload?.athletes) ? payload.athletes : [])
    .map((athlete) => ({
      id: athlete?.id ? `espn:${athlete.id}` : "",
      name: String(athlete?.displayName || athlete?.fullName || "").trim(),
      position: String(athlete?.position?.displayName || athlete?.position?.name || "").trim(),
      nationality: String(athlete?.citizenship || athlete?.citizenshipCountry?.abbreviation || "").trim(),
      dateBorn: athlete?.dateOfBirth ? String(athlete.dateOfBirth).slice(0, 10) : null,
      status: String(athlete?.status?.name || "beschikbaar"),
      availability: athlete?.injuries?.length ? "onzeker" : String(athlete?.status?.name || "beschikbaar"),
      loan: false,
      source: "ESPN",
      sources: ["ESPN"],
    }))
    .filter((player) => player.name)
    .slice(0, 60);
}

function unwrapTeams(payload) {
  return (payload?.sports?.[0]?.leagues?.[0]?.teams || []).map((row) => row?.team || row).filter(Boolean);
}

export async function fetchEspnSquad({ teamName, leagues = [], knownTeams = [], fetchJson }) {
  if (typeof fetchJson !== "function") return null;
  const known = findExactEspnTeam(knownTeams, teamName);
  const codes = [...new Set([
    known?.espnLeagueCode,
    ...leagues.map((league) => ESPN_SQUAD_LEAGUE_CODES[String(league || "")]),
  ].filter(Boolean))];

  let team = known?.espnTeamId ? {
    id: String(known.espnTeamId),
    displayName: known.name || teamName,
    espnLeagueCode: known.espnLeagueCode || codes[0],
  } : null;

  for (const code of codes) {
    if (team?.id) break;
    const payload = await fetchJson(`${ESPN_TEAMS_BASE}/${encodeURIComponent(code)}/teams?limit=500`);
    const match = findExactEspnTeam(unwrapTeams(payload), teamName);
    if (match?.id) team = { ...match, espnLeagueCode: code };
  }
  if (!team?.id || !team?.espnLeagueCode) return null;

  const roster = await fetchJson(`${ESPN_TEAMS_BASE}/${encodeURIComponent(team.espnLeagueCode)}/teams/${encodeURIComponent(team.id)}/roster`);
  const players = parseEspnRoster(roster);
  if (!players.length) return null;
  return {
    providerTeamId: String(team.id),
    providerTeamName: String(roster?.team?.displayName || team.displayName || team.name || teamName),
    leagueCode: team.espnLeagueCode,
    players,
  };
}
