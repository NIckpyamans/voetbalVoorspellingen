// Gesloten leercyclus per club: na elke afgeronde wedstrijd worden Elo-ratings
// bijgewerkt (K × segmentgewicht × doelmarge) en het thuisvoordeel als EMA bewaard.
// De worker gebruikt deze geleerde ratings als fallback zodra ClubElo ontbreekt of
// verouderd is — elke gespeelde wedstrijd werkt zo automatisch door in toekomstige
// voorspellingen.
import { competitionSegment } from "./competition-segmentation.js";
import { canonicalDedupeTeam } from "../../shared/matchNormalization.js";

export const LEARNED_ELO_VERSION = "learned-elo-v1";
const BASE_ELO = 1500;
const BASE_K = 22;
const HOME_ADVANTAGE_EMA_ALPHA = 0.08;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value || 0)));

function segmentWeight(league) {
  const segment = competitionSegment({ league });
  if (segment === "regular_league") return 1;
  if (segment === "knockout_cup") return 0.7;
  if (segment === "friendly") return 0.15;
  return 0.5;
}

function expectedScore(homeElo, awayElo, homeAdvantage) {
  return 1 / (1 + Math.pow(10, -(homeElo + homeAdvantage - awayElo) / 400));
}

function actualScore(homeGoals, awayGoals) {
  return homeGoals > awayGoals ? 1 : homeGoals === awayGoals ? 0.5 : 0;
}

// Chronologisch verwerken; elke wedstrijd één keer. Union of two teams.
export function updateLearnedElo(reviews = {}, previous = {}, { now = Date.now() } = {}) {
  const ratings = { ...(previous?.ratings || {}) };
  const meta = { ...(previous?.meta || {}) };
  let homeAdvantage = Number(previous?.homeAdvantage ?? 65);
  let processed = 0;
  const sorted = Object.values(reviews || {})
    .filter((review) => {
      const match = String(review?.actualScore || "").match(/(\d+)\s*-\s*(\d+)/);
      return match && Number.isFinite(Number(match[1])) && Number.isFinite(Number(match[2]));
    })
    .sort((left, right) => {
      const leftTime = Date.parse(String(left?.createdAt || left?.date || "")) || 0;
      const rightTime = Date.parse(String(right?.createdAt || right?.date || "")) || 0;
      return leftTime - rightTime;
    });
  for (const review of sorted) {
    const [, homeRaw, awayRaw] = String(review.actualScore).match(/(\d+)\s*-\s*(\d+)/);
    const homeGoals = Number(homeRaw);
    const awayGoals = Number(awayRaw);
    const homeKey = canonicalDedupeTeam(review?.homeTeamName);
    const awayKey = canonicalDedupeTeam(review?.awayTeamName);
    if (!homeKey || !awayKey || homeKey === awayKey) continue;
    const weight = segmentWeight(review?.league);
    if (weight <= 0.05) continue;
    const kickoff = Date.parse(String(review?.createdAt || review?.date || "")) || now;
    const before = ratings[homeKey] ?? BASE_ELO;
    const against = ratings[awayKey] ?? BASE_ELO;
    // Aging: ratings relateren aan laatste activiteit — niets doen is hier OK omdat
    // verwerking chronologisch is en elke nieuwe wedstrijd weer bijwerkt.
    const expected = expectedScore(before, against, homeAdvantage);
    const actual = actualScore(homeGoals, awayGoals);
    const margin = Math.abs(homeGoals - awayGoals);
    const k = BASE_K * weight * (1 + Math.min(margin, 4) * 0.15);
    const delta = k * (actual - expected);
    ratings[homeKey] = Math.round(before + delta);
    ratings[awayKey] = Math.round(against - delta);
    // Thuisvoordeel leren: gemeten thuiswin-percentage vs. verwacht.
    homeAdvantage = clamp(
      homeAdvantage + HOME_ADVANTAGE_EMA_ALPHA * weight * ((actual - expected) * 400) * 0.25,
      20,
      120
    );
    for (const [key, teamName] of [
      [homeKey, review?.homeTeamName],
      [awayKey, review?.awayTeamName],
    ]) {
      const entry = meta[key] || { teamName: String(teamName || "").trim(), matches: 0, lastKickoff: null };
      entry.matches += 1;
      entry.lastKickoff = new Date(kickoff).toISOString();
      entry.teamName = String(teamName || entry.teamName || "").trim();
      meta[key] = entry;
    }
    processed += 1;
  }
  return {
    version: LEARNED_ELO_VERSION,
    ratings,
    meta,
    homeAdvantage: Number(homeAdvantage.toFixed(1)),
    processedMatches: processed,
    updatedAt: new Date(now).toISOString(),
  };
}

// Lookup met fallback: geleerde rating, of null zodat de bestaande pipeline doorloopt.
export function lookupLearnedElo(learnedElo, teamName) {
  const key = canonicalDedupeTeam(teamName);
  if (!key) return null;
  const rating = Number(learnedElo?.ratings?.[key]);
  if (!Number.isFinite(rating) || rating <= 0) return null;
  const meta = learnedElo?.meta?.[key] || {};
  const ageDays = meta.lastKickoff ? Math.max(0, (Date.now() - Date.parse(meta.lastKickoff)) / 86400000) : 999;
  // Verouderde ratings zakken in betrouwbaarheid; na 60 dagen zonder wedstrijd minimaal.
  const freshness = clamp(1 - ageDays / 90, 0.25, 1);
  return {
    elo: rating,
    matches: Number(meta.matches || 0),
    lastKickoff: meta.lastKickoff || null,
    freshness: Number(freshness.toFixed(2)),
    source: "learned-elo",
    version: learnedElo?.version || LEARNED_ELO_VERSION,
  };
}
