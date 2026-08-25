function numericScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

export function normalizeFotMobTeamFixtures(fixtures, teamId, teamName, cutoff = Date.now()) {
  const id = String(teamId || "");
  return (fixtures || [])
    .map((fixture) => {
      const kickoff = fixture?.status?.utcTime || null;
      const kickoffMs = Date.parse(kickoff || "");
      if (!fixture?.status?.finished || !Number.isFinite(kickoffMs) || kickoffMs >= cutoff) return null;
      const homeId = String(fixture?.home?.id || "");
      const awayId = String(fixture?.away?.id || "");
      const isHome = homeId === id;
      const isAway = awayId === id;
      if (!isHome && !isAway) return null;
      const homeScore = numericScore(fixture?.home?.score);
      const awayScore = numericScore(fixture?.away?.score);
      if (homeScore === null || awayScore === null) return null;
      const goalsFor = isHome ? homeScore : awayScore;
      const goalsAgainst = isHome ? awayScore : homeScore;
      return {
        date: String(kickoff).slice(0, 10),
        kickoff,
        eventId: String(fixture?.id || "") || null,
        league: fixture?.tournament?.name || null,
        venue: isHome ? "H" : "A",
        opponent: isHome ? fixture?.away?.name : fixture?.home?.name,
        opponentId: String(isHome ? fixture?.away?.id || "" : fixture?.home?.id || ""),
        score: `${goalsFor}-${goalsAgainst}`,
        goalsFor,
        goalsAgainst,
        result: goalsFor > goalsAgainst ? "W" : goalsFor === goalsAgainst ? "D" : "L",
        source: "fotmob-team-fixtures",
        providerTeamId: id,
        providerTeamName: teamName,
      };
    })
    .filter(Boolean)
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)))
    .slice(-10);
}

export async function fetchFotMobTeamForm({
  teamId,
  teamName,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
}) {
  const id = String(teamId || "").replace(/^fotmob-/i, "");
  if (!/^\d+$/.test(id) || typeof fetchImpl !== "function") return null;
  try {
    const response = await fetchImpl(`https://www.fotmob.com/api/data/teams?id=${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; FootyPredict form collector/1.0)" },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const providerTeamName = String(payload?.details?.name || teamName || "");
    const recentMatches = normalizeFotMobTeamFixtures(
      payload?.fixtures?.allFixtures?.fixtures,
      id,
      providerTeamName,
      now,
    );
    return recentMatches.length ? {
      providerTeamId: id,
      providerTeamName,
      recentMatches,
      source: "fotmob-team-fixtures",
      asOf: new Date(now).toISOString(),
    } : null;
  } catch {
    return null;
  }
}
