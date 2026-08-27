const DEFAULT_GOALS = 1.35;

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

function sourcePriority(source) {
  const value = String(source || "");
  if (/fotmob/i.test(value)) return 7;
  if (/espn/i.test(value)) return 6;
  if (/thesportsdb/i.test(value)) return 5;
  if (/sofa/i.test(value)) return 4;
  if (/sky/i.test(value)) return 3;
  return 1;
}

function recentMatchQuality(match) {
  const opponent = String(match?.opponent || "").trim();
  const hasRealOpponent = opponent && !/^(opponent|tbc|unknown|onbekend)$/i.test(opponent);
  return Number(Boolean(hasRealOpponent)) * 20 + sourcePriority(match?.source);
}

export function dedupeRecentTeamMatches(matches = []) {
  const selected = new Map();
  for (const match of matches || []) {
    if (!match) continue;
    const date = String(match.date || "").slice(0, 10);
    const venue = String(match.venue || "").toUpperCase() === "A" ? "A" : "H";
    const goalsFor = finiteOr(match.goalsFor, Number.NaN);
    const goalsAgainst = finiteOr(match.goalsAgainst, Number.NaN);
    if (!date || !Number.isFinite(goalsFor) || !Number.isFinite(goalsAgainst)) continue;

    // A team cannot normally play the same score at the same venue twice on one
    // day. This provider-neutral key removes duplicate fixture representations.
    const key = `${date}|${venue}|${goalsFor}|${goalsAgainst}`;
    const current = selected.get(key);
    if (!current || recentMatchQuality(match) > recentMatchQuality(current)) {
      selected.set(key, match);
    }
  }
  return [...selected.values()];
}

export function stabilizeOverallForm(recent = {}, priorGames = 5) {
  const games = Math.max(0, finiteOr(recent?.gamesPlayed, 0));
  const weight = games / (games + Math.max(1, finiteOr(priorGames, 5)));
  return {
    avgScored: round(finiteOr(recent?.avgScored, DEFAULT_GOALS) * weight + DEFAULT_GOALS * (1 - weight)),
    avgConceded: round(finiteOr(recent?.avgConceded, DEFAULT_GOALS) * weight + DEFAULT_GOALS * (1 - weight)),
    sampleWeight: round(weight),
  };
}

export function shrinkVenueSplit(recent = {}, venue = "home", priorGames = 3) {
  const split = recent?.splits?.[venue] || {};
  const games = Math.max(0, finiteOr(split.games, 0));
  const stabilized = stabilizeOverallForm(recent);
  const overallScored = stabilized.avgScored;
  const overallConceded = stabilized.avgConceded;
  if (!games) {
    return {
      ...split,
      games: 0,
      avgScored: round(overallScored),
      avgConceded: round(overallConceded),
      sampleWeight: 0,
    };
  }

  const weight = games / (games + Math.max(1, finiteOr(priorGames, 3)));
  return {
    ...split,
    games,
    avgScored: round(finiteOr(split.avgScored, overallScored) * weight + overallScored * (1 - weight)),
    avgConceded: round(finiteOr(split.avgConceded, overallConceded) * weight + overallConceded * (1 - weight)),
    sampleWeight: round(weight),
  };
}
