function normalizeTeam(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameTeam(id, name, expectedId, expectedName) {
  if (id && expectedId && String(id) === String(expectedId)) return true;
  return !!name && normalizeTeam(name) === normalizeTeam(expectedName);
}

export function deriveH2HWinnerId(item, homeName, awayName, homeId, awayId) {
  if (item?.winnerId) return item.winnerId;
  const score = String(item?.score || "").match(/^(\d+)\s*-\s*(\d+)$/);
  if (!score || score[1] === score[2]) return "";

  const historicalHomeIsCurrentHome = sameTeam(
    item?.homeTeamId,
    item?.home,
    homeId,
    homeName
  );
  const historicalHomeIsCurrentAway = sameTeam(
    item?.homeTeamId,
    item?.home,
    awayId,
    awayName
  );
  if (!historicalHomeIsCurrentHome && !historicalHomeIsCurrentAway) return "";

  const historicalHomeWon = Number(score[1]) > Number(score[2]);
  const currentHomeWon = historicalHomeIsCurrentHome === historicalHomeWon;
  return String(currentHomeWon ? homeId || normalizeTeam(homeName) : awayId || normalizeTeam(awayName));
}

export function findOrientedPreviousLeg({
  homeRecent,
  awayRecent,
  currentHomeId,
  currentAwayId,
  currentHomeName,
  currentAwayName,
  tournamentId,
  seasonId,
  currentEventId,
}) {
  const candidates = [
    ...(homeRecent?.recentMatches || []).map((match) => ({
      ...match,
      perspectiveTeamId: currentHomeId,
      perspectiveTeamName: currentHomeName,
      opponentTeamId: currentAwayId,
      opponentTeamName: currentAwayName,
    })),
    ...(awayRecent?.recentMatches || []).map((match) => ({
      ...match,
      perspectiveTeamId: currentAwayId,
      perspectiveTeamName: currentAwayName,
      opponentTeamId: currentHomeId,
      opponentTeamName: currentHomeName,
    })),
  ]
    .filter((item) => {
      if (String(item.eventId || "") === String(currentEventId || "")) return false;
      if (tournamentId && item.tournamentId && item.tournamentId !== tournamentId) return false;
      if (seasonId && item.seasonId && item.seasonId !== seasonId) return false;
      return sameTeam(
        item.opponentId,
        item.opponent,
        item.opponentTeamId,
        item.opponentTeamName
      );
    })
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));

  const match = candidates[0];
  const goalsFor = Number(match?.goalsFor ?? String(match?.score || "").split("-")[0]);
  const goalsAgainst = Number(match?.goalsAgainst ?? String(match?.score || "").split("-")[1]);
  if (!match || !Number.isFinite(goalsFor) || !Number.isFinite(goalsAgainst)) return null;

  const perspectiveWasAway = String(match.venue || "").toUpperCase() === "A";
  const historicalHomeId = perspectiveWasAway ? match.opponentTeamId : match.perspectiveTeamId;
  const historicalAwayId = perspectiveWasAway ? match.perspectiveTeamId : match.opponentTeamId;
  const historicalHome = perspectiveWasAway ? match.opponentTeamName : match.perspectiveTeamName;
  const historicalAway = perspectiveWasAway ? match.perspectiveTeamName : match.opponentTeamName;
  const historicalHomeGoals = perspectiveWasAway ? goalsAgainst : goalsFor;
  const historicalAwayGoals = perspectiveWasAway ? goalsFor : goalsAgainst;

  return {
    eventId: match.eventId || null,
    date: match.date || null,
    homeTeamId: String(historicalHomeId || ""),
    awayTeamId: String(historicalAwayId || ""),
    home: historicalHome,
    away: historicalAway,
    score: `${historicalHomeGoals}-${historicalAwayGoals}`,
    source: match.source || "recent-form-previous-leg",
  };
}

export function buildTwoLegAggregate(event, previousLeg) {
  if (!previousLeg?.score) return null;
  const score = String(previousLeg.score).match(/^(\d+)\s*-\s*(\d+)$/);
  if (!score) return null;
  const currentHomeId = event?.homeTeam?.id;
  const currentHomeName = event?.homeTeam?.name;
  const previousHomeIsCurrentHome = sameTeam(
    previousLeg.homeTeamId,
    previousLeg.home,
    currentHomeId,
    currentHomeName
  );
  const previousAwayIsCurrentHome = sameTeam(
    previousLeg.awayTeamId,
    previousLeg.away,
    currentHomeId,
    currentHomeName
  );
  if (!previousHomeIsCurrentHome && !previousAwayIsCurrentHome) return null;
  return {
    firstLegHomeGoals: previousHomeIsCurrentHome ? Number(score[1]) : Number(score[2]),
    firstLegAwayGoals: previousHomeIsCurrentHome ? Number(score[2]) : Number(score[1]),
    firstLegScore: `${score[1]}-${score[2]}`,
    firstLegText: `${previousLeg.home} ${score[1]}-${score[2]} ${previousLeg.away}`,
  };
}
