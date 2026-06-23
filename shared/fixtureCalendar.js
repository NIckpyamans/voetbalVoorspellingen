import { addDaysToDateKey } from "./date.js";

const DEFAULT_WINDOW_DAYS = 7;

function toCount(value) {
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value?.matches)) return value.matches.length;
  if (typeof value?.count === "number") return value.count;
  return 0;
}

function hasDayRecord(value) {
  return Boolean(value) && (Array.isArray(value) || Array.isArray(value?.matches) || typeof value?.count === "number");
}

function dateDiffDays(fromDateKey, toDateKey) {
  const from = new Date(`${fromDateKey}T12:00:00Z`);
  const to = new Date(`${toDateKey}T12:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function buildWindowDates(today, windowDays) {
  return Array.from({ length: windowDays + 1 }, (_, index) => addDaysToDateKey(today, index));
}

function normalizeKnownDates(days, meta) {
  const metaDates = Array.isArray(meta?.dates) ? meta.dates : [];
  return [...new Set([...Object.keys(days || {}), ...metaDates])].sort();
}

function hasFreshSourceScan(meta) {
  return Boolean(
    meta?.dataScout?.lastScan ||
      meta?.dataCompletenessAudit?.generatedAt ||
      meta?.sourceCoverage ||
      meta?.competitionArchiveIndex?.generatedAt
  );
}

function findUpcomingMatch(today, days, knownDates) {
  return knownDates
    .map((date) => ({ date, count: toCount(days?.[date]), daysFromToday: dateDiffDays(today, date) }))
    .filter((item) => item.daysFromToday != null && item.daysFromToday >= 0 && item.count > 0)
    .sort((a, b) => a.daysFromToday - b.daysFromToday)[0] || null;
}

/**
 * @param {any} options
 */
export function buildFixtureCalendarStatus(options = {}) {
  const {
    today,
    days = {},
    meta = {},
    lastRunFresh = false,
    windowDays = DEFAULT_WINDOW_DAYS,
  } = options;
  const tomorrow = addDaysToDateKey(today, 1);
  const windowDates = buildWindowDates(today, windowDays);
  const knownDates = normalizeKnownDates(days, meta);
  const upcoming = findUpcomingMatch(today, days, knownDates);
  const todayCount = toCount(days[today]);
  const tomorrowCount = toCount(days[tomorrow]);
  const windowMatchDays = windowDates
    .map((date) => ({ date, count: toCount(days[date]) }))
    .filter((item) => item.count > 0);
  const coveredDates = windowDates.filter((date) => hasDayRecord(days[date]));
  const sourcesChecked = hasFreshSourceScan(meta);
  const expectedTomorrowGap = Array.isArray(meta?.dataScout?.gaps)
    ? meta.dataScout.gaps.some((gap) => String(gap?.title || "").toLowerCase().includes("morgen leeg"))
    : false;

  if (todayCount > 0 || tomorrowCount > 0) {
    return {
      status: "has_current_matches",
      healthy: true,
      emptyWindowOk: true,
      severity: "none",
      todayCount,
      tomorrowCount,
      windowDays,
      checkedDates: coveredDates,
      nextMatchDate: upcoming?.date || null,
      nextMatchCount: upcoming?.count || 0,
      explanation: "Vandaag of morgen staan er wedstrijden in de actuele data.",
    };
  }

  if (upcoming && upcoming.daysFromToday <= windowDays) {
    return {
      status: "idle_until_next_match",
      healthy: true,
      emptyWindowOk: true,
      severity: "none",
      todayCount,
      tomorrowCount,
      windowDays,
      checkedDates: coveredDates,
      nextMatchDate: upcoming.date,
      nextMatchCount: upcoming.count,
      explanation: `Geen wedstrijden vandaag/morgen; eerstvolgende bekende speeldag is ${upcoming.date}.`,
    };
  }

  if (upcoming && lastRunFresh && sourcesChecked) {
    return {
      status: "idle_until_next_known_match",
      healthy: true,
      emptyWindowOk: true,
      severity: "none",
      todayCount,
      tomorrowCount,
      windowDays,
      checkedDates: coveredDates,
      nextMatchDate: upcoming.date,
      nextMatchCount: upcoming.count,
      explanation: `Geen wedstrijden in de directe kalender; eerstvolgende bevestigde wedstrijd is ${upcoming.date}.`,
    };
  }

  if (lastRunFresh && sourcesChecked && coveredDates.length >= Math.min(2, windowDates.length)) {
    return {
      status: expectedTomorrowGap ? "confirmed_empty_with_gap_note" : "confirmed_empty_window",
      healthy: true,
      emptyWindowOk: true,
      severity: "none",
      todayCount,
      tomorrowCount,
      windowDays,
      checkedDates: coveredDates,
      nextMatchDate: upcoming?.date || null,
      nextMatchCount: upcoming?.count || 0,
      explanation: "Geen wedstrijden in de directe kalender; worker en fallbackbronnen hebben wel vers gedraaid.",
    };
  }

  return {
    status: "fixture_source_gap",
    healthy: false,
    emptyWindowOk: false,
    severity: "medium",
    todayCount,
    tomorrowCount,
    windowDays,
    checkedDates: coveredDates,
    nextMatchDate: upcoming?.date || null,
    nextMatchCount: upcoming?.count || 0,
    explanation: "Geen wedstrijden gevonden en onvoldoende kalenderbewijs dat dit een echte lege speeldag is.",
  };
}
