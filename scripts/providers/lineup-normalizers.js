function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function playerRow(item, source) {
  const player = item?.player || item || {};
  const position = player?.position || item?.position?.code || item?.position?.name || item?.position || "";
  return {
    id: player?.id || item?.player_id || null,
    name: String(player?.name || player?.display_name || item?.player_name || "").trim(),
    position: String(position || "").trim(),
    shirtNumber: item?.number ?? item?.jersey_number ?? item?.shirt_number ?? null,
    rating: Number(item?.rating || player?.rating || 0) || null,
    source,
  };
}

function lineupSide({ formation = null, starters = [], substitutes = [], source }) {
  const players = starters.map((item) => playerRow(item, source)).filter((item) => item.name).slice(0, 11);
  const keeper = players.find((item) => /^g|goal/i.test(item.position));
  const ratings = players.map((item) => Number(item.rating || 0)).filter((value) => value > 0);
  return {
    formation,
    starters: players.length,
    bench: substitutes.length,
    players,
    avgRating: ratings.length ? Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2)) : null,
    keeperName: keeper?.name || null,
    keeperRating: keeper?.rating || null,
    confirmed: players.length >= 10,
    projected: false,
  };
}

export function normalizeApiFootball(payload) {
  const teams = asArray(payload?.response);
  if (teams.length < 2) return null;
  const sides = teams.slice(0, 2).map((team) => lineupSide({
    formation: team?.formation || null,
    starters: asArray(team?.startXI),
    substitutes: asArray(team?.substitutes),
    source: "API-Football confirmed lineups",
  }));
  if (!sides.some((side) => side.starters > 0)) return null;
  return {
    home: sides[0],
    away: sides[1],
    confirmed: sides.every((side) => side.confirmed),
    projected: false,
    source: "API-Football confirmed lineups",
    summary: "Officiele wedstrijselecties opgehaald vlak voor de aftrap.",
  };
}

export function normalizeSportmonks(payload) {
  const fixture = payload?.data || null;
  const participants = asArray(fixture?.participants);
  const lineups = asArray(fixture?.lineups);
  if (!fixture || !lineups.length) return null;
  const homeParticipant = participants.find((item) => item?.meta?.location === "home") || participants[0];
  const awayParticipant = participants.find((item) => item?.meta?.location === "away") || participants[1];
  const teamRows = (teamId) => lineups.filter((item) => String(item?.team_id || item?.participant_id || "") === String(teamId || ""));
  const build = (participant) => {
    const rows = teamRows(participant?.id);
    const starters = rows.filter((item) => item?.type_id === 11 || item?.starter === true || item?.formation_position != null);
    const substitutes = rows.filter((item) => !starters.includes(item));
    return lineupSide({ formation: participant?.meta?.formation || null, starters, substitutes, source: "Sportmonks confirmed lineups" });
  };
  const home = build(homeParticipant);
  const away = build(awayParticipant);
  if (!home.starters && !away.starters) return null;
  return {
    home,
    away,
    confirmed: home.confirmed && away.confirmed,
    projected: false,
    source: "Sportmonks confirmed lineups",
    playerFixtureStatsCaptured: lineups.reduce((total, item) => total + asArray(item?.details).length, 0),
    summary: "Officiele wedstrijselecties opgehaald vlak voor de aftrap.",
  };
}

export function normalizeSofaScore(payload) {
  const build = (team) => {
    if (!team) return null;
    const rows = asArray(team.players);
    return lineupSide({
      formation: team.formation || null,
      starters: rows.filter((item) => item?.substitute === false),
      substitutes: rows.filter((item) => item?.substitute === true),
      source: "SofaScore confirmed lineups",
    });
  };
  const home = build(payload?.home || payload?.homeTeam);
  const away = build(payload?.away || payload?.awayTeam);
  if (!home && !away) return null;
  return {
    home,
    away,
    confirmed: Boolean(home?.confirmed && away?.confirmed),
    projected: false,
    source: "SofaScore confirmed lineups",
    summary: "Bevestigde opstellingen opgehaald uit de wedstrijdfeed vlak voor de aftrap.",
  };
}
