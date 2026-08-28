const TEAM_ALIAS_GROUPS = [
  ["fc copenhagen", "fc kobenhavn", "f c kobenhavn", "copenhagen", "kobenhavn"],
  ["ks dynamo tirana", "dynamo tirana", "dinamo tirana", "fc dinamo city", "dinamo city"],
  ["paok salonika", "paok thessaloniki", "paok salonica", "paok"],
  ["pafos", "pafos fc"],
  ["sint truidense vv", "sint truidense", "st truiden", "st truidense", "sint truiden"],
];

function basicTeamName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[øö]/g, "o")
    .replace(/[ł]/g, "l")
    .replace(/[đð]/g, "d")
    .replace(/[æ]/g, "ae")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const TEAM_ALIAS_LOOKUP = new Map();
for (const group of TEAM_ALIAS_GROUPS) {
  const canonical = basicTeamName(group[0]);
  for (const alias of group) TEAM_ALIAS_LOOKUP.set(basicTeamName(alias), canonical);
}

export function canonicalProviderTeam(value) {
  const normalized = basicTeamName(value);
  const withoutClubTokens = normalized
    .replace(/\b(fc|afc|cf|sc|ac|club|fk|sv|the)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return TEAM_ALIAS_LOOKUP.get(normalized)
    || TEAM_ALIAS_LOOKUP.get(withoutClubTokens)
    || withoutClubTokens;
}

export function providerTeamSimilarity(left, right) {
  const a = canonicalProviderTeam(left);
  const b = canonicalProviderTeam(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a))) return 0.94;
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  return overlap / Math.max(1, Math.min(aTokens.size, bTokens.size));
}

export function findBestProviderFixture(match, candidates, options = {}) {
  const home = options.home || ((row) => row?.home?.name || row?.homeTeam?.name || row?.homeTeamName);
  const away = options.away || ((row) => row?.away?.name || row?.awayTeam?.name || row?.awayTeamName);
  const kickoff = options.kickoff || ((row) => row?.status?.utcTime || row?.kickoff || row?.date);
  const id = options.id || ((row) => row?.id || row?.eventId);
  const minimumSimilarity = Number(options.minimumSimilarity ?? 0.82);
  const maximumKickoffGapHours = Number(options.maximumKickoffGapHours ?? 6);
  const targetKickoff = Date.parse(match?.kickoff_at || match?.kickoff || "");
  let best = null;

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const homeScore = providerTeamSimilarity(match?.home_team_name || match?.homeTeamName || match?.homeTeam, home(candidate));
    const awayScore = providerTeamSimilarity(match?.away_team_name || match?.awayTeamName || match?.awayTeam, away(candidate));
    const teamScore = Math.min(homeScore, awayScore);
    if (teamScore < minimumSimilarity) continue;
    const candidateKickoff = Date.parse(kickoff(candidate) || "");
    const kickoffGapHours = Number.isFinite(targetKickoff) && Number.isFinite(candidateKickoff)
      ? Math.abs(candidateKickoff - targetKickoff) / 3_600_000
      : 0;
    if (kickoffGapHours > maximumKickoffGapHours) continue;
    const rank = teamScore - Math.min(kickoffGapHours, maximumKickoffGapHours) * 0.01;
    if (best && best.rank >= rank) continue;
    best = { fixtureId: String(id(candidate) || ""), score: teamScore, kickoffGapHours, rank, candidate };
  }
  return best?.fixtureId ? best : null;
}
