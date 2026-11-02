import { buildMatchDedupeKey } from "../../shared/matchNormalization.js";

// Hetzelfde duel staat geregeld twee keer in de dagdata: één keer met een
// FotMob-id en één keer met een ESPN-id. Beide rijen deden een eigen odds-call en
// de niet-gedekte tweeling telde als "geen odds", terwijl zijn broer wél dekking
// had. Daarom één representant per duel, met een vaste voorkeur zodat de
// R2-ledger niet per run van bestandsnaam wisselt.
function matchIdPriority(matchId) {
  const id = String(matchId || "");
  if (id.startsWith("ss-fotmob-")) return 0;
  if (/^ss-\d+$/.test(id)) return 1;
  if (id.startsWith("ss-espn-")) return 3;
  return 2;
}

export function dedupeUpcomingMatches(rows = []) {
  const byFixture = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = buildMatchDedupeKey({
      date: row?.kickoff,
      league: row?.league,
      homeTeamName: row?.homeTeam,
      awayTeamName: row?.awayTeam,
    }) || String(row?.matchId || "");
    const current = byFixture.get(key);
    if (!current) {
      byFixture.set(key, row);
      continue;
    }
    const keepRow = matchIdPriority(row?.matchId) < matchIdPriority(current?.matchId) ? row : current;
    const dropRow = keepRow === row ? current : row;
    byFixture.set(key, {
      ...keepRow,
      duplicateIds: [...new Set([
        ...(Array.isArray(keepRow?.duplicateIds) ? keepRow.duplicateIds : []),
        ...(Array.isArray(dropRow?.duplicateIds) ? dropRow.duplicateIds : []),
        dropRow?.matchId,
      ])].filter((id) => id && id !== keepRow?.matchId),
    });
  }
  return [...byFixture.values()];
}