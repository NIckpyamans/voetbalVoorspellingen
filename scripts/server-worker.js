#!/usr/bin/env node
// server-worker.js v4 — met H2H, competitiestanden, Over/Under, BTTS, score matrix

import fs from "fs";
import path from "path";

const SOFA = "https://api.sofascore.com/api/v1";
const DATA_FILE = path.resolve(process.cwd(), "server_data.json");

const ALLOWED_LEAGUES = [
  { country: 'netherlands', name: 'eredivisie',            label: '🇳🇱 Eredivisie',          sofaId: 37  },
  { country: 'netherlands', name: 'eerste divisie',        label: '🇳🇱 Eerste Divisie',       sofaId: 38  },
  { country: 'netherlands', name: 'knvb beker',            label: '🇳🇱 KNVB Beker',           sofaId: 390 },
  { country: 'england',     name: 'premier league',        label: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League',       sofaId: 17  },
  { country: 'england',     name: 'championship',          label: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Championship',          sofaId: 18  },
  { country: 'germany',     name: 'bundesliga',            label: '🇩🇪 Bundesliga',            sofaId: 35  },
  { country: 'germany',     name: '2. bundesliga',         label: '🇩🇪 2. Bundesliga',         sofaId: 36  },
  { country: 'spain',       name: 'laliga',                label: '🇪🇸 LaLiga',                sofaId: 8   },
  { country: 'spain',       name: 'laliga2',               label: '🇪🇸 LaLiga2',               sofaId: 54  },
  { country: 'spain',       name: 'la liga',               label: '🇪🇸 LaLiga',                sofaId: 8   },
  { country: 'spain',       name: 'segunda',               label: '🇪🇸 LaLiga2',               sofaId: 54  },
  { country: 'italy',       name: 'serie a',               label: '🇮🇹 Serie A',               sofaId: 23  },
  { country: 'italy',       name: 'serie b',               label: '🇮🇹 Serie B',               sofaId: 53  },
  { country: 'france',      name: 'ligue 1',               label: '🇫🇷 Ligue 1',               sofaId: 34  },
  { country: 'france',      name: 'ligue 2',               label: '🇫🇷 Ligue 2',               sofaId: 182 },
  { country: 'portugal',    name: 'liga portugal',         label: '🇵🇹 Liga Portugal',         sofaId: 238 },
  { country: 'portugal',    name: 'liga portugal 2',       label: '🇵🇹 Liga Portugal 2',       sofaId: 239 },
  { country: 'belgium',     name: 'pro league',            label: '🇧🇪 Pro League',             sofaId: 26  },
  { country: 'belgium',     name: 'challenger pro league', label: '🇧🇪 Challenger Pro League', sofaId: 325 },
  { country: '',            name: 'champions league',      label: '🏆 Champions League',       sofaId: 7   },
  { country: '',            name: 'europa league',         label: '🥈 Europa League',          sofaId: 679 },
  { country: '',            name: 'conference league',     label: '🥉 Conference League',      sofaId: 17015},
];

function getAllowedLeague(event) {
  const tname = (event?.tournament?.name || '').toLowerCase().trim();
  const category = (event?.tournament?.category?.name || '').toLowerCase().trim();
  for (const l of ALLOWED_LEAGUES) {
    const countryOk = !l.country || category.includes(l.country);
    const nameOk = tname === l.name || tname.includes(l.name);
    if (countryOk && nameOk) return l;
  }
  return null;
}

process.on("unhandledRejection", err => console.log("[worker] fout:", err.message));
process.on("uncaughtException",  err => console.log("[worker] crash:", err.message));

async function safeFetch(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://www.sofascore.com",
        "Referer": "https://www.sofascore.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
      }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Head-to-head ophalen via SofaScore event ID
async function fetchH2H(eventId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/h2h`);
  if (!json) return null;

  const events = json.events || [];
  if (events.length === 0) return null;

  const last10 = events.slice(-10);
  let h2hStats = { played: 0, homeWins: 0, draws: 0, awayWins: 0, results: [] };

  for (const e of last10) {
    const hg = e.homeScore?.current, ag = e.awayScore?.current;
    if (hg == null || ag == null) continue;
    h2hStats.played++;
    if (hg > ag) h2hStats.homeWins++;
    else if (hg === ag) h2hStats.draws++;
    else h2hStats.awayWins++;
    h2hStats.results.push({
      home: e.homeTeam?.name, away: e.awayTeam?.name,
      score: `${hg}-${ag}`,
      date: e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString().split('T')[0] : null
    });
  }

  return h2hStats;
}

// Competitiestand ophalen
async function fetchStandings(tournamentId, seasonId) {
  if (!tournamentId || !seasonId) return null;
  const json = await safeFetch(`${SOFA}/unique-tournament/${tournamentId}/season/${seasonId}/standings/total`);
  if (!json?.standings?.[0]?.rows) return null;

  return json.standings[0].rows.map(r => ({
    pos: r.position,
    team: r.team?.name,
    teamId: String(r.team?.id || ''),
    p: r.matches, w: r.wins, d: r.draws, l: r.losses,
    gf: r.scoresFor, ga: r.scoresAgainst, pts: r.points
  }));
}

// Teamvorm ophalen
async function fetchTeamForm(teamId, n = 8) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/events/last/0`);
  if (!json?.events) return { form: '', homeGoals: 1.5, awayGoals: 1.5, homeAvgScored: 1.5, awayAvgScored: 1.5 };

  const finished = json.events.filter(e => e.status?.type === 'finished').slice(-n);
  if (finished.length === 0) return { form: '', homeGoals: 1.5, awayGoals: 1.5, homeAvgScored: 1.5, awayAvgScored: 1.5 };

  let form = '';
  let totalScored = 0, totalConceded = 0;
  let homeGames = 0, homeScored = 0, awayGames = 0, awayScored = 0;
  let bttsCount = 0;

  for (const e of finished) {
    const isHome = String(e.homeTeam?.id) === String(teamId);
    const scored = isHome ? e.homeScore?.current : e.awayScore?.current;
    const conceded = isHome ? e.awayScore?.current : e.homeScore?.current;
    if (scored == null || conceded == null) continue;
    totalScored += scored;
    totalConceded += conceded;
    if (scored > 0 && conceded > 0) bttsCount++;
    if (isHome) { homeGames++; homeScored += scored; }
    else { awayGames++; awayScored += scored; }
    if (scored > conceded) form += 'W';
    else if (scored === conceded) form += 'D';
    else form += 'L';
  }

  const n2 = finished.length;
  return {
    form: form.slice(-5),
    avgScored: totalScored / n2,
    avgConceded: totalConceded / n2,
    homeAvgScored: homeGames > 0 ? homeScored / homeGames : 1.5,
    awayAvgScored: awayGames > 0 ? awayScored / awayGames : 1.5,
    bttsRate: bttsCount / n2,
    gamesPlayed: n2
  };
}

// Poisson model
function factorial(n) { if (n <= 1) return 1; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function poisson(l, k) { return (Math.pow(l, k) * Math.exp(-l)) / factorial(k); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function advancedPredict(homeStats, awayStats, homeElo = 1500, awayElo = 1500) {
  // Verbeterd model: gebruik thuis/uit splits + Elo weging
  const homeAdv = 1.12;
  const avgLeague = 1.35;

  // xG berekening op basis van echte aanval/verdediging statistieken
  const homeAttack  = clamp(homeStats.avgScored   / avgLeague, 0.4, 3.0);
  const homeDefense = clamp(homeStats.avgConceded  / avgLeague, 0.4, 3.0);
  const awayAttack  = clamp(awayStats.avgScored    / avgLeague, 0.4, 3.0);
  const awayDefense = clamp(awayStats.avgConceded  / avgLeague, 0.4, 3.0);

  // Elo correctie factor
  const eloFactor = Math.pow(10, (homeElo - awayElo) / 1000);

  const hxg = clamp(avgLeague * homeAttack / awayDefense * homeAdv * Math.sqrt(eloFactor), 0.2, 5.0);
  const axg = clamp(avgLeague * awayAttack / homeDefense / Math.sqrt(eloFactor), 0.2, 5.0);

  // Scorematrix (0-6 doelpunten)
  let hp = 0, dp = 0, ap = 0, bestScore = '1-1', bestP = 0;
  const scoreMatrix = {};
  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const p = poisson(hxg, h) * poisson(axg, a);
      if (h > a) hp += p; else if (a > h) ap += p; else dp += p;
      if (p > bestP) { bestP = p; bestScore = `${h}-${a}`; }
      if (p > 0.01) scoreMatrix[`${h}-${a}`] = parseFloat(p.toFixed(4)); // alleen top kansen
    }
  }

  // Over/Under berekening
  let over05 = 0, over15 = 0, over25 = 0, over35 = 0;
  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const p = poisson(hxg, h) * poisson(axg, a);
      const total = h + a;
      if (total > 0.5) over05 += p;
      if (total > 1.5) over15 += p;
      if (total > 2.5) over25 += p;
      if (total > 3.5) over35 += p;
    }
  }

  // BTTS (beide teams scoren)
  let btts = 0;
  for (let h = 1; h <= 6; h++) {
    for (let a = 1; a <= 6; a++) {
      btts += poisson(hxg, h) * poisson(axg, a);
    }
  }

  // Confidence
  const eloDiff = Math.abs(homeElo - awayElo);
  const eloBoost = Math.min(0.12, eloDiff / 1200);
  const confidence = Math.min(0.92, bestP * 3.2 + eloBoost);

  const [predH, predA] = bestScore.split('-').map(Number);

  return {
    homeProb: hp, drawProb: dp, awayProb: ap,
    homeXG: parseFloat(hxg.toFixed(2)), awayXG: parseFloat(axg.toFixed(2)),
    predHomeGoals: predH, predAwayGoals: predA,
    exactProb: parseFloat(bestP.toFixed(4)),
    confidence: parseFloat(confidence.toFixed(3)),
    over25: parseFloat(over25.toFixed(3)),
    over15: parseFloat(over15.toFixed(3)),
    over35: parseFloat(over35.toFixed(3)),
    btts: parseFloat(btts.toFixed(3)),
    scoreMatrix: Object.fromEntries(
      Object.entries(scoreMatrix)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8) // top 8 meest waarschijnlijke scores
    )
  };
}

function getTeam(teams, id, name) {
  const key = id ? `id:${id}` : `name:${name.toLowerCase()}`;
  if (!teams[key]) teams[key] = { id: id || '', name, elo: 1500 };
  teams[key].name = name;
  if (id) teams[key].id = id;
  return teams[key];
}

function updateElo(home, away, score) {
  if (!score?.includes("-")) return;
  const [h, a] = score.split("-").map(Number);
  if (isNaN(h) || isNaN(a)) return;
  const k = 20;
  const exp = 1 / (1 + Math.pow(10, (away.elo - home.elo) / 400));
  const act = h > a ? 1 : h === a ? 0.5 : 0;
  home.elo = clamp(home.elo + k * (act - exp), 1000, 2200);
  away.elo = clamp(away.elo + k * ((1 - act) - (1 - exp)), 1000, 2200);
}

async function main() {
  console.log("[worker] start:", new Date().toISOString());

  let store = { teams: {}, predictions: {}, matches: {}, standings: {}, teamStats: {}, teamStatsUpdated: {}, lastRun: null };
  if (fs.existsSync(DATA_FILE)) {
    try { store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); } catch {}
  }
  if (!store.matches) store.matches = {};
  if (!store.standings) store.standings = {};
  if (!store.teamStats) store.teamStats = {};
  if (!store.teamStatsUpdated) store.teamStatsUpdated = {};

  const today    = new Date().toISOString().split('T')[0];
  const yesterday= new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const now = Date.now();
  const SIX_HOURS = 6 * 3600 * 1000;

  // Stap 1: verzamel alle wedstrijden + unieke team IDs
  const allEventsByDate = {};
  const teamIdsNeeded = new Set();

  for (const date of [yesterday, today, tomorrow]) {
    const json = await safeFetch(`${SOFA}/sport/football/scheduled-events/${date}`);
    if (!json?.events) continue;
    const filtered = json.events.filter(e => getAllowedLeague(e));
    allEventsByDate[date] = filtered;
    for (const e of filtered) {
      if (e.homeTeam?.id) teamIdsNeeded.add(String(e.homeTeam.id));
      if (e.awayTeam?.id) teamIdsNeeded.add(String(e.awayTeam.id));
    }
  }

  console.log(`[worker] ${teamIdsNeeded.size} teams gevonden`);

  // Stap 2: haal teamstatistieken op (alleen als niet recent)
  let statsUpdated = 0;
  for (const teamId of teamIdsNeeded) {
    if (now - (store.teamStatsUpdated[teamId] || 0) < SIX_HOURS) continue;
    const stats = await fetchTeamForm(teamId, 10);
    store.teamStats[teamId] = stats;
    store.teamStatsUpdated[teamId] = now;
    statsUpdated++;
    await new Promise(r => setTimeout(r, 120)); // rate limiting voorkomen
  }
  console.log(`[worker] ${statsUpdated} teamstats bijgewerkt`);

  // Stap 3: verwerk wedstrijden per datum
  for (const date of [yesterday, today, tomorrow]) {
    const events = allEventsByDate[date] || [];
    const dayMatches = [], dayPredictions = [];

    // Verzamel unieke toernooien voor competitiestand
    const tournamentsForStandings = new Map();

    for (const e of events) {
      const leagueInfo = getAllowedLeague(e);
      if (!leagueInfo) continue;

      const homeName = e.homeTeam?.name || 'Home';
      const awayName = e.awayTeam?.name || 'Away';
      const homeId   = e.homeTeam?.id ? String(e.homeTeam.id) : '';
      const awayId   = e.awayTeam?.id ? String(e.awayTeam.id) : '';

      const homeTeamStore = getTeam(store.teams, homeId, homeName);
      const awayTeamStore = getTeam(store.teams, awayId, awayName);

      const statusType = e.status?.type || 'notstarted';
      const hg = e.homeScore?.current, ag = e.awayScore?.current;
      const score = (hg != null && ag != null) ? `${hg}-${ag}` : null;

      if (statusType === 'finished' && score) updateElo(homeTeamStore, awayTeamStore, score);

      // Haal teamstats op uit store
      const homeStats = store.teamStats[homeId] || { avgScored: 1.5, avgConceded: 1.5 };
      const awayStats = store.teamStats[awayId] || { avgScored: 1.5, avgConceded: 1.5 };

      const pred = advancedPredict(homeStats, awayStats, homeTeamStore.elo, awayTeamStore.elo);
      const matchId = `ss-${e.id}`;

      // Tournament ID voor competitiestand
      const tId = e.uniqueTournament?.id || e.tournament?.uniqueTournament?.id;
      const seasonId = e.season?.id;
      if (tId && seasonId) tournamentsForStandings.set(`${tId}_${seasonId}`, { tId, seasonId, label: leagueInfo.label });

      dayMatches.push({
        id: matchId, sofaId: e.id, date,
        kickoff: e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString() : null,
        league: leagueInfo.label,
        homeTeamName: homeName, awayTeamName: awayName,
        homeTeamId: homeId, awayTeamId: awayId,
        homeLogo: homeId ? `https://api.sofascore.app/api/v1/team/${homeId}/image` : '',
        awayLogo: awayId ? `https://api.sofascore.app/api/v1/team/${awayId}/image` : '',
        status: statusType === 'finished' ? 'FT' : statusType === 'inprogress' ? 'LIVE' : 'NS',
        score, minute: e.time?.current ? `${e.time.current}'` : null,
        homeForm: homeStats.form || '',
        awayForm: awayStats.form || '',
        homeElo: Math.round(homeTeamStore.elo),
        awayElo: Math.round(awayTeamStore.elo),
      });

      dayPredictions.push({
        matchId, homeTeam: homeName, awayTeam: awayName,
        league: leagueInfo.label, ...pred,
        homeForm: homeStats.form || '',
        awayForm: awayStats.form || '',
        homeElo: Math.round(homeTeamStore.elo),
        awayElo: Math.round(awayTeamStore.elo),
      });
    }

    store.matches[date] = dayMatches;
    store.predictions[date] = dayPredictions;
    console.log(`[worker] ${date}: ${dayMatches.length} wedstrijden`);

    // Haal competitiestanden op (alleen voor vandaag)
    if (date === today) {
      for (const [key, { tId, seasonId, label }] of tournamentsForStandings) {
        if (store.standings[key] && now - (store.standings[key].updated || 0) < SIX_HOURS) continue;
        const standings = await fetchStandings(tId, seasonId);
        if (standings) {
          store.standings[key] = { label, rows: standings, updated: now };
          console.log(`[worker] stand opgehaald: ${label}`);
        }
        await new Promise(r => setTimeout(r, 150));
      }
    }
  }

  // Stap 4: H2H ophalen voor wedstrijden van vandaag
  const todayMatches = store.matches[today] || [];
  let h2hFetched = 0;
  for (const m of todayMatches.slice(0, 30)) { // max 30 om rate limiting te voorkomen
    if (m.h2h) continue; // al opgehaald
    const h2h = await fetchH2H(m.sofaId);
    if (h2h) { m.h2h = h2h; h2hFetched++; }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`[worker] ${h2hFetched} H2H records opgehaald`);

  // Stap 5: live scores mergen
  const liveJson = await safeFetch(`${SOFA}/sport/football/events/live`);
  if (liveJson?.events) {
    if (!store.matches[today]) store.matches[today] = [];
    let liveMerged = 0;
    for (const live of liveJson.events) {
      const leagueInfo = getAllowedLeague(live);
      if (!leagueInfo) continue;
      const matchId = `ss-${live.id}`;
      const idx = store.matches[today].findIndex(m => m.id === matchId);
      const hg = live.homeScore?.current, ag = live.awayScore?.current;
      const liveData = {
        status: 'LIVE',
        score: (hg != null && ag != null) ? `${hg}-${ag}` : null,
        minute: live.time?.current ? `${live.time.current}'` : null,
      };
      if (idx >= 0) Object.assign(store.matches[today][idx], liveData);
      else {
        store.matches[today].push({
          id: matchId, sofaId: live.id, date: today,
          kickoff: live.startTimestamp ? new Date(live.startTimestamp * 1000).toISOString() : null,
          league: leagueInfo.label,
          homeTeamName: live.homeTeam?.name || 'Home', awayTeamName: live.awayTeam?.name || 'Away',
          homeTeamId: live.homeTeam?.id ? String(live.homeTeam.id) : '',
          awayTeamId: live.awayTeam?.id ? String(live.awayTeam.id) : '',
          homeLogo: live.homeTeam?.id ? `https://api.sofascore.app/api/v1/team/${live.homeTeam.id}/image` : '',
          awayLogo: live.awayTeam?.id ? `https://api.sofascore.app/api/v1/team/${live.awayTeam.id}/image` : '',
          ...liveData
        });
      }
      liveMerged++;
    }
    console.log(`[worker] ${liveMerged} live wedstrijden gemerged`);
  }

  store.lastRun = Date.now();

  // Ruim oude data op
  const cutoff = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
  for (const d of Object.keys(store.matches))     if (d < cutoff) delete store.matches[d];
  for (const d of Object.keys(store.predictions)) if (d < cutoff) delete store.predictions[d];

  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  console.log(`[worker] klaar! ${store.matches[today]?.length || 0} wedstrijden, ${Object.keys(store.teams).length} teams in DB`);
}

main();
