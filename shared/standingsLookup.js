function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(fc|afc|sc|cf|ac|as|sv|fk|kv|kvc|kaa|rc|rkc|club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLeague(value) {
  return normalize(value).replace(/\b(uefa|europe)\b/g, " ").replace(/\s+/g, " ").trim();
}

const TEAM_ALIASES = {
  "top oss": "top oss",
  oss: "top oss",
  mvv: "mvv maastricht",
  "bayern munchen": "bayern",
  "bayern munich": "bayern",
  "heracles almelo": "heracles",
  "man city": "manchester city",
  "manchester city": "manchester city",
  "paris sg": "paris saint germain",
  psg: "paris saint germain",
  "paris saint germain": "paris saint germain",
  "jong az alkmaar": "jong az",
};

export function canonicalStandingTeam(value) {
  const name = normalize(value);
  return TEAM_ALIASES[name] || name;
}

function teamsMatch(left, right) {
  const a = canonicalStandingTeam(left);
  const b = canonicalStandingTeam(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && (a.startsWith(`${b} `) || b.startsWith(`${a} `));
}

export function buildStandingsLookup(standings = {}) {
  const byLeague = new Map();
  const leagueAliases = new Map();
  const byId = new Map();

  for (const [key, table] of Object.entries(standings || {})) {
    const league = String(table?.label || key.replace(/^label:/, "")).trim();
    const rows = Array.isArray(table?.rows) ? table.rows : [];
    const idMap = new Map();
    for (const row of rows) {
      const pos = Number(row?.pos);
      if (!Number.isInteger(pos) || pos <= 0) continue;
      if (row?.teamId) {
        idMap.set(String(row.teamId), pos);
        const positions = byId.get(String(row.teamId)) || new Set();
        positions.add(pos);
        byId.set(String(row.teamId), positions);
      }
    }
    byLeague.set(league, { rows, byId: idMap, preliminary: Boolean(table?.preliminary) });
    const normalizedLeague = normalizeLeague(league);
    if (normalizedLeague) leagueAliases.set(normalizedLeague, league);
  }

  return { byId, byLeague, leagueAliases };
}

export function findStandingPosition(lookup, { teamId, teamName, league } = {}) {
  const leagueKey = String(league || "");
  const matchedLeague = lookup?.byLeague?.has(leagueKey)
    ? leagueKey
    : lookup?.leagueAliases?.get(normalizeLeague(leagueKey));
  const table = matchedLeague ? lookup.byLeague.get(matchedLeague) : null;

  if (teamId && table?.byId?.has(String(teamId))) return table.byId.get(String(teamId));
  const nameMatch = table?.rows?.find((row) => teamsMatch(row?.team || row?.teamName, teamName));
  if (nameMatch) return Number(nameMatch.pos) || null;

  // Cross-competition ID fallback is safe only when that provider ID has one
  // unique position; otherwise do not display a misleading cup/league rank.
  const idPositions = teamId ? lookup?.byId?.get(String(teamId)) : null;
  return idPositions?.size === 1 ? [...idPositions][0] : null;
}

export function findStandingEntry(lookup, { teamId, teamName, league } = {}) {
  const leagueKey = String(league || "");
  const matchedLeague = lookup?.byLeague?.has(leagueKey)
    ? leagueKey
    : lookup?.leagueAliases?.get(normalizeLeague(leagueKey));
  const table = matchedLeague ? lookup.byLeague.get(matchedLeague) : null;
  if (!table) return null;
  const byId = teamId ? table.byId?.get(String(teamId)) : null;
  if (byId) return { position: byId, preliminary: Boolean(table.preliminary) };
  const nameMatch = table.rows?.find((row) => teamsMatch(row?.team || row?.teamName, teamName));
  return nameMatch ? { position: Number(nameMatch.pos) || null, preliminary: Boolean(table.preliminary) } : null;
}
