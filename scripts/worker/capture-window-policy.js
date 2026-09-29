// Capturevenster-beleid voor timestamped odds: captures worden expliciet rond
// T-75, T-45 en T-20 minuten voor aftrap gepland (plus opening ruim van tevoren
// en closing vlak voor aftrap). Kandidaten worden op urgentie gesorteerd zodat
// een run met beperkt quota-budget nooit een sluitend venster mist.

export const CAPTURE_WINDOWS = [
  { key: "t20", label: "closing T-20", minMinutes: 5, maxMinutes: 30, role: "closing" },
  { key: "t45", label: "prematch T-45", minMinutes: 31, maxMinutes: 60, role: "prematch" },
  { key: "t75", label: "prematch T-75", minMinutes: 61, maxMinutes: 90, role: "prematch" },
  { key: "prematch", label: "prematch algemeen", minMinutes: 91, maxMinutes: 360, role: "prematch" },
  { key: "opening", label: "opening", minMinutes: 361, maxMinutes: 36 * 60, role: "opening" },
];

const WINDOW_RANK = Object.fromEntries(CAPTURE_WINDOWS.map((window, index) => [window.key, index]));

export function captureWindowFor(minutesBeforeKickoff) {
  const minutes = Number(minutesBeforeKickoff);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return CAPTURE_WINDOWS.find((window) => minutes >= window.minMinutes && minutes <= window.maxMinutes) || null;
}

export function captureWindowKey(minutesBeforeKickoff) {
  return captureWindowFor(minutesBeforeKickoff)?.key || "outside";
}

function minutesUntil(kickoff, nowMs) {
  const kickoffMs = Date.parse(kickoff || "");
  return Number.isFinite(kickoffMs) ? Math.round((kickoffMs - nowMs) / 60000) : NaN;
}

// Sorteert kandidaten op capture-urgentie: sluitende vensters eerst (T-20 voor
// T-45 voor T-75), daarna overige prematch- en opening-captures. Binnen een
// venster gaat de eerst aftrapwedstrijd voor.
export function prioritizeCaptureCandidates(matches = [], nowMs = Date.now()) {
  return matches
    .map((match) => {
      const minutes = minutesUntil(match?.kickoff, nowMs);
      const window = captureWindowFor(minutes);
      return { match, minutes, windowKey: window?.key || "outside" };
    })
    .filter((entry) => Number.isFinite(entry.minutes) && entry.minutes > 0)
    .sort((left, right) => {
      const leftRank = WINDOW_RANK[left.windowKey] ?? CAPTURE_WINDOWS.length;
      const rightRank = WINDOW_RANK[right.windowKey] ?? CAPTURE_WINDOWS.length;
      return leftRank - rightRank || left.minutes - right.minutes;
    })
    .map((entry) => ({ ...entry.match, minutesBeforeKickoff: entry.minutes, captureWindow: entry.windowKey }));
}

export function summarizeCaptureWindows(matches = [], nowMs = Date.now()) {
  const summary = { t20: 0, t45: 0, t75: 0, prematch: 0, opening: 0, outside: 0 };
  for (const match of matches) {
    const key = captureWindowKey(minutesUntil(match?.kickoff, nowMs));
    summary[key] = Number(summary[key] || 0) + 1;
  }
  return summary;
}

// Quota-budgettoepassing: zonder spendable budget blijven alleen closing-
// captures over (die mogen de reserve gebruiken); de rest wordt overgeslagen in
// plaats van stilletjes het budget te verbranden.
export function applyCaptureBudget(candidates = [], quotaPlan = {}, nowMs = Date.now()) {
  const spendable = Object.values(quotaPlan?.providers || {}).reduce(
    (total, budget) => total + Math.max(0, Number(budget?.spendable || 0)),
    0
  );
  const selected = [];
  const skippedByBudget = [];
  let spentNonClosing = 0;
  for (const candidate of candidates) {
    const windowKey = captureWindowKey(minutesUntil(candidate?.kickoff, nowMs));
    // Closing-captures mogen de quota-reserve gebruiken en verbruiken het
    // gewone budget niet.
    const closingAllowed = windowKey === "t20";
    if (closingAllowed || spentNonClosing < spendable) {
      selected.push(candidate);
      if (!closingAllowed) spentNonClosing += 1;
    } else {
      skippedByBudget.push(candidate);
    }
  }
  return { selected, skippedByBudget, spendable };
}
