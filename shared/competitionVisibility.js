const HIDDEN_LEAGUE_PATTERNS = [
  /world\s*-\s*fifa\s+world\s+cup\s+2026/i,
  /fifa\s+world\s+cup\s+2026/i,
  /world\s*-\s*international\s+friendl(?:y|ies)/i,
  /europe\s*-\s*international\s+friendl(?:y|ies)/i,
  /international\s+friendl(?:y|ies)/i,
  /world\s+cup\s+qualification/i,
  /uefa\s+nations\s+league/i,
  /euro\s+qualification/i,
  /european\s+championship/i,
];

const HIDDEN_SOURCE_PATTERNS = [
  /fifa\.world/i,
  /fifa\.friendly/i,
  /openfootball-international/i,
  /world-cup-2026/i,
];

const HIDDEN_TEAM_PATTERNS = [
  /^$/,
  /^-$/,
  /^tbd$/,
  /^to be (decided|determined)$/,
  /^unknown$/,
  /^n\/a$/,
  /\bwinner\s+group\b/i,
  /\brunner[-\s]?up\s+group\b/i,
  /\bthird\s+place\s+group\b/i,
  /\bbest\s+third\b/i,
  /\bgroup\s+[a-z]\s+(winner|runner[-\s]?up|third)/i,
];

function text(value) {
  return String(value || "");
}

function teamName(entity, prefix) {
  return text(
    entity[`${prefix}TeamName`] ||
      entity[`${prefix}Team`] ||
      entity[`${prefix}_team_name`] ||
      entity[`${prefix}_team`] ||
      ""
  );
}

function hasTeamField(entity, prefix) {
  return [`${prefix}TeamName`, `${prefix}Team`, `${prefix}_team_name`, `${prefix}_team`].some((key) =>
    Object.prototype.hasOwnProperty.call(entity, key)
  );
}

export function hasVisibleTeamNames(entity = {}) {
  if (!hasTeamField(entity, "home") && !hasTeamField(entity, "away")) return true;
  const home = teamName(entity, "home");
  const away = teamName(entity, "away");
  return ![home, away].some((name) => HIDDEN_TEAM_PATTERNS.some((pattern) => pattern.test(text(name).trim())));
}

export function isHiddenInternationalOrWorldCupEntity(entity = {}) {
  const league = text(entity.league || entity.leagueLabel || entity.competition || entity.competitionName || entity.tournament);
  const source = text(entity.dataSource || entity.source || entity.provider || entity.id || entity.matchId);
  const phase = text(entity.phaseBucket || entity.leagueType || entity.type);

  if (HIDDEN_LEAGUE_PATTERNS.some((pattern) => pattern.test(league))) return true;
  if (HIDDEN_SOURCE_PATTERNS.some((pattern) => pattern.test(source))) return true;
  if (/national|international/i.test(phase) && !/club/i.test(league)) return true;
  if (entity.worldCup2026) return true;
  if (!hasVisibleTeamNames(entity)) return true;

  return false;
}

export function filterVisibleMatches(matches = []) {
  return (Array.isArray(matches) ? matches : []).filter((match) => !isHiddenInternationalOrWorldCupEntity(match));
}

export function filterVisiblePredictions(predictions = [], matches = []) {
  const matchById = new Map(filterVisibleMatches(matches).map((match) => [match.id, match]));
  return (Array.isArray(predictions) ? predictions : []).filter((prediction) => {
    const match = matchById.get(prediction?.matchId);
    if (!match && prediction?.matchId) return false;
    return !isHiddenInternationalOrWorldCupEntity({ ...match, ...prediction });
  });
}

export function filterVisiblePredictionMap(predictions = {}, matches = []) {
  const matchById = new Map(filterVisibleMatches(matches).map((match) => [match.id, match]));
  return Object.fromEntries(
    Object.entries(predictions || {}).filter(([matchId, prediction]) => {
      const match = matchById.get(matchId);
      if (!match) return false;
      return !isHiddenInternationalOrWorldCupEntity({ ...match, ...(prediction || {}) });
    })
  );
}
