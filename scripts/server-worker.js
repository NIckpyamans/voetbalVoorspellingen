#!/usr/bin/env node
// server-worker.js - Alleen top Europese competities

import fs from "fs";
import path from "path";

const SOFA = "https://api.sofascore.com/api/v1";
const DATA_FILE = path.resolve(process.cwd(), "server_data.json");

// Alleen top competities — geen amateur, geen reserve, geen youth
const TOP_LEAGUES = new Set([
  // Nederland
  'eredivisie','eerste divisie',
  // Engeland
  'premier league','championship',
  // Duitsland
  'bundesliga','2. bundesliga',
  // Spanje
  'laliga','laliga2','la liga','segunda división',
  // Italië
  'serie a','serie b',
  // Frankrijk
  'ligue 1','ligue 2',
  // Portugal
  'liga portugal','liga portugal 2',
  // België
  'pro league','challenger pro league',
  // Turkije
  'süper lig','1. lig',
  // UEFA
  'champions league','europa league','conference league',
  'uefa champions league','uefa europa league','uefa conference league',
]);

const EXCLUDED_KEYWORDS = [
  'amateur','reserve','u23','u21','u20','u19','u18','u17',
  'youth','women','vrouwen','futsal','beach','indoor',
  'group','zona','region','district','county','subregion'
];

function isTopLeague(event) {
  const tname = (event?.tournament?.name || '').toLowerCase();
  const category = (event?.tournament?.category?.name || '').toLowerCase();

  // Sluit amateur/reserve/youth uit
  for (const keyword of EXCLUDED_KEYWORDS) {
    if (tname.includes(keyword) || category.includes(keyword)) return false;
  }

  // Check of het een top competitie is
  for (const league of TOP_LEAGUES) {
    if (tname.includes(league)) return true;
  }

  return false;
}

process.on("unhandledRejection", err => console.log("[worker] fout:", err.message));
process.on("uncaughtException", err => console.log("[worker] crash:", err.message));

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
    if (!res.ok) { console.log("[worker] geblokkeerd:", res.status, url); return null; }
    return await res.json();
  } catch (err) {
    console.log("[worker] netwerk fout:", err.message);
    return null;
  }
}

function factorial(n) { if (n <= 1) return 1; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function poisson(lambda, k) { return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function getTeam(teams, id, name) {
  const key = id ? `id:${id}` : name.toLowerCase();
  if (!teams[key]) teams[key] = { id: id || '', name, elo: 1500, attack: 1.5, defense: 1.5 };
  return teams[key];
}

function predict(home, away) {
  const hxg = 1.35 * (home.attack / away.defense) * 1.18;
  const axg = 1.35 * (away.attack / home.defense);
  let best = "1-1", bestP = 0, hp = 0, dp = 0, ap = 0;
  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const p = poisson(hxg, h) * poisson(axg, a);
      if (h > a) hp += p; else if (a > h) ap += p; else dp += p;
      if (p > bestP) { bestP = p; best = `${h}-${a}`; }
    }
  }
  const [ph, pa] = best.split('-').map(Number);
  return { homeProb: hp, drawProb: dp, awayProb: ap, homeXG: hxg, awayXG: axg,
           predHomeGoals: ph, predAwayGoals: pa, exactProb: bestP, confidence: bestP };
}

function updateTeams(home, away, score) {
  if (!score?.includes("-")) return;
  const [h, a] = score.split("-").map(Number);
  if (isNaN(h) || isNaN(a)) return;
  const k = 22, exp = 1 / (1 + Math.pow(10, (away.elo - home.elo) / 400));
  const act = h > a ? 1 : h === a ? 0.5 : 0;
  home.elo += k * (act - exp); away.elo += k * ((1-act) - (1-exp));
  const alpha = 0.06, avg = 1.35;
  home.attack = clamp(home.attack*(1-alpha)+(h/avg)*alpha, 0.6, 3);
  home.defense = clamp(home.defense*(1-alpha)+(a/avg)*alpha, 0.6, 3);
  away.attack = clamp(away.attack*(1-alpha)+(a/avg)*alpha, 0.6, 3);
  away.defense = clamp(away.defense*(1-alpha)+(h/avg)*alpha, 0.6, 3);
}

async function main() {
  console.log("[worker] start:", new Date().toISOString());
  let store = { teams: {}, predictions: {}, matches: {}, lastRun: null };
  if (fs.existsSync(DATA_FILE)) {
    try { store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); } catch {}
  }
  if (!store.matches) store.matches = {};

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  for (const date of [yesterday, today, tomorrow]) {
    const json = await safeFetch(`${SOFA}/sport/football/scheduled-events/${date}`);
    if (!json?.events) { console.log(`[worker] geen data voor ${date}`); continue; }

    const topEvents = json.events.filter(isTopLeague);
    console.log(`[worker] ${date}: ${topEvents.length} top wedstrijden (van ${json.events.length} totaal)`);

    const dayMatches = [], dayPredictions = [];

    for (const e of topEvents) {
      const homeName = e.homeTeam?.name || 'Home';
      const awayName = e.awayTeam?.name || 'Away';
      const homeId = e.homeTeam?.id ? String(e.homeTeam.id) : '';
      const awayId = e.awayTeam?.id ? String(e.awayTeam.id) : '';
      const homeTeam = getTeam(store.teams, homeId, homeName);
      const awayTeam = getTeam(store.teams, awayId, awayName);
      homeTeam.name = homeName; awayTeam.name = awayName;

      const statusType = e.status?.type || 'notstarted';
      const homeGoals = e.homeScore?.current;
      const awayGoals = e.awayScore?.current;
      const score = (homeGoals != null && awayGoals != null) ? `${homeGoals}-${awayGoals}` : null;

      if (statusType === 'finished' && score) updateTeams(homeTeam, awayTeam, score);

      const pred = predict(homeTeam, awayTeam);
      const matchId = `ss-${e.id}`;
      const league = [e.tournament?.category?.name, e.tournament?.name].filter(Boolean).join(' — ');

      dayMatches.push({
        id: matchId, sofaId: e.id, date,
        kickoff: e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString() : null,
        league, homeTeamName: homeName, awayTeamName: awayName,
        homeTeamId: homeId, awayTeamId: awayId,
        homeLogo: homeId ? `https://api.sofascore.app/api/v1/team/${homeId}/image` : '',
        awayLogo: awayId ? `https://api.sofascore.app/api/v1/team/${awayId}/image` : '',
        status: statusType === 'finished' ? 'FT' : statusType === 'inprogress' ? 'LIVE' : 'NS',
        score, minute: e.time?.current ? `${e.time.current}'` : null,
      });

      dayPredictions.push({
        matchId, homeTeam: homeName, awayTeam: awayName, league, ...pred
      });
    }

    store.matches[date] = dayMatches;
    store.predictions[date] = dayPredictions;
  }

  // Live wedstrijden mergen
  const liveJson = await safeFetch(`${SOFA}/sport/football/events/live`);
  if (liveJson?.events) {
    const liveTop = liveJson.events.filter(isTopLeague);
    console.log(`[worker] ${liveTop.length} live top wedstrijden`);
    if (!store.matches[today]) store.matches[today] = [];
    for (const live of liveTop) {
      const matchId = `ss-${live.id}`;
      const idx = store.matches[today].findIndex(m => m.id === matchId);
      const hg = live.homeScore?.current, ag = live.awayScore?.current;
      const liveMatch = {
        id: matchId, sofaId: live.id, date: today,
        kickoff: live.startTimestamp ? new Date(live.startTimestamp * 1000).toISOString() : null,
        league: [live.tournament?.category?.name, live.tournament?.name].filter(Boolean).join(' — '),
        homeTeamName: live.homeTeam?.name || 'Home', awayTeamName: live.awayTeam?.name || 'Away',
        homeTeamId: live.homeTeam?.id ? String(live.homeTeam.id) : '',
        awayTeamId: live.awayTeam?.id ? String(live.awayTeam.id) : '',
        homeLogo: live.homeTeam?.id ? `https://api.sofascore.app/api/v1/team/${live.homeTeam.id}/image` : '',
        awayLogo: live.awayTeam?.id ? `https://api.sofascore.app/api/v1/team/${live.awayTeam.id}/image` : '',
        status: 'LIVE', score: (hg != null && ag != null) ? `${hg}-${ag}` : null,
        minute: live.time?.current ? `${live.time.current}'` : null,
      };
      if (idx >= 0) store.matches[today][idx] = liveMatch;
      else store.matches[today].push(liveMatch);
    }
  }

  store.lastRun = Date.now();

  // Bewaar alleen laatste 7 dagen
  const cutoff = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
  for (const d of Object.keys(store.matches)) if (d < cutoff) delete store.matches[d];
  for (const d of Object.keys(store.predictions)) if (d < cutoff) delete store.predictions[d];

  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  const count = store.matches[today]?.length || 0;
  console.log(`[worker] klaar! ${count} wedstrijden vandaag`);
}

main();
