// Compacte wedstrijdopslag met snelle lookup voor voorspellingen.
// Doel: alle gespeelde wedstrijden klein opslaan (korte veldnamen) en per club,
// per duel en per datum in O(1) kunnen raadplegen wanneer een nieuwe voorspelling
// historische informatie nodig heeft. De kernfuncties zijn puur; alleen
// collectMatchSources leest van schijf.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalDedupeTeam } from "./matchNormalization.js";
import { devigThreeWay } from "./marketBenchmark.js";
import { compactOddsFreshness } from "./oddsFreshness.js";
import { favoriteFromOdds, marketOddsKey } from "./marketOdds.js";

export const MATCH_STORE_SCHEMA = "match-store-v2";

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

export function normalizeTeamName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Clubsleutel via dezelfde canonicalisatie als de rest van de app
// (shared/matchNormalization.js): "FC Utrecht"/"Utrecht", "NEC"/"NEC Nijmegen"
// en provider-varianten komen zo in een indexpost terecht, waardoor een lookup
// meer historie vindt dan een simpele kleine-letter-sleutel.
export function clubKey(value) {
  return canonicalDedupeTeam(value) || normalizeTeamName(value);
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
// ex=exacte score goed, ge=doelpuntfout, mp=gede-vigde marktkansen,
// ll/bs=modelmaten, mk/mh=marktfavoriet en of die uitkwam. De werkelijke
// uitkomst staat in ao; er is geen tweede uitkomstveld.
//
// Alleen afgeronde wedstrijden horen in de historische opslag. Dagbestanden
// bevatten ook LIVE/HT/NS-duels met een voorlopige stand; zonder deze statuscheck
// zou die voorlopige stand als einduitslag worden bewaard.
const FINISHED_STATUSES = ["FT", "AET", "PEN"];

export function recordFromDayMatch(match = {}) {
  const status = String(match.status || match.period || "").toUpperCase();
  if (!FINISHED_STATUSES.includes(status)) return null;
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
  // Datakwaliteit per voorspelling compact vastleggen (odds-status + deel van de
  // bronvelden met een bekend tijdstip), zodat analyses niet op ruis rekenen.
  const dq = {};
  const timestampCoverage = Number(review.featureSourceMetadata?.coverage?.timestampCoverage);
  if (Number.isFinite(timestampCoverage)) dq.ts = Math.round(timestampCoverage * 1000) / 1000;
  if (review.oddsStatus) dq.od = String(review.oddsStatus);
  // Odds-versheid: hoeveel uur voor aftrap zijn de odds vastgelegd? Zo kan de
  // analyse oude odds niet als even sterk signaal behandelen als verse.
  const kickoffValue = review.kickoff || review.kickoffAt || review.matchKickoff || null;
  const oddsCapturedAt = review.oddsAtPrediction?.capturedAt
    || review.oddsAtPrediction?.lastUpdated
    || null;
  const freshness = compactOddsFreshness(oddsCapturedAt, kickoffValue);
  if (freshness) {
    dq.h = freshness.h;
    dq.f = freshness.f;
  }
  if (Object.keys(dq).length) record.dq = dq;
  // Modelmaten van diezelfde wedstrijd. Samen met mp (marktkansen) maakt dat een
  // kansniveau-vergelijking model tegen markt mogelijk op precies dezelfde duels.
  if (Number.isFinite(Number(review.logLoss))) record.ll = round3(review.logLoss);
  if (Number.isFinite(Number(review.brierScore))) record.bs = round3(review.brierScore);
  // Marktbaseline: de marktfavoriet (laagste odd, invariant onder de-vig) en of
  // die uitkwam, compact naast de modelbeoordeling.
  const odds = review.oddsAtPrediction;
  const decimalOdds = odds ? [Number(odds.home), Number(odds.draw), Number(odds.away)] : [];
  if (decimalOdds.length && decimalOdds.every((value) => Number.isFinite(value) && value > 1.01)) {
    const favorite = [["H", decimalOdds[0]], ["D", decimalOdds[1]], ["A", decimalOdds[2]]]
      .sort((left, right) => left[1] - right[1])[0][0];
    record.mk = favorite;
    if (review.actualOutcome) record.mh = favorite === review.actualOutcome;
    // Gede-vigde marktkansen, alleen wanneer de odds aantoonbaar voor aftrap zijn
    // vastgelegd. Zonder tijdstip geen mp: dan is de markt geen eerlijke basis.
    const kickoffMs = Date.parse(String(kickoffValue || ""));
    const capturedMs = Date.parse(String(oddsCapturedAt || ""));
    if (Number.isFinite(kickoffMs) && Number.isFinite(capturedMs) && capturedMs < kickoffMs) {
      const market = devigThreeWay(decimalOdds, "power");
      if (market) record.mp = market;
    }
  }
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

// Marktbaseline-uitbreiding: wanneer een review geen pre-match oddsAtPrediction
// heeft, vullen mk/mh alsnog vanuit het marktbestand (football-data.co.uk
// closing-marktconsensus). `mks: "fdc"` markeert die bron; echte pre-match
// captures houden altijd voorrang en blijven ongemarkeerd.
function applyMarketOddsFallback(record, marketOdds) {
  if (!record || record.mk !== undefined || !marketOdds) return;
  if (typeof record.hit !== "boolean" || !record.ao) return;
  const odds = marketOdds.entries?.[marketOddsKey(record.d, record.h, record.a)];
  if (!Array.isArray(odds)) return;
  const favorite = favoriteFromOdds(odds[0], odds[1], odds[2]);
  if (!favorite) return;
  record.mk = favorite;
  record.mh = favorite === record.ao;
  record.mks = "fdc";
  // Ook uit het marktbestand de volledige kansverdeling bewaren; closing odds
  // zijn de sterkste benchmark die er gratis is.
  const market = devigThreeWay(odds, "power");
  if (market) record.mp = market;
}

function recordSignature(record) {
  return [
    record.d,
    clubKey(record.h),
    clubKey(record.a),
    `${record.hs}-${record.as}`,
  ].join("|");
}

function recordIdentity(match, record) {
  return String(match?.id || match?.matchId || `${record.d}-${normalizeTeamName(record.h)}-${normalizeTeamName(record.a)}`);
}

function sourceFiles(dataDir) {
  const files = [];
  const daysDir = path.join(dataDir, "days");
  if (fs.existsSync(daysDir)) {
    for (const name of fs.readdirSync(daysDir)) {
      if (/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) files.push(path.join(daysDir, name));
    }
  }
  for (const name of ["history-summary.json", "market-odds.json"]) {
    const file = path.join(dataDir, name);
    if (fs.existsSync(file)) files.push(file);
  }
  return files;
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
  // Marktparen (football-data.co.uk) voor de marktbaseline-fallback; optioneel.
  let marketOdds = null;
  const marketOddsFile = path.join(dataDir, "market-odds.json");
  if (fs.existsSync(marketOddsFile)) {
    try {
      marketOdds = JSON.parse(fs.readFileSync(marketOddsFile, "utf8"));
    } catch {
      marketOdds = null;
    }
  }
  return { dayMatches, reviews, marketOdds };
}

// Inhoudshash van alle bronbestanden. Bewust inhoud en niet mtime: na een
// git-checkout hebben alle bestanden dezelfde mtime, waardoor een
// mtime-vergelijking de store onnodig herbouwt (traag) of, bij een bron die
// alleen is aangeraakt, onterecht als vers ziet.
export function sourceFingerprint(dataDir) {
  const hash = crypto.createHash("sha1");
  const daysDir = path.join(dataDir, "days");
  const names = [];
  if (fs.existsSync(daysDir)) {
    for (const name of fs.readdirSync(daysDir)) {
      if (/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) names.push(name);
    }
  }
  names.sort();
  for (const name of names) {
    hash.update(name);
    try {
      hash.update(fs.readFileSync(path.join(daysDir, name)));
    } catch {
      // Onleesbaar bestand overslaan; de rest bepaalt de hash.
    }
  }
  for (const name of ["history-summary.json", "market-odds.json"]) {
    const file = path.join(dataDir, name);
    if (!fs.existsSync(file)) continue;
    hash.update(name);
    try {
      hash.update(fs.readFileSync(file));
    } catch {
      // Idem.
    }
  }
  return hash.digest("hex").slice(0, 16);
}

// Laadt de voorgegenereerde store, maar herbouwt die wanneer de inhoud van de
// brondata niet meer overeenkomt met de hash die bij de store is opgeslagen.
// Zo raakt de analyse nooit verouderd en wordt er niets onnodig geparst.
// Een store van voor deze wijziging heeft nog geen src; die valt terug op de
// oude mtime-controle zodat de overstap geleidelijk gaat.
// Retourneert altijd { store, index, fresh, sourceFingerprint }.
export function loadMatchStore(dataDir) {
  const storeFile = path.join(dataDir, "match-store.json");
  const indexFile = path.join(dataDir, "match-index.json");
  const fingerprint = sourceFingerprint(dataDir);

  if (fs.existsSync(storeFile) && fs.existsSync(indexFile)) {
    try {
      const store = JSON.parse(fs.readFileSync(storeFile, "utf8"));
      const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      if (store?.matches && index?.byTeam) {
        if (store.src) {
          if (store.src === fingerprint) {
            return { store, index, fresh: true, sourceFingerprint: fingerprint };
          }
        } else {
          const sourcesMtime = sourceFiles(dataDir).reduce(
            (latest, filePath) => Math.max(latest, fs.statSync(filePath).mtimeMs),
            0,
          );
          const generatedMtime = Math.min(
            fs.statSync(storeFile).mtimeMs,
            fs.statSync(indexFile).mtimeMs,
          );
          if (generatedMtime > sourcesMtime) {
            return { store, index, fresh: true, sourceFingerprint: fingerprint };
          }
        }
      }
    } catch {
      // Corrupte of verouderde gegenereerde bestanden: hieronder opnieuw opbouwen.
    }
  }
  const { dayMatches, reviews, marketOdds } = collectMatchSources(dataDir);
  const store = buildMatchStore({ dayMatches, reviews, marketOdds, sourceFingerprint: fingerprint });
  return { store, index: buildMatchIndex(store), fresh: false, sourceFingerprint: fingerprint };
}

// Bouwt de store uit dagbestanden (dayMatches) en postMatchReviews. Wedstrijden
// met dezelfde datum/clubs/uitslag onder verschillende ids worden samengevoegd.
export function buildMatchStore({ dayMatches = [], reviews = {}, marketOdds = null, sourceFingerprint = null } = {}) {
  const staged = new Map();
  // incomingWins: reviews dragen de gecontroleerde einduitslag en moeten een
  // eerdere (eventueel voorlopige) dagstand overschrijven.
  const upsert = (id, record, incomingWins = false) => {
    if (!record) return;
    const existing = staged.get(id);
    if (!existing) {
      staged.set(id, record);
      return;
    }
    staged.set(id, incomingWins ? mergeRecords(record, existing) : mergeRecords(existing, record));
  };

  for (const match of dayMatches || []) {
    const record = recordFromDayMatch(match);
    if (record) upsert(recordIdentity(match, record), record);
  }
  for (const [key, review] of Object.entries(reviews || {})) {
    const record = recordFromReview(review);
    if (record) upsert(recordIdentity(review, record), record, true);
  }

  const matches = {};
  const bySignature = new Map();
  for (const id of [...staged.keys()].sort()) {
    const record = staged.get(id);
    applyMarketOddsFallback(record, marketOdds);
    const signature = recordSignature(record);
    const keptId = bySignature.get(signature);
    if (keptId) {
      matches[keptId] = mergeRecords(matches[keptId], record);
      continue;
    }
    bySignature.set(signature, id);
    matches[id] = record;
  }
  const store = { schema: MATCH_STORE_SCHEMA, matches };
  if (sourceFingerprint) store.src = String(sourceFingerprint);
  return store;
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
      const teamKey = clubKey(team);
      if (!byTeam[teamKey]) byTeam[teamKey] = [];
      byTeam[teamKey].push(id);
    }
    const pairKey = `${clubKey(record.h)}|${clubKey(record.a)}`;
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
  const key = clubKey(teamName);
  const ids = index?.byTeam?.[key] || [];
  const results = [];
  for (let position = ids.length - 1; position >= 0 && results.length < limit; position -= 1) {
    const record = store.matches?.[ids[position]];
    if (!record) continue;
    if (before && record.d >= before) continue;
    if (venue === "home" && clubKey(record.h) !== key) continue;
    if (venue === "away" && clubKey(record.a) !== key) continue;
    results.push(record);
  }
  return results;
}

// Onderlinge duels (beide richtingen), nieuwste eerst.
export function queryPairMatches(store, index, homeTeamName, awayTeamName, options = {}) {
  const limit = Math.max(1, Number(options.limit || 5));
  const before = options.before ? String(options.before).slice(0, 10) : null;
  const keys = [
    `${clubKey(homeTeamName)}|${clubKey(awayTeamName)}`,
    `${clubKey(awayTeamName)}|${clubKey(homeTeamName)}`,
  ];
  const ids = new Set();
  for (const pairKey of keys) {
    for (const id of index?.byPair?.[pairKey] || []) ids.add(id);
  }
  return [...ids]
    .map((id) => store.matches?.[id])
    .filter(Boolean)
    .filter((record) => !before || record.d < before)
    .sort((left, right) => right.d.localeCompare(left.d))
    .slice(0, limit);
}

// Onderlinge duels samengevat vanuit het perspectief van het opgegeven thuis-team.
export function headToHeadSummary(store, index, homeTeamName, awayTeamName, options = {}) {
  const matches = queryPairMatches(store, index, homeTeamName, awayTeamName, options);
  const homeKey = clubKey(homeTeamName);
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let homeGoals = 0;
  let awayGoals = 0;
  for (const record of matches) {
    const homeIsHome = clubKey(record.h) === homeKey;
    const goalsFor = homeIsHome ? record.hs : record.as;
    const goalsAgainst = homeIsHome ? record.as : record.hs;
    homeGoals += goalsFor;
    awayGoals += goalsAgainst;
    if (goalsFor > goalsAgainst) homeWins += 1;
    else if (goalsFor === goalsAgainst) draws += 1;
    else awayWins += 1;
  }
  return {
    played: matches.length,
    homeWins,
    draws,
    awayWins,
    homeGoals,
    awayGoals,
    last5: matches.slice(0, 5),
  };
}

// Alles wat een nieuwe voorspelling in een keer moet raadplegen: recente vorm
// van beide clubs, onderlinge duels en de rustdagen sinds het laatste duel.
// Gebruik altijd `before` = de wedstrijddatum van de nieuwe voorspelling, zodat
// er geen informatie uit de toekomst in de voorspelling lekt.
export function buildPredictionContext(store, index, homeTeamName, awayTeamName, options = {}) {
  const before = options.before ? String(options.before).slice(0, 10) : null;
  const limit = Math.max(1, Number(options.limit || 10));
  const teamContext = (teamName) => {
    const recent = queryTeamMatches(store, index, teamName, { before, limit });
    const lastMatchDate = recent[0]?.d || null;
    return {
      team: teamName,
      recent,
      lastMatchDate,
      restDays: before && lastMatchDate
        ? Math.round((Date.parse(before) - Date.parse(lastMatchDate)) / 86400000)
        : null,
    };
  };
  return {
    before,
    home: teamContext(homeTeamName),
    away: teamContext(awayTeamName),
    headToHead: headToHeadSummary(store, index, homeTeamName, awayTeamName, { before, limit: 10 }),
  };
}

// Per club prestaties van de opgeslagen voorspellingen (voor clubanalyse).
// De steekproefdrempel geldt voor de beoordeelde voorspellingen (n), niet voor
// het aantal gespeelde wedstrijden: een club met acht duels maar een review
// levert anders een 100%-regel op basis van een voorspelling.
export function aggregateClubPerformance(store, index, options = {}) {
  const minMatches = Math.max(1, Number(options.minMatches || 8));
  const rows = [];
  for (const [key, ids] of Object.entries(index?.byTeam || {})) {
    let name = key;
    const leagues = new Map();
    let home = 0;
    let away = 0;
    let decided = 0;
    let hit = 0;
    let exact = 0;
    let exactDecided = 0;
    let goalErr = 0;
    let goalErrN = 0;
    for (const id of ids) {
      const record = store.matches?.[id];
      if (!record) continue;
      if (clubKey(record.h) === key) {
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
      if (typeof record.ex === "boolean") {
        exactDecided += 1;
        if (record.ex) exact += 1;
      }
      if (typeof record.ge === "number") {
        goalErr += record.ge;
        goalErrN += 1;
      }
    }
    if (decided < minMatches) continue;
    rows.push({
      key,
      name,
      league: [...leagues.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null,
      n: decided,
      matches: ids.length,
      home,
      away,
      decided,
      hitPct: (hit / decided) * 100,
      exactPct: exactDecided ? (exact / exactDecided) * 100 : 0,
      goalErr: goalErrN ? goalErr / goalErrN : 0,
    });
  }
  return rows.sort((left, right) => right.n - left.n);
}
