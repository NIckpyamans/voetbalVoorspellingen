import fs from "fs";
import path from "path";
import { normalizeTeamIdentityName } from "./team-identity.js";

function scorePair(value) {
  const match = String(value || "").match(/(\d+)\s*[-:]\s*(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function samePair(item, homeName, awayName) {
  const itemHome = normalizeTeamIdentityName(item?.homeTeamName);
  const itemAway = normalizeTeamIdentityName(item?.awayTeamName);
  const home = normalizeTeamIdentityName(homeName);
  const away = normalizeTeamIdentityName(awayName);
  return (itemHome === home && itemAway === away) || (itemHome === away && itemAway === home);
}

function orient(item, homeName) {
  const rawScore = scorePair(item?.score || item?.actualScore) ||
    (Number.isFinite(Number(item?.homeScore)) && Number.isFinite(Number(item?.awayScore))
      ? [Number(item.homeScore), Number(item.awayScore)]
      : null);
  if (!rawScore) return null;
  const currentOrientation = normalizeTeamIdentityName(item.homeTeamName) === normalizeTeamIdentityName(homeName);
  return {
    date: item.date,
    league: item.league,
    homeTeam: currentOrientation ? item.homeTeamName : item.awayTeamName,
    awayTeam: currentOrientation ? item.awayTeamName : item.homeTeamName,
    homeScore: currentOrientation ? rawScore[0] : rawScore[1],
    awayScore: currentOrientation ? rawScore[1] : rawScore[0],
    source: item.dataSource || item.evaluationSource || "local-reviewed-result",
  };
}

export function readLocalH2HProfile(root, match, limit = 5) {
  const cutoff = Date.parse(match?.kickoff_at || "") || Date.now();
  const candidates = [];
  const daysDir = path.join(root, "data", "days");
  if (fs.existsSync(daysDir)) {
    for (const filename of fs.readdirSync(daysDir).filter((name) => name.endsWith(".json"))) {
      const date = filename.slice(0, 10);
      if (Date.parse(`${date}T00:00:00Z`) >= cutoff) continue;
      try {
        const day = JSON.parse(fs.readFileSync(path.join(daysDir, filename), "utf8"));
        for (const item of Array.isArray(day?.matches) ? day.matches : []) {
          if (!samePair(item, match.home_team_name, match.away_team_name)) continue;
          if (!/^(?:FT|finished)$/i.test(String(item.status || "")) && !item.score) continue;
          candidates.push({ ...item, date: item.date || date });
        }
      } catch {
        // One malformed compact day must not block the remaining local history.
      }
    }
  }
  try {
    const history = JSON.parse(fs.readFileSync(path.join(root, "data", "history-summary.json"), "utf8"));
    for (const item of Object.values(history?.postMatchReviews || {})) {
      if (Date.parse(`${item?.date || ""}T00:00:00Z`) >= cutoff) continue;
      if (samePair(item, match.home_team_name, match.away_team_name)) candidates.push(item);
    }
  } catch {
    // The day cache remains the fallback when the review summary is unavailable.
  }
  const unique = new Map();
  for (const item of candidates) {
    const result = orient(item, match.home_team_name);
    if (!result) continue;
    unique.set(`${result.date}|${normalizeTeamIdentityName(result.homeTeam)}|${normalizeTeamIdentityName(result.awayTeam)}|${result.homeScore}-${result.awayScore}`, result);
  }
  const results = [...unique.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-limit);
  return results.length ? { results, source: "local immutable match history", asOf: new Date().toISOString() } : null;
}
