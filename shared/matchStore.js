// Compacte wedstrijdopslag met snelle lookup voor voorspellingen.
// Doel: alle gespeelde wedstrijden klein opslaan (korte veldnamen) en per club,
// per duel en per datum in O(1) kunnen raadplegen wanneer een nieuwe voorspelling
// historische informatie nodig heeft. De kernfuncties zijn puur; alleen
// collectMatchSources leest van schijf.

import fs from "node:fs";
import path from "node:path";

export const MATCH_STORE_SCHEMA = "match-store-v1";

export function normalizeTeamName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseScore(match = {}) {
  if (Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore)) {
    return [Number(match.homeScore), Number(match.awayScore)];
  }
  const parts = String(match.score || match.actualScore || "").match(/^(\d+)\s*-\s*(\d+)$/);
  return parts ? [Number(parts[1]), Number(parts[2])] : null;
}

// Compacte velden: d=datum, lg=competitie, h/thuis, a=uit, hs/as=doelpunten,
// po=voorspelde uitkomst, ao=werkelijke uitkomst, cf=confidence, hit=1X2 goed,
// ex=exacte score goed, ge=doelpuntfout.
export function recordFromDayMatch(match = {}) {
  const score = parseScore(match);
  const date = String(match.date || "").slice(0, 10);
  if (!score || !date || !match.homeTeamName || !match.awayTeamName) return null;
  const record = {
    d: date,
    lg: match.league || null,
    h: match.homeTeamName,
    a: match.awayTeamName,
    hs: score[0],
    as: score[1],
  };
  return record;
}

export function recordFromReview(review = {}) {
  const score = parseScore(review);
  const date = String(review.date || "").slice(0, 10);
  if (!score || !date || !review.homeTeamName || !review.awayTeamName) return null;
  const record = {
    d: date,
    lg: review.league || null,
    h: review.homeTeamName,
    a: review.awayTeamName,
    hs: score[0],
    as: score[1],
  };
  if (review.predictedOutcome) record.po = review.predictedOutcome;
  if (review.actualOutcome) record.ao = review.actualOutcome;
  if (typeof review.confidence === "number") record.cf = Math.round(review.confidence * 1000) / 1000;
  if (typeof review.outcomeHit === "boolean") record.hit = review.outcomeHit;
  if (typeof review.exactHit === "boolean") record.ex = review.exactHit;
  if (typeof review.totalGoalError === "number") record.ge = review.totalGoalError;
  return record;
}

// preferred wint bij conflicten; ontbrekende velden worden uit other aangevuld.
function mergeRecords(preferred, other) {
  const merged = { ...other };
  for (const [key, value] of Object.entries(preferred)) {
    if (value !== undefined && value !== null) merged[key] = value;
  }
  return merged;
}

function recordSignature(record) {
  return [
    record.d,
    normalizeTeamName(record.h),
    normalizeTeamName(record.a),
    `${record.hs}-${record.as}`,
  ].join("|");
}

function recordIdentity(match, record) {
  return String(match?.id || match?.matchId || `${record.d}-${normalizeTeamName(record.h)}-${normalizeTeamName(record.a)}`);
}

// Verzamelt bronnen uit data/days/*.json en data/history-summary.json.
export function collectMatchSources(dataDir) {
  const dayMatches = [];
  const daysDir = path.join(dataDir, "days");
  if (fs.existsSync(daysDir)) {
    for (const name of fs.readdirSync(daysDir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
      try {
        const payload = JSON.parse(fs.readFileSync(path.join(daysDir, name), "utf8"));
        for (const match of payload?.matches || []) dayMatches.push(match);
      } catch {
        // Corrupt dagbestand overslaan; de overige bronnen blijven bruikbaar.
      }
    }
  }
  let reviews = {};
  const historyFile = path.join(dataDir, "history-summary.json");
  if (fs.existsSync(historyFile)) {
    try {
      reviews = JSON.parse(fs.readFileSync(historyFile, "utf8"))?.postMatchReviews || {};
    } catch {
      reviews = {};
    }
  }
  return { dayMatches, reviews };
}

// Bouwt de store uit dagbestanden (dayMatches) en postMatchReviews. Wedstrijden
// met dezelfde datum/clubs/uitslag onder verschillende ids worden samengevoegd.
export function buildMatchStore({ dayMatches = [], reviews = {} } = {}) {
  const staged = new Map();
  const upsert = (id, record) => {
    if (!record) return;
    const existing = staged.get(id);
    staged.set(id, existing ? mergeRecords(existing, record) : record);
  };

  for (const match of dayMatches || []) {
    const record = recordFromDayMatch(match);
    if (record) upsert(recordIdentity(match, record), record);
  }
  for (const [key, review] of Object.entries(reviews || {})) {
    const record = recordFromReview(review);
    if (record) upsert(recordIdentity(review, record), record);
  }

  const matches = {};
  const bySignature = new Map();
  for (const id of [...staged.keys()].sort()) {
    const record = staged.get(id);
    const signature = recordSignature(record);
    const keptId = bySignature.get(signature);
    if (keptId) {
      matches[keptId] = mergeRecords(matches[keptId], record);
      continue;
    }
    bySignature.set(signature, id);
    matches[id] = record;
  }
  return { schema: MATCH_STORE_SCHEMA, matches };
}

export function buildMatchIndex(store = {}) {
  const byTeam = {};
  const byPair = {};
  const byDate = {};
  const dateOf = (id) => store.matches?.[id]?.d || "";

  for (const id of Object.keys(store.matches || {})) {
    const record = store.matches[id];
    if (!record) continue;
    for (const team of [record.h, record.a]) {
      const key = normalizeTeamName(team);
      if (!byTeam[key]) byTeam[key] = [];
      byTeam[key].push(id);
    }
    const pairKey = `${normalizeTeamName(record.h)}|${normalizeTeamName(record.a)}`;
    if (!byPair[pairKey]) byPair[pairKey] = [];
    byPair[pairKey].push(id);
    if (!byDate[record.d]) byDate[record.d] = [];
    byDate[record.d].push(id);
  }

  const byDateAsc = (left, right) => dateOf(left).localeCompare(dateOf(right));
  for (const ids of Object.values(byTeam)) ids.sort(byDateAsc);
  for (const ids of Object.values(byPair)) ids.sort(byDateAsc);
  for (const ids of Object.values(byDate)) ids.sort(byDateAsc);
  return { byTeam, byPair, byDate };
}

// Recentste wedstrijden van een club, nieuwste eerst. `before` = uitsluiten vanaf
// deze datum (gebruik de wedstrijddatum van de nieuwe voorspelling tegen lekken).
export function queryTeamMatches(store, index, teamName, options = {}) {
  const limit = Math.max(1, Number(options.limit || 10));
  const before = options.before ? String(options.before).slice(0, 10) : null;
  const venue = options.venue === "home" || options.venue === "away" ? options.venue : null;
  const teamKey = normalizeTeamName(teamName);
  const ids = index?.byTeam?.[teamKey] || [];
  const results = [];
  for (let i = ids.length - 1; i >= 0 && results.length < limit; i -= 1) {
    const record = store.matches?.[ids[i]];
    if (!record) continue;
    if (before && record.d >= before) continue;
    if (venue === "home" && normalizeTeamName(record.h) !== teamKey) continue;
    if (venue === "away" && normalizeTeamName(record.a) !== teamKey) continue;
    results.push(record);
  }
  return results;
}

// Onderlinge duels (beide richtingen), nieuwste eerst.
export function queryPairMatches(store, index, homeTeamName, awayTeamName, options = {}) {
  const limit = Math.max(1, Number(options.limit || 5));
  const before = options.before ? String(options.before).slice(0, 10) : null;
  const keys = [
    `${normalizeTeamName(homeTeamName)}|${normalizeTeamName(awayTeamName)}`,
    `${normalizeTeamName(awayTeamName)}|${normalizeTeamName(homeTeamName)}`,
  ];
  const ids = new Set();
  for (const key of keys) {
    for (const id of index?.byPair?.[key] || []) ids.add(id);
  }
  return [...ids]
    .map((id) => store.matches?.[id])
    .filter(Boolean)
    .filter((record) => !before || record.d < before)
    .sort((left, right) => right.d.localeCompare(left.d))
    .slice(0, limit);
}

// Per club prestaties van de opgeslagen voorspellingen (voor clubanalyse).
export function aggregateClubPerformance(store, index, options = {}) {
  const minMatches = Math.max(1, Number(options.minMatches || 8));
  const rows = [];
  for (const [teamKey, ids] of Object.entries(index?.byTeam || {})) {
    if (ids.length < minMatches) continue;
    let name = teamKey;
    const leagues = new Map();
    let home = 0;
    let away = 0;
    let decided = 0;
    let hit = 0;
    let exact = 0;
    let goalErr = 0;
    let goalErrN = 0;
    for (const id of ids) {
      const record = store.matches?.[id];
      if (!record) continue;
      if (normalizeTeamName(record.h) === teamKey) {
        home += 1;
        name = record.h;
      } else {
        away += 1;
        name = record.a;
      }
      if (record.lg) leagues.set(record.lg, (leagues.get(record.lg) || 0) + 1);
      if (typeof record.hit === "boolean") {
        decided += 1;
        if (record.hit) hit += 1;
      }
      if (record.ex === true) exact += 1;
      if (typeof record.ge === "number") {
        goalErr += record.ge;
        goalErrN += 1;
      }
    }
    if (!decided) continue;
    rows.push({
      name,
      league: [...leagues.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null,
      n: ids.length,
      home,
      away,
      decided,
      hitPct: (hit / decided) * 100,
      exactPct: (exact / decided) * 100,
      goalErr: goalErrN ? goalErr / goalErrN : 0,
    });
  }
  return rows.sort((left, right) => right.n - left.n);
}
