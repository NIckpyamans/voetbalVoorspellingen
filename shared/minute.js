export function parseMinuteValue(minute, minuteValue = null) {
  if (typeof minuteValue === "number" && Number.isFinite(minuteValue)) return minuteValue;
  if (typeof minute === "number" && Number.isFinite(minute)) return minute;
  if (!minute) return null;
  if (String(minute).toUpperCase() === "HT") return 45;
  const plusMatch = String(minute).match(/(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) return Number(plusMatch[1]) + Number(plusMatch[2]);
  const plainMatch = String(minute).match(/(\d+)/);
  return plainMatch ? Number(plainMatch[1]) : null;
}

export function normalizeMinute(minute, minuteValue = null, extraTime = null, period = null) {
  const periodText = String(period || "").toLowerCase();
  if (periodText.includes("half time") || periodText.includes("halftime") || periodText.includes("break")) {
    return "HT";
  }

  const baseMinute = parseMinuteValue(minute, minuteValue);
  if (!baseMinute) return undefined;

  const extra = Number(extraTime || 0);
  return extra > 0 ? `${baseMinute}+${extra}'` : `${baseMinute}'`;
}

export function getLiveMinuteLabel(match, now = Date.now()) {
  const period = String(match?.period || "").toLowerCase();
  if (period.includes("half time") || period.includes("halftime") || period.includes("break")) return "HT";
  const base = parseMinuteValue(match?.minute, match?.minuteValue);
  if (base == null) return String(match?.status || "").toUpperCase() === "LIVE" ? "LIVE" : null;
  const updatedAt = Number(match?.liveUpdatedAt || 0) || 0;
  const drift = updatedAt > 0 ? Math.max(0, Math.floor((now - updatedAt) / 60000)) : 0;
  const total = base + drift;
  return total > 90 ? `90+${total - 90}'` : `${total}'`;
}
