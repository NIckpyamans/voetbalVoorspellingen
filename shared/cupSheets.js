function isCupLike(match) {
  const league = String(match?.league || "").toLowerCase();
  const summary = String(match?.context?.summary || "").toLowerCase();
  return Boolean(
    match?.aggregate?.active ||
      summary.includes("knock-out") ||
      summary.includes("play-off") ||
      league.includes("champions league") ||
      league.includes("europa league") ||
      league.includes("conference league") ||
      league.includes("beker") ||
      league.includes("cup")
  );
}

function toCupItem(match) {
  return {
    league: match.league || "Bekertoernooi",
    roundLabel: match.roundLabel || "Knock-out",
    stakes: match.context?.stakes || match.context?.summary || null,
    matchId: match.id,
    kickoff: match.kickoff || null,
    homeTeamName: match.homeTeamName,
    awayTeamName: match.awayTeamName,
    aggregate: match.aggregate || null,
    score: match.score || null,
    status: match.status || "NS",
  };
}

export function buildCupSheetsFromMatches(store) {
  const sheets = {};
  const allMatches = Object.values(store?.matches || {}).flat();
  for (const match of allMatches) {
    if (!match || !isCupLike(match)) continue;
    const item = toCupItem(match);
    const round = String(item.roundLabel || "Knock-out");
    if (!sheets[item.league]) sheets[item.league] = { league: item.league, rounds: {} };
    if (!sheets[item.league].rounds[round]) sheets[item.league].rounds[round] = [];
    sheets[item.league].rounds[round].push(item);
  }
  return sheets;
}

export function mergeCupSheets(previous = {}, current = {}) {
  const merged = structuredClone(previous || {});
  for (const [league, sheet] of Object.entries(current || {})) {
    if (!merged[league]) merged[league] = { league, rounds: {} };
    for (const [round, items] of Object.entries(sheet?.rounds || {})) {
      const byId = new Map((merged[league].rounds?.[round] || []).map((item) => [item.matchId, item]));
      for (const item of items || []) byId.set(item.matchId, item);
      merged[league].rounds[round] = [...byId.values()].sort((a, b) =>
        String(a.kickoff || "").localeCompare(String(b.kickoff || ""))
      );
    }
  }
  return merged;
}
