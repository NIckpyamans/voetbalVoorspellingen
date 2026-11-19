// Laatste wedstrijden van één club met de bijbehorende voorspelling en review.
// De API levert de reviews aan; dit bestand matcht de clubnaam en rekent de
// hitpercentages uit. Alles is puur zodat het los getest kan worden.

import { canonicalDedupeTeam, normalizeDedupeText } from "./matchNormalization.js";

function parseScore(value) {
  const parsed = String(value ?? "").trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!parsed) return null;
  const home = Number(parsed[1]);
  const away = Number(parsed[2]);
  if (!Number.isSafeInteger(home) || !Number.isSafeInteger(away)) return null;
  return { home, away };
}

function outcomeFromScore(value) {
  const goals = parseScore(value);
  if (!goals) return null;
  if (goals.home > goals.away) return "H";
  if (goals.away > goals.home) return "A";
  return "D";
}

function normalizeOutcome(value) {
  const code = String(value || "").trim().toUpperCase();
  if (code === "H" || code === "D" || code === "A") return code;
  if (code === "THUIS" || code === "HOME") return "H";
  if (code === "GELIJK" || code === "DRAW") return "D";
  if (code === "UIT" || code === "AWAY") return "A";
  return null;
}

function leagueKey(value) {
  return normalizeDedupeText(value, { keepNumbers: true })
    .replace(/\b(uefa|europe)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Competitielabels verschillen per bron ("Netherlands - Eredivisie" versus
// "Eredivisie"); vergelijken op genormaliseerde tekst vangt dat af zonder
// Eerste Divisie en Eredivisie door elkaar te halen.
export function leagueNamesMatch(left, right) {
  const a = leagueKey(left);
  const b = leagueKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

// "exact" = dezelfde clubnaam na normalisatie; "fuzzy" = provider-variant
// ("PSV" versus "PSV Eindhoven"). Fuzzy matches zijn alleen betrouwbaar binnen
// dezelfde competitie, want "Sporting" alleen zegt niets over welke club.
export function teamNameMatchStrength(left, right) {
  const a = canonicalDedupeTeam(left);
  const b = canonicalDedupeTeam(right);
  if (!a || !b) return null;
  if (a === b) return "exact";
  const aTokens = a.split(" ").filter(Boolean);
  const bTokens = b.split(" ").filter(Boolean);
  if (!aTokens.length || !bTokens.length) return null;
  // "Ajax" mag niet matchen op "Jong Ajax" (en net zo min PSV/AZ/Jong PSV).
  // Reserve-elftallen zijn andere teams met eigen uitslagen.
  if (a.startsWith("jong ") !== b.startsWith("jong ")) return null;
  const [shortTokens, longTokens] = aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  // Alleen een voorvoegsel telt: "PSV" hoort bij "PSV Eindhoven", maar
  // "FC Eindhoven" (canoniek "eindhoven") is een andere club en mag daar niet
  // op matchen. Een token dat ergens in de lange naam voorkomt is te ruim.
  const isPrefix = shortTokens.length < longTokens.length && shortTokens.every((token, index) => longTokens[index] === token);
  const shortKey = shortTokens.join("");
  if (shortKey.length >= 3 && isPrefix) return "fuzzy";
  if (a.length >= 5 && b.length >= 5 && (a.startsWith(`${b} `) || b.startsWith(`${a} `))) return "fuzzy";
  return null;
}

function percentage(hits, total) {
  if (!total) return 0;
  return Math.round((hits / total) * 100);
}

function numericOrNull(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// De standen-popup vraagt om de laatste 5; het clubdossier in de geschiedenis
// vraagt om alles. "all" is daarom een expliciete waarde en geen hoog getal,
// zodat niemand per ongeluk een afkapgrens raakt.
function resolveLimit(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "all" || raw === "alles") return Number.POSITIVE_INFINITY;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(Math.max(Math.trunc(parsed), 1), 500);
}

function scoreRow(review, side, teamName) {
  const homeTeam = String(review.homeTeamName || review.home || "").trim();
  const awayTeam = String(review.awayTeamName || review.away || "").trim();
  const date = String(review.date || review.kickoff || "").slice(0, 10);
  if (!date) return null;
  const predictedScore = String(review.predictedScore || "").trim() || null;
  const actualScore = String(review.actualScore || "").trim() || null;
  const predictedOutcome = normalizeOutcome(review.predictedOutcome) || outcomeFromScore(predictedScore);
  const probabilityOutcome = normalizeOutcome(review.probabilityOutcome) || predictedOutcome;
  const actualOutcome = normalizeOutcome(review.actualOutcome) || outcomeFromScore(actualScore);
  const outcomeHit =
    typeof review.outcomeHit === "boolean"
      ? review.outcomeHit
      : predictedOutcome && actualOutcome
        ? predictedOutcome === actualOutcome
        : null;
  const exactHit =
    typeof review.exactHit === "boolean"
      ? review.exactHit
      : predictedScore && actualScore
        ? predictedScore === actualScore
        : null;
  const topPickHit =
    typeof review.probabilityOutcomeHit === "boolean"
      ? review.probabilityOutcomeHit
      : probabilityOutcome && actualOutcome
        ? probabilityOutcome === actualOutcome
        : null;
  const goalError =
    review.totalGoalError == null || review.totalGoalError === "" ? null : Number(review.totalGoalError);
  const goals = parseScore(actualScore);
  let result = null;
  if (goals) {
    const goalsFor = side === "home" ? goals.home : goals.away;
    const goalsAgainst = side === "home" ? goals.away : goals.home;
    result = goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
  }
  return {
    matchId: String(review.matchId || `${date}-${homeTeam}-${awayTeam}`),
    date,
    league: String(review.league || "").trim() || null,
    homeTeam,
    awayTeam,
    venue: side,
    opponent: side === "home" ? awayTeam : homeTeam,
    result,
    predictedScore,
    actualScore,
    predictedOutcome,
    probabilityOutcome,
    actualOutcome,
    outcomeHit,
    topPickHit,
    exactHit,
    goalError: Number.isFinite(goalError) ? goalError : null,
    confidence: numericOrNull(review.confidence),
    exactScoreConfidence: numericOrNull(review.exactScoreConfidence),
    brierScore: numericOrNull(review.brierScore),
    logLoss: numericOrNull(review.logLoss),
    oddsStatus: String(review.oddsStatus || "").trim() || null,
    modelVersion: String(review.modelVersion || "").trim() || null,
    isExactTeamMatch: teamNameMatchStrength(teamName, side === "home" ? homeTeam : awayTeam) === "exact",
    createdAt: Number(review.createdAt || 0),
  };
}

function rowCompleteness(row) {
  return (row.actualScore ? 2 : 0) + (row.predictedScore ? 2 : 0) + (row.outcomeHit != null ? 1 : 0);
}

export function buildTeamResults(reviews, options = {}) {
  const teamName = String(options.teamName || "").trim();
  const league = String(options.league || "").trim();
  const limit = resolveLimit(options.limit);
  if (!teamName) {
    return { team: "", league: league || null, matches: [], summary: null };
  }

  const entries = Array.isArray(reviews) ? reviews : Object.values(reviews || {});
  const byFixture = new Map();
  for (const review of entries) {
    if (!review) continue;
    const homeTeam = String(review.homeTeamName || review.home || "").trim();
    const awayTeam = String(review.awayTeamName || review.away || "").trim();
    if (!homeTeam || !awayTeam) continue;
    const homeStrength = teamNameMatchStrength(teamName, homeTeam);
    const awayStrength = teamNameMatchStrength(teamName, awayTeam);
    const side = homeStrength ? "home" : awayStrength ? "away" : null;
    if (!side) continue;
    const strength = side === "home" ? homeStrength : awayStrength;
    if (strength === "fuzzy" && league && !leagueNamesMatch(league, review.league)) continue;
    const row = scoreRow(review, side, teamName);
    if (!row) continue;
    const key = `${row.date}|${canonicalDedupeTeam(homeTeam)}|${canonicalDedupeTeam(awayTeam)}`;
    const current = byFixture.get(key);
    if (
      !current ||
      rowCompleteness(row) > rowCompleteness(current) ||
      (rowCompleteness(row) === rowCompleteness(current) && row.createdAt >= current.createdAt)
    ) {
      byFixture.set(key, row);
    }
  }

  const rows = [...byFixture.values()].sort(
    (left, right) => right.date.localeCompare(left.date) || right.createdAt - left.createdAt
  );
  const selected = rows.slice(0, limit);

  let outcomeHits = 0;
  let outcomeEvaluated = 0;
  let exactHits = 0;
  let exactEvaluated = 0;
  let topPickHits = 0;
  let topPickEvaluated = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let goalErrorTotal = 0;
  let goalErrorCount = 0;
  const leagueTally = new Map();
  for (const row of selected) {
    if (typeof row.outcomeHit === "boolean") {
      outcomeEvaluated += 1;
      if (row.outcomeHit) outcomeHits += 1;
    }
    if (typeof row.exactHit === "boolean") {
      exactEvaluated += 1;
      if (row.exactHit) exactHits += 1;
    }
    if (typeof row.topPickHit === "boolean") {
      topPickEvaluated += 1;
      if (row.topPickHit) topPickHits += 1;
    }
    if (row.result === "W") wins += 1;
    else if (row.result === "D") draws += 1;
    else if (row.result === "L") losses += 1;
    const goals = parseScore(row.actualScore);
    if (goals) {
      goalsFor += row.venue === "home" ? goals.home : goals.away;
      goalsAgainst += row.venue === "home" ? goals.away : goals.home;
    }
    if (typeof row.goalError === "number") {
      goalErrorTotal += row.goalError;
      goalErrorCount += 1;
    }
    const leagueLabel = row.league || "Onbekend";
    leagueTally.set(leagueLabel, (leagueTally.get(leagueLabel) || 0) + 1);
  }

  const leagues = [...leagueTally.entries()]
    .map(([label, matches]) => ({ league: label, matches }))
    .sort((left, right) => right.matches - left.matches || left.league.localeCompare(right.league));

  return {
    team: teamName,
    league: league || null,
    matches: selected,
    summary: {
      matches: selected.length,
      available: rows.length,
      outcomeHits,
      outcomeEvaluated,
      outcomePct: percentage(outcomeHits, outcomeEvaluated),
      exactHits,
      exactEvaluated,
      exactPct: percentage(exactHits, exactEvaluated),
      topPickHits,
      topPickEvaluated,
      topPickPct: percentage(topPickHits, topPickEvaluated),
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      avgGoalError: goalErrorCount ? Number((goalErrorTotal / goalErrorCount).toFixed(2)) : null,
      firstDate: selected.length ? selected[selected.length - 1].date : null,
      lastDate: selected.length ? selected[0].date : null,
      leagues,
    },
  };
}
