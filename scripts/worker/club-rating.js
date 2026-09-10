// Global, fixed scales: ratings do not depend on which opponent is selected.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Number(n.toFixed(2));
export const CLUB_RATING_VERSION = "club-rating-v2";
export const eloToRating = (elo) => clamp(50 + (elo - 1500) / 10, 1, 99);
export const valueToRating = (eur) => clamp(50 + 20 * Math.log10(eur / 3000000), 1, 99);

export function squadValueEvidence(squad = {}) {
  const seen = new Set();
  const players = (squad.players || []).filter((p) => {
    const key = String(p.name || p.id || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    if (!key || seen.has(key) || /coach|manager|departed|retired|loaned out/i.test(`${p.position} ${p.status}`)) return false;
    seen.add(key);
    return true;
  });
  const valued = players.map(p => Number(p.marketValueEur)).filter(v => Number.isFinite(v) && v > 0).sort((a,b) => b-a);
  const coverage = valued.length / Math.max(18, players.length);
  // A star with a price and twenty unpriced players is not a measured squad.
  const usable = valued.length >= 11 && coverage >= 0.6;
  const best = valued.slice(0, 18);
  const average = best.length ? best.reduce((a,b) => a+b,0) / best.length : 0;
  const ratings = players.filter(p => !p.ratingSource || p.ratingSource === "provider")
    .map(p => Number(p.rating)).filter(v => Number.isFinite(v) && v >= 1 && v <= 10);
  return { playerCount: players.length, valuedPlayers: valued.length, coverage: round(coverage),
    totalValueEur: valued.length ? Math.round(valued.reduce((a,b)=>a+b,0)) : null,
    valueRating: usable ? round(valueToRating(average)) : null,
    ratedPlayers: ratings.length,
    performanceAverage: ratings.length >= 11 ? round(ratings.reduce((a,b)=>a+b,0)/ratings.length) : null };
}

export function competitionStrength(snapshot, profile) {
  if (!snapshot?.profiles || !profile?.country) return null;
  const unique = new Map(Object.values(snapshot.profiles).filter(p => p.country === profile.country)
    .map(p => [p.club, p]));
  const knownLevel = profile.level != null;
  const rows = [...unique.values()].filter(p => !knownLevel || p.level === profile.level)
    .map(p => Number(p.elo)).filter(v => v > 0).sort((a,b)=>b-a);
  // HTML fallback has no division metadata. Its top 16 are an explicitly
  // labelled national competition proxy, never an invented official ranking.
  const sample = knownLevel ? rows : rows.slice(0,16);
  if (sample.length < 6) return null;
  const mid = Math.floor(sample.length/2);
  const median = sample.length % 2 ? sample[mid] : (sample[mid-1]+sample[mid])/2;
  return { rating: round(eloToRating(median)), medianElo: round(median), teams: sample.length,
    country: profile.country, level: profile.level ?? null,
    method: knownLevel ? "division-median-clubelo" : "country-top16-median-proxy",
    source: "ClubElo", asOf: snapshot.asOf };
}

export function calculateClubRating({ clubEloProfile, squadProfile, leagueProfile, asOf = new Date().toISOString() } = {}) {
  const evidence = squadValueEvidence(squadProfile);
  const date = (v) => typeof v === "number" ? v : Date.parse(v || "");
  const age = (v) => (date(asOf) - date(v)) / 86400000;
  const eloAge = age(clubEloProfile?.asOf);
  const squadAge = age(squadProfile?.fetchedAt);
  const leagueAge = age(leagueProfile?.asOf);
  const elo = Number(clubEloProfile?.elo);
  const eloValid = elo > 0 && eloAge >= 0 && eloAge <= 14;
  const squadValid = squadAge >= 0 && squadAge <= 30;
  const leagueValid = leagueProfile?.rating > 0 && leagueAge >= 0 && leagueAge <= 14;
  const parts = [];
  if (squadValid && evidence.valueRating != null) parts.push({ key: "squadValue", rating: evidence.valueRating, weight: 0.45, source: squadProfile.source, asOf: squadProfile.fetchedAt });
  if (eloValid) parts.push({ key: "clubElo", rating: eloToRating(elo), weight: 0.35, source: "ClubElo", asOf: clubEloProfile.asOf });
  // A domestic performance average only becomes comparable in league context.
  if (leagueValid) parts.push({ key: "competition", rating: leagueProfile.rating, weight: 0.15, source: leagueProfile.source, asOf: leagueProfile.asOf });
  if (squadValid && leagueValid && evidence.performanceAverage != null) parts.push({ key: "playerPerformance", rating: clamp(leagueProfile.rating + (evidence.performanceAverage-6.8)*10,1,99), weight: 0.05, source: squadProfile.source, asOf: squadProfile.fetchedAt });
  const anchored = parts.some(p => p.key === "squadValue" || p.key === "clubElo");
  const coverage = parts.reduce((s,p)=>s+p.weight,0);
  const rating = anchored ? round(parts.reduce((s,p)=>s+p.rating*p.weight,0)/coverage) : null;
  const reliability = anchored ? round(Math.min(1, coverage)) : 0;
  return { version: CLUB_RATING_VERSION, rating, reliability, quality: reliability >= 0.85 ? "hoog" : reliability >= 0.45 ? "middel" : "laag",
    components: parts.map(p=>({...p, rating: round(p.rating), effectiveWeight: round(p.weight/(coverage||1))})),
    valueEvidence: evidence, competition: leagueValid ? leagueProfile : null,
    missing: [!squadValid || evidence.valueRating == null ? "voldoende actuele spelerswaarden" : null, !eloValid ? "actuele ClubElo" : null, !leagueValid ? "competitiesterkte" : null, !squadValid || evidence.performanceAverage == null ? "voldoende gemeten spelersprestaties" : null].filter(Boolean),
    label: rating == null ? "onbekend" : rating >= 80 ? "zeer sterk" : rating >= 65 ? "sterk" : rating >= 50 ? "gemiddeld" : "kwetsbaar",
    source: "ClubElo, selectiewaarde en competitiegecorrigeerde spelersprestaties", sourceAsOf: asOf };
}

export function clubRatingMatchSignal(home, away) {
  if (home?.version !== CLUB_RATING_VERSION || away?.version !== CLUB_RATING_VERSION || home.rating == null || away.rating == null) return null;
  const reliability = Math.min(home.reliability || 0, away.reliability || 0);
  if (reliability < 0.35) return null;
  const difference = home.rating-away.rating;
  const shift = clamp(difference/60, -0.6, 0.6) * Math.sqrt(reliability);
  return { difference: round(difference), reliability, homeMultiplier: Math.exp(shift), awayMultiplier: Math.exp(-shift) };
}
