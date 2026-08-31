import { buildR2ObjectKey, getR2Config, getR2Object } from "../../shared/cloudflare-r2.js";

const MINUTE = 60 * 1000;

function validDate(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

export function minutesUntilKickoff(kickoff, capturedAt = new Date().toISOString()) {
  const kickoffMs = validDate(kickoff);
  const capturedMs = validDate(capturedAt);
  if (kickoffMs == null || capturedMs == null) return null;
  return Math.floor((kickoffMs - capturedMs) / MINUTE);
}

export function classifyLineupCaptureWindow(minutes) {
  if (!Number.isFinite(minutes)) return "outside";
  if (minutes >= 61 && minutes <= 90) return "t75";
  if (minutes >= 31 && minutes <= 60) return "t45";
  if (minutes >= 5 && minutes <= 30) return "t20";
  return "outside";
}

export function classifyOddsCaptureRole(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "invalid";
  if (minutes <= 30) return "closing";
  if (minutes <= 360) return "prematch";
  return "opening";
}

function captureId(provider, capturedAt, role) {
  return `${String(provider || "unknown").toLowerCase()}|${capturedAt}|${role}`;
}

function lineupFingerprint(lineup) {
  const names = (side) => [
    ...(Array.isArray(side?.players) ? side.players : []),
    ...(Array.isArray(side?.starters) ? side.starters : []),
  ].map((player) => String(player?.name || player || "").toLowerCase().trim()).filter(Boolean).sort();
  return JSON.stringify({ confirmed: Boolean(lineup?.confirmed), home: names(lineup?.home), away: names(lineup?.away) });
}

export function mergeLineupCaptureLedger(current, { match, provider, lineup, capturedAt = new Date().toISOString() }) {
  const minutesBeforeKickoff = minutesUntilKickoff(match?.kickoff_at || match?.kickoff, capturedAt);
  const captureWindow = classifyLineupCaptureWindow(minutesBeforeKickoff);
  const previous = current && typeof current === "object" ? current : {};
  const attempts = Array.isArray(previous.attempts)
    ? [...previous.attempts]
    : previous.lineupSummary && previous.capturedAt
      ? [{
          id: captureId(previous.provider, previous.capturedAt, previous.captureWindow || "legacy"),
          capturedAt: previous.capturedAt,
          minutesBeforeKickoff: previous.minutesBeforeKickoff ?? minutesUntilKickoff(previous.kickoff, previous.capturedAt),
          captureWindow: previous.captureWindow || "legacy",
          provider: previous.provider,
          confirmed: Boolean(previous.lineupSummary?.confirmed),
          lineupSummary: previous.lineupSummary,
        }]
      : [];
  const attempt = {
    id: captureId(provider, capturedAt, captureWindow),
    capturedAt,
    minutesBeforeKickoff,
    captureWindow,
    provider,
    confirmed: Boolean(lineup?.confirmed),
    lineupSummary: lineup,
    lineupFingerprint: lineupFingerprint(lineup),
  };
  if (!attempts.some((item) => item.id === attempt.id)) attempts.push(attempt);
  attempts.sort((left, right) => Date.parse(left.capturedAt || "") - Date.parse(right.capturedAt || ""));
  const confirmedAttempts = attempts.filter((item) => item.confirmed);
  const firstConfirmed = confirmedAttempts[0] || null;
  const latest = attempts.at(-1) || attempt;
  return {
    schemaVersion: "critical-lineups-v2",
    matchId: match?.match_id || match?.matchId,
    kickoff: match?.kickoff_at || match?.kickoff,
    updatedAt: capturedAt,
    capturedAt: latest.capturedAt,
    provider: latest.provider,
    captureWindow: latest.captureWindow,
    minutesBeforeKickoff: latest.minutesBeforeKickoff,
    lineupSummary: latest.lineupSummary,
    latestFingerprint: latest.lineupFingerprint || lineupFingerprint(latest.lineupSummary),
    revisionCount: new Set(attempts.map((item) => item.lineupFingerprint || lineupFingerprint(item.lineupSummary))).size,
    firstConfirmedAt: previous.firstConfirmedAt || firstConfirmed?.capturedAt || null,
    firstConfirmedProvider: previous.firstConfirmedProvider || firstConfirmed?.provider || null,
    attempts: attempts.slice(-12),
  };
}

export function mergeOddsCaptureLedger(current, match, odds, capturedAt = odds?.capturedAt || new Date().toISOString()) {
  const previous = current && typeof current === "object" ? current : {};
  const snapshots = Array.isArray(previous.snapshots) ? [...previous.snapshots] : [];
  const minutesBeforeKickoff = minutesUntilKickoff(match?.kickoff, capturedAt);
  const roleAtCapture = classifyOddsCaptureRole(minutesBeforeKickoff);
  const event = {
    id: captureId(`${odds?.provider || "unknown"}:${odds?.bookmaker || "unknown"}`, capturedAt, roleAtCapture),
    provider: odds?.provider,
    bookmaker: odds?.bookmaker,
    market: odds?.market || "1X2",
    home: Number(odds?.home),
    draw: Number(odds?.draw),
    away: Number(odds?.away),
    capturedAt,
    minutesBeforeKickoff,
    roleAtCapture,
  };
  if (!snapshots.some((item) => item.id === event.id)) snapshots.push(event);
  const kickoffMs = validDate(match?.kickoff);
  const valid = snapshots
    .filter((item) => [item.home, item.draw, item.away].every((value) => Number(value) > 1))
    .filter((item) => {
      const capturedMs = validDate(item.capturedAt);
      return capturedMs != null && kickoffMs != null && capturedMs < kickoffMs;
    })
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
  const opening = valid.find((item) => item.roleAtCapture === "opening") || valid[0] || null;
  const prematchCandidates = valid.filter((item) => item.roleAtCapture === "prematch");
  const prematch = prematchCandidates.at(-1) || valid.filter((item) => item.minutesBeforeKickoff > 30).at(-1) || opening;
  const closing = valid.filter((item) => item.roleAtCapture === "closing").at(-1) || null;
  return {
    schemaVersion: "critical-odds-v2",
    match,
    updatedAt: new Date().toISOString(),
    opening,
    prematch,
    closing,
    snapshots: valid.slice(-48),
  };
}

export function selectConfirmedLineupCapture(payload, kickoffAt) {
  const kickoffMs = validDate(kickoffAt);
  if (!payload || kickoffMs == null) return null;
  const candidates = [
    ...(Array.isArray(payload.attempts) ? payload.attempts : []),
    payload.lineupSummary ? payload : null,
  ]
    .filter(Boolean)
    .filter((item) => item?.lineupSummary?.confirmed)
    .filter((item) => validDate(item.capturedAt) != null && validDate(item.capturedAt) < kickoffMs)
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
  const selected = candidates.at(-1);
  if (!selected) return null;
  return {
    ...payload,
    capturedAt: selected.capturedAt,
    provider: selected.provider || payload.provider,
    captureWindow: selected.captureWindow || payload.captureWindow || null,
    lineupSummary: selected.lineupSummary,
  };
}

export function selectOddsCapture(ledger, kickoffAt) {
  const kickoffMs = validDate(kickoffAt);
  const prematch = ledger?.prematch || ledger?.opening;
  const prematchMs = validDate(prematch?.capturedAt);
  if (!prematch || kickoffMs == null || prematchMs == null || prematchMs >= kickoffMs) return null;
  const closingMs = validDate(ledger?.closing?.capturedAt);
  const closing = ledger?.closing && closingMs != null && closingMs < kickoffMs ? ledger.closing : null;
  return {
    status: "available_r2_fallback",
    provider: prematch.provider || "cloudflare-r2-odds-ledger",
    reason: "Timestamped odds geladen uit de Cloudflare R2 critical-capture ledger.",
    oddsAtPrediction: {
      ...prematch,
      openingHome: ledger?.opening?.home ?? null,
      openingDraw: ledger?.opening?.draw ?? null,
      openingAway: ledger?.opening?.away ?? null,
      openingCapturedAt: ledger?.opening?.capturedAt || null,
      closingHome: closing?.home ?? null,
      closingDraw: closing?.draw ?? null,
      closingAway: closing?.away ?? null,
      closingCapturedAt: closing?.capturedAt || null,
    },
  };
}

async function readCriticalCapture(relativeKey) {
  const config = getR2Config();
  if (!config.configured) return null;
  const object = await getR2Object({ config, key: buildR2ObjectKey(config, relativeKey) }).catch(() => null);
  if (!object?.ok) return null;
  return JSON.parse(object.body.toString("utf8"));
}

export async function fetchR2LineupSummary(matchId, kickoffAt, now = Date.now()) {
  if (String(process.env.R2_CRITICAL_CAPTURE_ENABLED || "true").toLowerCase() === "false") return null;
  const kickoffMs = validDate(kickoffAt);
  // Later worker runs must retain a lineup captured before kickoff. The
  // selector below enforces that timestamp boundary, so wall-clock age is not
  // a valid reason to erase confirmed evidence from the published match.
  if (kickoffMs == null) return null;
  return selectConfirmedLineupCapture(await readCriticalCapture(`critical-captures/lineups/${matchId}.json`), kickoffAt);
}

export async function fetchR2OddsSnapshot(matchId, kickoffAt) {
  if (String(process.env.R2_CRITICAL_CAPTURE_ENABLED || "true").toLowerCase() === "false") return null;
  return selectOddsCapture(await readCriticalCapture(`critical-captures/odds/${matchId}.json`), kickoffAt);
}

export async function fetchR2H2HProfile(matchId, kickoffAt) {
  if (String(process.env.R2_CRITICAL_CAPTURE_ENABLED || "true").toLowerCase() === "false") return null;
  const payload = await readCriticalCapture(`critical-captures/h2h/${matchId}.json`);
  const capturedMs = validDate(payload?.capturedAt);
  const kickoffMs = validDate(kickoffAt);
  if (!payload?.h2h?.results?.length || capturedMs == null || kickoffMs == null || capturedMs >= kickoffMs) return null;
  return payload;
}
