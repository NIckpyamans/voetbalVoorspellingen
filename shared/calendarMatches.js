import { addDaysToDateKey } from "./date.js";

export function countFixturesByDate(matches = [], rangeStart, rangeEnd) {
  const counts = new Map();
  for (const match of Array.isArray(matches) ? matches : []) {
    const date = String(match?.date || match?.kickoff || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < rangeStart || date > rangeEnd) continue;
    counts.set(date, (counts.get(date) || 0) + 1);
  }
  return counts;
}

export function advanceRollingCalendarStart(currentStart, today, followToday = true) {
  return followToday || !currentStart || currentStart < today ? today : currentStart;
}

export function rollingCalendarEnd(start, days = 21) {
  return addDaysToDateKey(start, days - 1);
}
