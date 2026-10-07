export function isCompleteBalancedTable(rows, teams, sameTeam) {
  if (!Array.isArray(rows) || !Array.isArray(teams) || rows.length !== teams.length || typeof sameTeam !== "function") return false;
  const matchedRows = new Set();
  for (const team of teams) {
    const index = rows.findIndex((row, rowIndex) => !matchedRows.has(rowIndex) && sameTeam(row?.team, team));
    if (index < 0) return false;
    matchedRows.add(index);
  }
  if (matchedRows.size !== rows.length) return false;
  const rowsAreValid = rows.every((row) => {
    const played = Number(row.p || 0);
    const wins = Number(row.w || 0);
    const draws = Number(row.d || 0);
    const losses = Number(row.l || 0);
    const goalsFor = Number(row.gf || 0);
    const goalsAgainst = Number(row.ga || 0);
    const points = Number(row.pts || 0);
    return [played, wins, draws, losses, goalsFor, goalsAgainst, points].every(Number.isFinite) &&
      played === wins + draws + losses &&
      [played, wins, draws, losses, goalsFor, goalsAgainst, points].every((value) => value >= 0);
  });
  if (!rowsAreValid) return false;
  const totals = rows.reduce((sum, row) => ({
    played: sum.played + Number(row.p || 0),
    goalsFor: sum.goalsFor + Number(row.gf || 0),
    goalsAgainst: sum.goalsAgainst + Number(row.ga || 0),
  }), { played: 0, goalsFor: 0, goalsAgainst: 0 });
  return totals.played % 2 === 0 && totals.goalsFor === totals.goalsAgainst;
}

export function validateStandingIntegrity(label, definition, standing, catalogSeason) {
  const errors = [];
  const rows = Array.isArray(standing?.rows) ? standing.rows : [];
  const totalPlayed = rows.reduce((sum, row) => sum + Number(row.p || 0), 0);
  const totalGoalsFor = rows.reduce((sum, row) => sum + Number(row.gf || 0), 0);
  const totalGoalsAgainst = rows.reduce((sum, row) => sum + Number(row.ga || 0), 0);
  const invalidRows = rows.filter((row) => Number(row.p || 0) !== Number(row.w || 0) + Number(row.d || 0) + Number(row.l || 0));

  if (rows.length !== Number(definition.expectedTeams || definition.teams?.length || 0)) {
    errors.push(`${label}: ${rows.length} teams, verwacht ${definition.expectedTeams || definition.teams?.length}`);
  }
  if (String(standing.season || "") !== String(catalogSeason || "")) {
    errors.push(`${label}: seizoen ${standing.season || "onbekend"}, verwacht ${catalogSeason}`);
  }
  if (invalidRows.length) errors.push(`${label}: ${invalidRows.length} rij(en) met gespeeld != W+G+V`);
  if (totalPlayed % 2 !== 0) errors.push(`${label}: oneven totaal gespeeld (${totalPlayed})`);
  if (totalGoalsFor !== totalGoalsAgainst) errors.push(`${label}: DV ${totalGoalsFor} verschilt van DT ${totalGoalsAgainst}`);
  if (definition.type === "cup" && standing.preliminary === true && totalPlayed !== 0) {
    errors.push(`${label}: voorlopige UEFA league-phase bevat ${totalPlayed / 2} gespeelde wedstrijden`);
  }

  return { errors, rows, totalPlayed, totalGoalsFor, totalGoalsAgainst };
}
