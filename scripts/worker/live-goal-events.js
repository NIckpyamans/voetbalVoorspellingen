function minuteValue(value) {
  if (value && typeof value === "object") {
    const current = value.minute ?? value.current ?? value.displayTime ?? value.addedTime ?? value.injuryTime;
    const added = value.extra ?? value.extraTime ?? value.injuryTimeAdded;
    if (current != null && added != null && Number(added) > 0) return minuteValue(`${current}+${added}`);
    return minuteValue(current);
  }
  const match = String(value ?? "").match(/(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/);
  if (!match) return { label: null, sort: Number.MAX_SAFE_INTEGER };
  const base = Number(match[1]);
  const added = Number(match[2] || 0);
  return { label: added ? `${base}+${added}` : String(base), sort: base + added / 100 };
}

function eventKind(event) {
  const incidentType = String(event?.incidentType || event?.eventType || event?.type?.text || event?.type?.name || event?.type || "").toLowerCase();
  const incidentClass = String(event?.incidentClass || event?.class?.text || event?.class?.name || event?.class || "").toLowerCase();
  const description = String(event?.text || event?.description || event?.reason || event?.detail || "").toLowerCase();
  const combined = `${incidentType} ${incidentClass} ${description}`;
  if (/missed|disallowed|cancelled|canceled|overturned|offside|no goal/.test(combined)) return null;
  if (/own.?goal/.test(combined)) return "own_goal";
  if (/goal|scorechange|score change/.test(combined)) return /penalty/.test(combined) ? "penalty" : "goal";
  if (/penalty/.test(combined) && /scored|converted/.test(combined)) return "penalty";
  if (event?.isGoal === true) return "goal";
  return null;
}

function isDisallowedGoal(event) {
  const kind = `${event?.incidentClass || ""} ${event?.class?.name || event?.class || ""} ${event?.reason || ""} ${event?.detail || ""}`.toLowerCase();
  return /missed|disallowed|cancelled|canceled|overturned|offside|no goal/.test(kind);
}

function eventSide(event, homeTeamId, awayTeamId) {
  if (event?.isHome === true || String(event?.side || "").toLowerCase() === "home") return "home";
  if (event?.isHome === false || String(event?.side || "").toLowerCase() === "away") return "away";
  const homeAway = String(event?.homeAway ?? event?.competitor?.homeAway ?? "").toLowerCase();
  if (homeAway === "home") return "home";
  if (homeAway === "away") return "away";
  const teamId = String(event?.team?.id ?? event?.teamId ?? event?.athlete?.team?.id ?? "");
  if (teamId && homeTeamId && teamId === homeTeamId) return "home";
  if (teamId && awayTeamId && teamId === awayTeamId) return "away";
  return null;
}

/** Build a stable event timeline from provider incidents without relying on a single feed shape. */
export function buildLiveGoalEventsFromMatch({ live, eventDetails, homeTeamName = "", awayTeamName = "" } = {}) {
  const sources = [
    live?.incidents,
    live?.events,
    live?.timeline,
    live?.goalMinuteEvents,
    eventDetails?.incidents,
    eventDetails?.events,
    eventDetails?.timeline,
    eventDetails?.goalMinuteEvents,
  ].filter(Array.isArray);
  if (!sources.length) return null;

  const homeTeamId = String(live?.homeTeam?.id ?? eventDetails?.homeTeam?.id ?? "");
  const awayTeamId = String(live?.awayTeam?.id ?? eventDetails?.awayTeam?.id ?? "");
  const homeTeamNameKey = String(homeTeamName || "").trim().toLowerCase();
  const awayTeamNameKey = String(awayTeamName || "").trim().toLowerCase();
  const byKey = new Map();
  for (const source of sources) {
    for (const event of source) {
      const kind = ["goal", "penalty", "own_goal"].includes(String(event?.kind || ""))
        ? event.kind
        : isDisallowedGoal(event) ? null : eventKind(event);
      if (!kind) continue;
      const side = eventSide(event, homeTeamId, awayTeamId) || (() => {
        const teamName = String(event?.team?.name || event?.teamName || "").trim().toLowerCase();
        if (teamName && teamName === homeTeamNameKey) return "home";
        if (teamName && teamName === awayTeamNameKey) return "away";
        return null;
      })();
      if (!side) continue;
      const minute = minuteValue(event?.time ?? event?.minute ?? event?.displayTime ?? event?.clock?.displayValue ?? event?.timeStr ?? event?.intTime);
      const rawPlayer = event?.player || event?.scorer || event?.athlete || event?.athletes?.[0] || {};
      const playerName = String(event?.playerName || event?.name || rawPlayer?.name || "").trim() || null;
      const scorerIdentity = String(playerName || event?.scorerId || event?.athlete?.id || "").toLowerCase();
      const identity = event?.id || event?.incidentId
        ? String(event.id || event.incidentId)
        : `${minute.label || "?"}|${side}|${kind}|${scorerIdentity}`;
      const key = identity;
      const normalized = {
        id: key,
        minute: minute.label,
        side,
        teamName: side === "home" ? homeTeamName : awayTeamName,
        playerName,
        kind,
      };
      const existing = byKey.get(key);
      byKey.set(key, existing
        ? { ...existing, ...normalized, playerName: normalized.playerName || existing.playerName }
        : normalized);
    }
  }
  if (!byKey.size) return null;
  return [...byKey.values()].sort((a, b) => {
    const aMinute = minuteValue(a.minute).sort;
    const bMinute = minuteValue(b.minute).sort;
    return aMinute - bMinute || a.side.localeCompare(b.side);
  });
}
