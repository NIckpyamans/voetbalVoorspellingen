const FRIENDLY_PATTERN = /friendl|oefen/i;
const KNOCKOUT_PATTERN = /champions league|europa league|conference league|\bcup\b|beker|pokal|coppa|copa|coupe|qualification|qualifier|play-?off/i;
const REGULAR_LEAGUE_PATTERN = /eredivisie|eerste divisie|premier league|championship|bundesliga|la ?liga|segunda|serie [ab]\b|ligue [12]\b|liga portugal|pro league/i;

export function competitionSegment(row = {}) {
  const league = String(row?.league || row?.competition || "").trim();
  if (FRIENDLY_PATTERN.test(league)) return "friendly";
  if (REGULAR_LEAGUE_PATTERN.test(league) && !KNOCKOUT_PATTERN.test(league)) return "regular_league";
  if (KNOCKOUT_PATTERN.test(league)) return "knockout_cup";
  if (Number(row?.features?.phase_league || 0) >= 0.5) return "regular_league";
  if (Number(row?.features?.phase_cup || 0) >= 0.5 || Number(row?.features?.phase_knockout || 0) >= 0.5) return "knockout_cup";
  return "unknown";
}

export function isRegularCompetitionRow(row) {
  return competitionSegment(row) === "regular_league";
}

export function isCompletedTrainingRow(row = {}) {
  const status = String(row?.status || "").toUpperCase();
  if (status) return /^(FT|AET|PEN)$/.test(status);
  return ["H", "D", "A"].includes(String(row?.label || row?.actual_outcome || "").toUpperCase());
}

export function uniqueCompletedMatchCount(rows = []) {
  return new Set(rows
    .filter(isCompletedTrainingRow)
    .map((row) => String(row?.matchId || row?.match_id || "").trim())
    .filter(Boolean)).size;
}

export function uniqueRegularMatchCount(rows = []) {
  return new Set(rows
    .filter((row) => isCompletedTrainingRow(row) && isRegularCompetitionRow(row))
    .map((row) => String(row?.matchId || row?.match_id || "").trim())
    .filter(Boolean)).size;
}
