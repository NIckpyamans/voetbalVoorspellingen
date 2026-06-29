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

function text(value) {
  return String(value || "");
}

export function isHiddenInternationalOrWorldCupEntity(entity = {}) {
  const league = text(entity.league || entity.leagueLabel || entity.competition || entity.tournament);
  const source = text(entity.dataSource || entity.source || entity.provider || entity.id || entity.matchId);
  const phase = text(entity.phaseBucket || entity.leagueType || entity.type);

  if (HIDDEN_LEAGUE_PATTERNS.some((pattern) => pattern.test(league))) return true;
  if (HIDDEN_SOURCE_PATTERNS.some((pattern) => pattern.test(source))) return true;
  if (/national|international/i.test(phase) && !/club/i.test(league)) return true;
  if (entity.worldCup2026) return true;

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
