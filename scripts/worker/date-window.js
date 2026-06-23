export function toAmsterdamDateKey(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDaysToDateKey(dateKey, offset) {
  const base = new Date(`${dateKey}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}

export function buildRetainedDateSet(baseDateKey, daysBack, daysForward) {
  const retain = new Set();
  for (let offset = -daysBack; offset <= daysForward; offset += 1) {
    retain.add(addDaysToDateKey(baseDateKey, offset));
  }
  return retain;
}

export function resolveDateWindowToken(token, todayKey) {
  const value = String(token || "").trim().toLowerCase();
  if (!value) return null;
  if (value === "yesterday") return addDaysToDateKey(todayKey, -1);
  if (value === "today") return todayKey;
  if (value === "tomorrow") return addDaysToDateKey(todayKey, 1);
  if (value === "dayaftertomorrow" || value === "day-after-tomorrow") return addDaysToDateKey(todayKey, 2);
  if (/^[+-]?\d+$/.test(value)) return addDaysToDateKey(todayKey, Number(value));
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

export function buildRefreshDateWindow(todayKey, configuredWindow = "") {
  const configured = String(configuredWindow || "").trim();
  const tokens = configured ? configured.split(",") : ["-1", "0", "1", "2", "3", "4", "5", "6", "7"];
  const expanded = tokens.flatMap((token) => {
    const range = String(token || "").trim().match(/^([+-]?\d+)\.\.([+-]?\d+)$/);
    if (!range) return [token];
    const start = Number(range[1]);
    const end = Number(range[2]);
    const step = start <= end ? 1 : -1;
    const values = [];
    for (let value = start; value !== end + step; value += step) values.push(String(value));
    return values;
  });
  return [...new Set(expanded.map((token) => resolveDateWindowToken(token, todayKey)).filter(Boolean))].sort();
}
