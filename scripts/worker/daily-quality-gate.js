import { buildTrainingAutomationState } from "./orchestration-policy.js";

function matchIdentity(match) {
  const date = String(match?._dateKey || match?.date || match?.kickoff || "").slice(0, 10);
  const home = String(match?.homeTeamName || match?.homeTeam || "").trim().toLowerCase();
  const away = String(match?.awayTeamName || match?.awayTeam || "").trim().toLowerCase();
  return `${date}|${home}|${away}`;
}

function hasFinalScore(match) {
  return /^\d+\s*-\s*\d+$/.test(String(match?.score || "").trim());
}

export function evaluateDailyQuality({ matches = [], training = {}, providerHealth = null, now = Date.now() } = {}) {
  const nowMs = new Date(now).getTime();
  const identities = new Map();
  const duplicateFixtures = [];
  const incompleteFinals = [];
  const invalidUpcomingTeams = [];
  const cutoff = new Date(nowMs).toISOString().slice(0, 10);

  for (const match of matches) {
    const identity = matchIdentity(match);
    const count = (identities.get(identity) || 0) + 1;
    identities.set(identity, count);
    if (count === 2) duplicateFixtures.push(identity);
    const status = String(match?.status || "").toUpperCase();
    if (/^(FT|AET|PEN)$/.test(status) && !hasFinalScore(match)) incompleteFinals.push(identity);
    const date = String(match?._dateKey || match?.date || match?.kickoff || "").slice(0, 10);
    const names = `${match?.homeTeamName || match?.homeTeam || ""} ${match?.awayTeamName || match?.awayTeam || ""}`;
    if (date >= cutoff && /\b(tbd|unknown|null)\b/i.test(names)) invalidUpcomingTeams.push(identity);
  }

  const providerGeneratedAt = Date.parse(providerHealth?.generatedAt || providerHealth?.checkedAt || "");
  const providerAgeHours = Number.isFinite(providerGeneratedAt) ? Math.max(0, (nowMs - providerGeneratedAt) / 3600000) : null;
  const trainingAutomation = buildTrainingAutomationState(training, { calibrationMin: 50, promotionMin: 150, regularCalibrationMin: 50 });
  const blockers = [
    duplicateFixtures.length ? `duplicate_fixtures:${duplicateFixtures.length}` : null,
    incompleteFinals.length ? `completed_without_score:${incompleteFinals.length}` : null,
    invalidUpcomingTeams.length ? `upcoming_unknown_teams:${invalidUpcomingTeams.length}` : null,
  ].filter(Boolean);
  const warnings = [
    providerAgeHours === null || providerAgeHours > 26 ? "provider_health_stale" : null,
    trainingAutomation.regularCalibrationGap > 0 ? `regular_training_gap:${trainingAutomation.regularCalibrationGap}` : null,
  ].filter(Boolean);

  return {
    ok: blockers.length === 0,
    status: blockers.length ? "blocked" : warnings.length ? "watch" : "healthy",
    generatedAt: new Date(nowMs).toISOString(),
    totals: { matches: matches.length, duplicateFixtures: duplicateFixtures.length, incompleteFinals: incompleteFinals.length, invalidUpcomingTeams: invalidUpcomingTeams.length },
    trainingAutomation,
    providerHealth: { available: !!providerHealth, ageHours: providerAgeHours === null ? null : Number(providerAgeHours.toFixed(2)) },
    blockers,
    warnings,
    samples: { duplicateFixtures: duplicateFixtures.slice(0, 10), incompleteFinals: incompleteFinals.slice(0, 10), invalidUpcomingTeams: invalidUpcomingTeams.slice(0, 10) },
  };
}
