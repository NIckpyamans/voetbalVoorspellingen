#!/usr/bin/env node
// server-worker.js v5 — Dixon-Coles + echte seizoensstatistieken + Claude analyse

import fs from "fs";
import path from "path";

const SOFA = "https://api.sofascore.com/api/v1";
const DATA_FILE = path.resolve(process.cwd(), "server_data.json");

const ALLOWED_LEAGUES = [
  { country: 'netherlands', name: 'eredivisie',            label: '🇳🇱 Eredivisie',           sofaId: 37   },
  { country: 'netherlands', name: 'eerste divisie',        label: '🇳🇱 Eerste Divisie',        sofaId: 38   },
  { country: 'netherlands', name: 'knvb beker',            label: '🇳🇱 KNVB Beker',            sofaId: 390  },
  { country: 'england',     name: 'premier league',        label: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League',        sofaId: 17   },
  { country: 'england',     name: 'championship',          label: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Championship',           sofaId: 18   },
  { country: 'germany',     name: 'bundesliga',            label: '🇩🇪 Bundesliga',             sofaId: 35   },
  { country: 'germany',     name: '2. bundesliga',         label: '🇩🇪 2. Bundesliga',          sofaId: 36   },
  { country: 'spain',       name: 'laliga',                label: '🇪🇸 LaLiga',                 sofaId: 8    },
  { country: 'spain',       name: 'laliga2',               label: '🇪🇸 LaLiga2',                sofaId: 54   },
  { country: 'spain',       name: 'la liga',               label: '🇪🇸 LaLiga',                 sofaId: 8    },
  { country: 'spain',       name: 'segunda',               label: '🇪🇸 LaLiga2',                sofaId: 54   },
  { country: 'italy',       name: 'serie a',               label: '🇮🇹 Serie A',                sofaId: 23   },
  { country: 'italy',       name: 'serie b',               label: '🇮🇹 Serie B',                sofaId: 53   },
  { country: 'france',      name: 'ligue 1',               label: '🇫🇷 Ligue 1',                sofaId: 34   },
  { country: 'france',      name: 'ligue 2',               label: '🇫🇷 Ligue 2',                sofaId: 182  },
  { country: 'portugal',    name: 'liga portugal',         label: '🇵🇹 Liga Portugal',          sofaId: 238  },
  { country: 'portugal',    name: 'liga portugal 2',       label: '🇵🇹 Liga Portugal 2',        sofaId: 239  },
  { country: 'belgium',     name: 'pro league',            label: '🇧🇪 Pro League',              sofaId: 26   },
  { country: 'belgium',     name: 'challenger pro league', label: '🇧🇪 Challenger Pro League',  sofaId: 325  },
  { country: '',            name: 'champions league',      label: '🏆 Champions League',        sofaId: 7    },
  { country: '',            name: 'europa league',         label: '🥈 Europa League',           sofaId: 679  },
  { country: '',            name: 'conference league',     label: '🥉 Conference League',       sofaId: 17015},
];

function getAllowedLeague(event) {
  const tname    = (event?.tournament?.name || '').toLowerCase().trim();
  const category = (event?.tournament?.category?.name || '').toLowerCase().trim();
  for (const l of ALLOWED_LEAGUES) {
    const countryOk = !l.country || category.includes(l.country);
    const nameOk    = tname === l.name || tname.includes(l.name);
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function factorial(n) { if (n <= 1) return 1; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function poisson(l, k) { return (Math.pow(l, k) * Math.exp(-l)) / factorial(k); }

// ── DIXON-COLES correctiefactor ──────────────────────────────────────────────
// Corrigeert Poisson voor lage scores (0-0, 1-0, 0-1, 1-1 komen vaker voor)
function dixonColes(h, a, hxg, axg, rho = -0.13) {
  if (h === 0 && a === 0) return 1 - hxg * axg * rho;
  if (h === 0 && a === 1) return 1 + hxg * rho;
  if (h === 1 && a === 0) return 1 + axg * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

// ── SEIZOENSSTATISTIEKEN ophalen ─────────────────────────────────────────────
async function fetchTeamSeasonStats(teamId, tId, seasonId) {
  if (!tId || !seasonId) return null;
  const url = `${SOFA}/team/${teamId}/unique-tournament/${tId}/season/${seasonId}/statistics/overall`;
  const json = await safeFetch(url);
  if (!json?.statistics) return null;
  const s = json.statistics;
  return {
    avgShotsOn:    s.averageShotsOnTarget || null,
    avgShots:      s.averageShots || null,
    avgPossession: s.averageBallPossession || null,
    avgCorners:    s.averageCorners || null,
    avgYellow:     s.averageYellowCards || null,
    cleanSheets:   s.cleanSheets || null,
    failedToScore: s.failedToScore || null,
    games:         s.matches || null,
  };
}

// ── TEAMVORM ophalen ─────────────────────────────────────────────────────────
async function fetchTeamForm(teamId, n = 10) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/events/last/0`);
  if (!json?.events) return { form: '', avgScored: 1.35, avgConceded: 1.35, bttsRate: 0.5, gamesPlayed: 0 };

  const finished = json.events.filter(e => e.status?.type === 'finished').slice(-n);
  if (finished.length === 0) return { form: '', avgScored: 1.35, avgConceded: 1.35, bttsRate: 0.5, gamesPlayed: 0 };

  let form = '', totalScored = 0, totalConceded = 0, btts = 0;
  // Recente wedstrijden wegen zwaarder (exponentieel verval)
  let weightedScored = 0, weightedConceded = 0, totalWeight = 0;

  for (let i = 0; i < finished.length; i++) {
    const e = finished[i];
    const isHome  = String(e.homeTeam?.id) === String(teamId);
    const scored    = isHome ? e.homeScore?.current : e.awayScore?.current;
    const conceded  = isHome ? e.awayScore?.current : e.homeScore?.current;
    if (scored == null || conceded == null) continue;

    // Recente wedstrijden wegen meer
    const weight = Math.pow(0.85, finished.length - 1 - i);
    totalScored    += scored;
    totalConceded  += conceded;
    weightedScored   += scored * weight;
    weightedConceded += conceded * weight;
    totalWeight      += weight;
    if (scored > 0 && conceded > 0) btts++;
    form += scored > conceded ? 'W' : scored === conceded ? 'D' : 'L';
  }

  const n2 = finished.length;
  return {
    form:           form.slice(-5),
    avgScored:      totalWeight > 0 ? weightedScored / totalWeight : totalScored / n2,
    avgConceded:    totalWeight > 0 ? weightedConceded / totalWeight : totalConceded / n2,
    avgScoredRaw:   totalScored / n2,
    avgConcededRaw: totalConceded / n2,
    bttsRate:       btts / n2,
    gamesPlayed:    n2,
    wins:           (form.match(/W/g) || []).length,
    draws:          (form.match(/D/g) || []).length,
    losses:         (form.match(/L/g) || []).length,
  };
}

// ── HEAD-TO-HEAD ophalen ─────────────────────────────────────────────────────
async function fetchH2H(eventId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/h2h`);
  if (!json?.events?.length) return null;

  const last10 = json.events.filter(e => e.status?.type === 'finished').slice(-10);
  let homeWins = 0, draws = 0, awayWins = 0;
  const results = [];

  for (const e of last10) {
    const hg = e.homeScore?.current, ag = e.awayScore?.current;
    if (hg == null || ag == null) continue;
    if (hg > ag) homeWins++; else if (hg === ag) draws++; else awayWins++;
    results.push({
      home: e.homeTeam?.name, away: e.awayTeam?.name,
      score: `${hg}-${ag}`,
      date: e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString().split('T')[0] : null
    });
  }

  return { played: results.length, homeWins, draws, awayWins, results };
}

// ── COMPETITIESTAND ophalen ──────────────────────────────────────────────────
async function fetchStandings(tId, seasonId) {
  if (!tId || !seasonId) return null;
  const json = await safeFetch(`${SOFA}/unique-tournament/${tId}/season/${seasonId}/standings/total`);
  if (!json?.standings?.[0]?.rows) return null;
  return json.standings[0].rows.map(r => ({
    pos: r.position, team: r.team?.name, teamId: String(r.team?.id || ''),
    p: r.matches, w: r.wins, d: r.draws, l: r.losses,
    gf: r.scoresFor, ga: r.scoresAgainst, pts: r.points
  }));
}

// ── GEAVANCEERD DIXON-COLES PREDICT MODEL ────────────────────────────────────
function dixonColesPredict(homeStats, awayStats, homeSeasonStats, awaySeasonStats, homeElo, awayElo, h2h) {
  const homeAdv  = 1.1;
  const avgLeague = 1.35;

  // Aanvals/verdedigingskracht uit gewogen recente vorm
  let homeAtk = clamp(homeStats.avgScored   / avgLeague, 0.35, 3.2);
  let homeDef = clamp(homeStats.avgConceded / avgLeague, 0.35, 3.2);
  let awayAtk = clamp(awayStats.avgScored   / avgLeague, 0.35, 3.2);
  let awayDef = clamp(awayStats.avgConceded / avgLeague, 0.35, 3.2);

  // Boost van seizoensstatistieken schoten (indien beschikbaar)
  if (homeSeasonStats?.avgShotsOn && awaySeasonStats?.avgShotsOn) {
    const avgShots = (homeSeasonStats.avgShotsOn + awaySeasonStats.avgShotsOn) / 2;
    if (avgShots > 0) {
      homeAtk = homeAtk * 0.7 + (homeSeasonStats.avgShotsOn / avgShots) * 0.3;
      awayAtk = awayAtk * 0.7 + (awaySeasonStats.avgShotsOn / avgShots) * 0.3;
    }
  }

  // Elo correctiefactor (max ±20% effect)
  const eloFactor = clamp(Math.pow(10, (homeElo - awayElo) / 1200), 0.8, 1.25);

  const hxg = clamp(avgLeague * homeAtk / awayDef * homeAdv * Math.sqrt(eloFactor), 0.15, 5.5);
  const axg = clamp(avgLeague * awayAtk / homeDef / Math.sqrt(eloFactor), 0.15, 5.5);

  // H2H correctie (lichte aanpassing op basis van historische resultaten)
  let h2hHomeBoost = 0;
  if (h2h && h2h.played >= 4) {
    const h2hHomeRate = h2h.homeWins / h2h.played;
    h2hHomeBoost = (h2hHomeRate - 0.4) * 0.08; // max ±3.2% xG aanpassing
  }

  const finalHxg = clamp(hxg * (1 + h2hHomeBoost), 0.15, 5.5);
  const finalAxg = clamp(axg * (1 - h2hHomeBoost), 0.15, 5.5);

  // Dixon-Coles score matrix (0-7 doelpunten)
  let hp = 0, dp = 0, ap = 0, bestScore = '1-1', bestP = 0;
  const scoreMatrix = {};
  let over05 = 0, over15 = 0, over25 = 0, over35 = 0, btts = 0;

  for (let h = 0; h <= 7; h++) {
    for (let a = 0; a <= 7; a++) {
      const rawP  = poisson(finalHxg, h) * poisson(finalAxg, a);
      const dcMod = dixonColes(h, a, finalHxg, finalAxg);
      const p     = rawP * dcMod;

      if (h > a) hp += p; else if (a > h) ap += p; else dp += p;
      if (p > bestP) { bestP = p; bestScore = `${h}-${a}`; }

      const total = h + a;
      if (total > 0.5) over05 += p;
      if (total > 1.5) over15 += p;
      if (total > 2.5) over25 += p;
      if (total > 3.5) over35 += p;
      if (h > 0 && a > 0) btts += p;
      if (p > 0.008) scoreMatrix[`${h}-${a}`] = parseFloat(p.toFixed(4));
    }
  }

  // Normaliseer (DC geeft soms net iets boven 1.0 totaal)
  const total = hp + dp + ap;
  hp /= total; dp /= total; ap /= total;

  // Confidence: combinatie van score zekerheid + Elo verschil + H2H consistentie
  const eloDiff    = Math.abs(homeElo - awayElo);
  const eloBoost   = Math.min(0.12, eloDiff / 1200);
  const h2hBoost   = h2h?.played >= 6 ? 0.03 : 0;
  const confidence = Math.min(0.93, bestP * 3.5 + eloBoost + h2hBoost);

  const [predH, predA] = bestScore.split('-').map(Number);

  // Top scores gesorteerd
  const sortedMatrix = Object.fromEntries(
    Object.entries(scoreMatrix).sort((a, b) => b[1] - a[1]).slice(0, 8)
  );

  return {
    homeProb: parseFloat(hp.toFixed(4)),
    drawProb: parseFloat(dp.toFixed(4)),
    awayProb: parseFloat(ap.toFixed(4)),
    homeXG: parseFloat(finalHxg.toFixed(2)),
    awayXG: parseFloat(finalAxg.toFixed(2)),
    predHomeGoals: predH, predAwayGoals: predA,
    exactProb: parseFloat(bestP.toFixed(4)),
    confidence: parseFloat(confidence.toFixed(3)),
    over05: parseFloat(over05.toFixed(3)),
    over15: parseFloat(over15.toFixed(3)),
    over25: parseFloat(over25.toFixed(3)),
    over35: parseFloat(over35.toFixed(3)),
    btts: parseFloat(btts.toFixed(3)),
    scoreMatrix: sortedMatrix,
  };
}

// ── ELO UPDATE ───────────────────────────────────────────────────────────────
function updateElo(home, away, score) {
  if (!score?.includes("-")) return;
  const [h, a] = score.split("-").map(Number);
  if (isNaN(h) || isNaN(a)) return;
  const k   = 20;
  const exp = 1 / (1 + Math.pow(10, (away.elo - home.elo) / 400));
  const act = h > a ? 1 : h === a ? 0.5 : 0;
  home.elo = clamp(home.elo + k * (act - exp), 900, 2300);
  away.elo = clamp(away.elo + k * ((1-act) - (1-exp)), 900, 2300);
}

function getTeam(teams, id, name) {
  const key = id ? `id:${id}` : `name:${name.toLowerCase()}`;
  if (!teams[key]) teams[key] = { id: id || '', name, elo: 1500 };
  teams[key].name = name;
  if (id) teams[key].id = id;
  return teams[key];
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("[worker] start v5:", new Date().toISOString());

  let store = {
    teams: {}, predictions: {}, matches: {}, standings: {},
    teamStats: {}, teamSeasonStats: {},
    teamStatsUpdated: {}, teamSeasonStatsUpdated: {},
    lastRun: null
  };
  if (fs.existsSync(DATA_FILE)) {
    try { store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); } catch {}
  }
  // Init ontbrekende velden
  ['matches','standings','teamStats','teamSeasonStats','teamStatsUpdated','teamSeasonStatsUpdated'].forEach(k => {
    if (!store[k]) store[k] = {};
  });

  const today    = new Date().toISOString().split('T')[0];
  const yesterday= new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const now = Date.now();
  const SIX_HOURS = 6 * 3600 * 1000;
  const TWELVE_HOURS = 12 * 3600 * 1000;

  // ── Stap 1: wedstrijden ophalen ──────────────────────────────────────────
  const allEventsByDate = {};
  const teamIdsNeeded   = new Set();
  const tournamentsMap  = new Map(); // tId_seasonId → { tId, seasonId, label }

  for (const date of [yesterday, today, tomorrow]) {
    const json = await safeFetch(`${SOFA}/sport/football/scheduled-events/${date}`);
    if (!json?.events) continue;
    const filtered = json.events.filter(e => getAllowedLeague(e));
    allEventsByDate[date] = filtered;
    for (const e of filtered) {
      if (e.homeTeam?.id) teamIdsNeeded.add(String(e.homeTeam.id));
      if (e.awayTeam?.id) teamIdsNeeded.add(String(e.awayTeam.id));
      const tId = e.uniqueTournament?.id || e.tournament?.uniqueTournament?.id;
      const sId = e.season?.id;
      if (tId && sId) {
        const leagueInfo = getAllowedLeague(e);
        if (leagueInfo) tournamentsMap.set(`${tId}_${sId}`, { tId, sId, label: leagueInfo.label });
      }
    }
    await sleep(300);
  }
  console.log(`[worker] ${teamIdsNeeded.size} teams, ${tournamentsMap.size} competities`);

  // ── Stap 2: teamvorm ophalen ─────────────────────────────────────────────
  let formUpdated = 0;
  for (const teamId of teamIdsNeeded) {
    if (now - (store.teamStatsUpdated[teamId] || 0) < SIX_HOURS) continue;
    const stats = await fetchTeamForm(teamId, 10);
    store.teamStats[teamId] = stats;
    store.teamStatsUpdated[teamId] = now;
    formUpdated++;
    await sleep(150);
  }
  console.log(`[worker] ${formUpdated} teamvormen bijgewerkt`);

  // ── Stap 3: seizoensstatistieken ophalen ─────────────────────────────────
  // Koppel teams aan hun toernooi
  const teamTournamentMap = new Map();
  for (const [key, info] of tournamentsMap) {
    const dateEvents = allEventsByDate[today] || allEventsByDate[tomorrow] || [];
    for (const e of dateEvents) {
      if (e.homeTeam?.id) teamTournamentMap.set(String(e.homeTeam.id), info);
      if (e.awayTeam?.id) teamTournamentMap.set(String(e.awayTeam.id), info);
    }
  }

  let seasonStatsUpdated = 0;
  for (const teamId of teamIdsNeeded) {
    if (now - (store.teamSeasonStatsUpdated[teamId] || 0) < TWELVE_HOURS) continue;
    const tourInfo = teamTournamentMap.get(teamId);
    if (!tourInfo) continue;
    const stats = await fetchTeamSeasonStats(teamId, tourInfo.tId, tourInfo.sId);
    if (stats) {
      store.teamSeasonStats[teamId] = stats;
      store.teamSeasonStatsUpdated[teamId] = now;
      seasonStatsUpdated++;
    }
    await sleep(180);
  }
  console.log(`[worker] ${seasonStatsUpdated} seizoensstatistieken bijgewerkt`);

  // ── Stap 4: competitiestanden ophalen ────────────────────────────────────
  let standingsUpdated = 0;
  for (const [key, { tId, sId, label }] of tournamentsMap) {
    if (store.standings[key] && now - (store.standings[key].updated || 0) < SIX_HOURS) continue;
    const rows = await fetchStandings(tId, sId);
    if (rows) {
      store.standings[key] = { label, rows, updated: now };
      standingsUpdated++;
    }
    await sleep(200);
  }
  console.log(`[worker] ${standingsUpdated} standen bijgewerkt`);

  // ── Stap 5: wedstrijden verwerken + voorspellingen ───────────────────────
  for (const date of [yesterday, today, tomorrow]) {
    const events = allEventsByDate[date] || [];
    const dayMatches = [], dayPredictions = [];

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

      const homeStats       = store.teamStats[homeId]       || { avgScored: 1.35, avgConceded: 1.35 };
      const awayStats       = store.teamStats[awayId]       || { avgScored: 1.35, avgConceded: 1.35 };
      const homeSeasonStats = store.teamSeasonStats[homeId] || null;
      const awaySeasonStats = store.teamSeasonStats[awayId] || null;
      const h2hData         = null; // wordt later ingevuld voor vandaag

      const pred = dixonColesPredict(
        homeStats, awayStats,
        homeSeasonStats, awaySeasonStats,
        homeTeamStore.elo, awayTeamStore.elo,
        h2hData
      );

      const matchId = `ss-${e.id}`;

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
        homeForm: homeStats.form || '', awayForm: awayStats.form || '',
        homeElo: Math.round(homeTeamStore.elo), awayElo: Math.round(awayTeamStore.elo),
        homeSeasonStats: homeSeasonStats ? {
          shots: homeSeasonStats.avgShots,
          shotsOn: homeSeasonStats.avgShotsOn,
          possession: homeSeasonStats.avgPossession,
          corners: homeSeasonStats.avgCorners,
        } : null,
        awaySeasonStats: awaySeasonStats ? {
          shots: awaySeasonStats.avgShots,
          shotsOn: awaySeasonStats.avgShotsOn,
          possession: awaySeasonStats.avgPossession,
          corners: awaySeasonStats.avgCorners,
        } : null,
      });

      dayPredictions.push({
        matchId, homeTeam: homeName, awayTeam: awayName,
        league: leagueInfo.label, ...pred,
        homeForm: homeStats.form || '', awayForm: awayStats.form || '',
        homeElo: Math.round(homeTeamStore.elo), awayElo: Math.round(awayTeamStore.elo),
      });
    }

    store.matches[date]     = dayMatches;
    store.predictions[date] = dayPredictions;
    console.log(`[worker] ${date}: ${dayMatches.length} wedstrijden`);
  }

  // ── Stap 6: H2H ophalen voor vandaag + update predictions ────────────────
  const todayMatches = store.matches[today] || [];
  let h2hFetched = 0;
  for (const m of todayMatches.slice(0, 25)) {
    if (m.h2h) continue;
    await sleep(250);
    const h2h = await fetchH2H(m.sofaId);
    if (!h2h) continue;
    m.h2h = h2h;
    h2hFetched++;

    // Update voorspelling met H2H data
    const predIdx = store.predictions[today]?.findIndex(p => p.matchId === m.id);
    if (predIdx >= 0) {
      const p = store.predictions[today][predIdx];
      const homeStats = store.teamStats[m.homeTeamId] || { avgScored: 1.35, avgConceded: 1.35 };
      const awayStats = store.teamStats[m.awayTeamId] || { avgScored: 1.35, avgConceded: 1.35 };
      const newPred = dixonColesPredict(
        homeStats, awayStats,
        store.teamSeasonStats[m.homeTeamId] || null,
        store.teamSeasonStats[m.awayTeamId] || null,
        m.homeElo || 1500, m.awayElo || 1500,
        h2h
      );
      store.predictions[today][predIdx] = { ...p, ...newPred };
    }
  }
  console.log(`[worker] ${h2hFetched} H2H opgehaald`);

  // ── Stap 7: live scores mergen ───────────────────────────────────────────
  const liveJson = await safeFetch(`${SOFA}/sport/football/events/live`);
  if (liveJson?.events) {
    if (!store.matches[today]) store.matches[today] = [];
    let merged = 0;
    for (const live of liveJson.events) {
      const leagueInfo = getAllowedLeague(live);
      if (!leagueInfo) continue;
      const matchId = `ss-${live.id}`;
      const idx = store.matches[today].findIndex(m => m.id === matchId);
      const hg = live.homeScore?.current, ag = live.awayScore?.current;
      const liveData = {
        status: 'LIVE',
        score:  (hg != null && ag != null) ? `${hg}-${ag}` : null,
        minute: live.time?.current ? `${live.time.current}'` : null,
      };
      if (idx >= 0) Object.assign(store.matches[today][idx], liveData);
      else {
        store.matches[today].push({
          id: matchId, sofaId: live.id, date: today,
          kickoff: live.startTimestamp ? new Date(live.startTimestamp * 1000).toISOString() : null,
          league: leagueInfo.label,
          homeTeamName: live.homeTeam?.name || 'Home',
          awayTeamName: live.awayTeam?.name || 'Away',
          homeTeamId: live.homeTeam?.id ? String(live.homeTeam.id) : '',
          awayTeamId: live.awayTeam?.id ? String(live.awayTeam.id) : '',
          homeLogo: live.homeTeam?.id ? `https://api.sofascore.app/api/v1/team/${live.homeTeam.id}/image` : '',
          awayLogo: live.awayTeam?.id ? `https://api.sofascore.app/api/v1/team/${live.awayTeam.id}/image` : '',
          ...liveData
        });
      }
      merged++;
    }
    console.log(`[worker] ${merged} live wedstrijden gemerged`);
  }

  // ── Opslaan ──────────────────────────────────────────────────────────────
  store.lastRun = Date.now();
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  for (const d of Object.keys(store.matches))     if (d < cutoff) delete store.matches[d];
  for (const d of Object.keys(store.predictions)) if (d < cutoff) delete store.predictions[d];

  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  console.log(`[worker] klaar! ${store.matches[today]?.length || 0} wedstrijden, ${Object.keys(store.teams).length} teams in DB`);
}

main();
