// Odds-rol-integriteit: de leerlijn en CLV/ROI mogen alleen records meetellen
// met een expliciete opening-, prematch- of closing-rol én een geldige
// capture-timestamp. Deze module herstelt ontbrekende roltoewijzingen en
// timestamps op basis van beschikbaar bewijs (kickoff, closing-kolommen).

export const COUNTABLE_ODDS_ROLES = ["opening", "prematch", "closing"];

export function isCountableOddsRole(role) {
  return COUNTABLE_ODDS_ROLES.includes(String(role || "").toLowerCase());
}

export function hasUsableOddsTimestamp(capturedAt) {
  return Number.isFinite(Date.parse(capturedAt || ""));
}

export function isCountableOddsRow(row = {}) {
  return isCountableOddsRole(row.oddsRole ?? row.odds_role) && hasUsableOddsTimestamp(row.capturedAt ?? row.captured_at);
}

export function deriveOddsRole(capturedAt, kickoffAt) {
  const capturedMs = Date.parse(capturedAt || "");
  const kickoffMs = Date.parse(kickoffAt || "");
  if (!Number.isFinite(capturedMs) || !Number.isFinite(kickoffMs)) return "unknown";
  if (capturedMs < kickoffMs) return "prematch";
  return "in_play";
}

function closingValues(row = {}) {
  return [row.closingHome ?? row.closing_home, row.closingDraw ?? row.closing_draw, row.closingAway ?? row.closing_away];
}

function prematchValues(row = {}) {
  return [row.home, row.draw, row.away];
}

function hasClosingOdds(row = {}) {
  return closingValues(row).some((value) => Number(value) > 1);
}

// Een closing-proxy-import (bijvoorbeeld football-data.co.uk) dupliceert de
// sluitingslijn in de prematch-kolommen. Zulke rijen zijn closing-bewijs, maar
// géén geldig prematch/closing-paar: de prematch-kant heeft geen eigen capture.
export function isClosingOnlyProxyRow(row = {}) {
  const closing = closingValues(row).map(Number);
  const prematch = prematchValues(row).map(Number);
  if (!closing.some((value) => value > 1)) return false;
  return closing.every((value, index) => Number.isFinite(value) && value > 1 && value === prematch[index]);
}

// Bepaal per rij welke velden hersteld kunnen worden. Alleen aantoonbaar
// herleidbare waarden worden voorgesteld: een closing-rij zonder timestamp
// krijgt de kick-off-tijd (het tijdstip waarop de sluitingslijn vastligt), een
// ontbrekende rol wordt afgeleid uit captured_at versus kickoff_at.
export function planOddsRoleRepair(row = {}) {
  const updates = {};
  const capturedAt = row.capturedAt ?? row.captured_at ?? null;
  const closingCapturedAt = row.closingCapturedAt ?? row.closing_captured_at ?? null;
  const kickoffAt = row.kickoffAt ?? row.kickoff_at ?? null;
  const role = String(row.oddsRole ?? row.odds_role ?? "").toLowerCase() || null;

  if (hasClosingOdds(row) && !hasUsableOddsTimestamp(closingCapturedAt) && hasUsableOddsTimestamp(kickoffAt)) {
    updates.closing_captured_at = new Date(Date.parse(kickoffAt)).toISOString();
  }

  const effectiveClosingAt = updates.closing_captured_at || closingCapturedAt;
  if (hasClosingOdds(row) && (!role || role === "closing_proxy" || role === "unknown") && hasUsableOddsTimestamp(capturedAt ?? effectiveClosingAt)) {
    updates.odds_role = "closing";
  } else if ((!role || role === "unknown") && hasUsableOddsTimestamp(capturedAt) && hasUsableOddsTimestamp(kickoffAt)) {
    const derived = deriveOddsRole(capturedAt, kickoffAt);
    if (derived !== "unknown") updates.odds_role = derived;
  }

  const closingOnlyProxy = isClosingOnlyProxyRow(row);
  const referenceAt = capturedAt ?? effectiveClosingAt;
  const referenceUsable = hasUsableOddsTimestamp(referenceAt) && hasUsableOddsTimestamp(kickoffAt);
  const availableBeforeKickoff = referenceUsable && !closingOnlyProxy && Date.parse(referenceAt) < Date.parse(kickoffAt);

  const currentAvailable = row.availableBeforeKickoff ?? row.available_before_kickoff;
  if (currentAvailable == null || Boolean(currentAvailable) !== availableBeforeKickoff) {
    updates.available_before_kickoff = availableBeforeKickoff;
  }

  const currentMinutes = Number(row.minutesBeforeKickoff ?? row.minutes_before_kickoff);
  if (availableBeforeKickoff && !Number.isFinite(currentMinutes)) {
    updates.minutes_before_kickoff = Math.floor((Date.parse(kickoffAt) - Date.parse(referenceAt)) / 60000);
  } else if (!availableBeforeKickoff && Number.isFinite(currentMinutes)) {
    updates.minutes_before_kickoff = null;
  }

  return Object.keys(updates).length ? updates : null;
}

// Rolherstel voor achteraf geïmporteerde closing-proxy-rijen: die rijen
// bevatten echte sluitingslijnen en tellen pas mee wanneer de rol en
// closing-timestamp teruggezet zijn.
export function isRepairableOddsRow(row = {}) {
  return planOddsRoleRepair(row) !== null;
}
