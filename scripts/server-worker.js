#!/usr/bin/env node
// server-worker.js v3 — met echte teamstatistieken en vormanalyse

import fs from "fs";
import path from "path";

const SOFA = "https://api.sofascore.com/api/v1";
const DATA_FILE = path.resolve(process.cwd(), "server_data.json");

// EXACTE whitelist
const ALLOWED_LEAGUES = [
  { country: 'netherlands', name: 'eredivisie',           label: '🇳🇱 Eredivisie' },
  { country: 'netherlands', name: 'eerste divisie',       label: '🇳🇱 Eerste Divisie' },
  { country: 'netherlands', name: 'knvb beker',           label: '🇳🇱 KNVB Beker' },
  { country: 'england',     name: 'premier league',       label: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League' },
  { country: 'england',     name: 'championship',         label: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Championship' },
  { country: 'germany',     name: 'bundesliga',           label: '🇩🇪 Bundesliga' },
  { country: 'germany',     name: '2. bundesliga',        label: '🇩🇪 2. Bundesliga' },
  { country: 'spain',       name: 'laliga',               label: '🇪🇸 LaLiga' },
  { country: 'spain',       name: 'laliga2',              label: '🇪🇸 LaLiga2' },
  { country: 'spain',       name: 'la liga',              label: '🇪🇸 LaLiga' },
  { country: 'spain',       name: 'segunda',              label: '🇪🇸 LaLiga2' },
  { country: 'italy',       name: 'serie a',              label: '🇮🇹 Serie A' },
  { country: 'italy',       name: 'serie b',              label: '🇮🇹 Serie B' },
  { country: 'france',      name: 'ligue 1',              label: '🇫🇷 Ligue 1' },
  { country: 'france',      name: 'ligue 2',              label: '🇫🇷 Ligue 2' },
  { country: 'portugal',    name: 'liga portugal',        label: '🇵🇹 Liga Portugal' },
  { country: 'portugal',    name: 'liga portugal 2',      label: '🇵🇹 Liga Portugal 2' },
  { country: 'belgium',     name: 'pro league',           label: '🇧🇪 Pro League' },
  { country: 'belgium',     name: 'challenger pro league',label: '🇧🇪 Challenger Pro League' },
  { country: '',            name: 'champions league',     label: '🏆 Champions League' },
  { country: '',            name: 'europa league',        label: '🥈 Europa League' },
  { country: '',            name: 'conference league',    label: '🥉 Conference League' },
];

function getAllowedLeague(event) {
  const tname = (event?.tournament?.name || '').toLowerCase().trim();
  const category = (event?.tournament?.category?.name || '').toLowerCase().trim();
  for (const l of ALLOWED_LEAGUES) {
    const countryOk = !l.country || category.includes(l.country);
    const nameOk = tname === l.name || tname.includes(l.name);
    if (countryOk && nameOk) return l.label;
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

// Haal laatste N wedstrijden op voor een team
async function fetchTeamForm(teamId, n = 10) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/events/last/0`);
  if (!json?.events) return [];
  return json.events
    .filter(e => e.status?.type === 'finished')
    .slice(-n) // laatste N
    .map(e => ({
      homeId: String(e.homeTeam?.id || ''),
      awayId: String(e.awayTeam?.id || ''),
      homeGoals: e.homeScore?.current ?? null,
      awayGoals: e.awayScore?.current ?? null,
    }))
    .filter(e => e.homeGoals !== null && e.awayGoals !== null);
}

// Bereken teamstatistieken uit recente wedstrijden
function calcTeamStats(teamId, recentMatches) {
  if (recentMatches.length === 0) return null;

  let goalsScored = 0, goalsConceded = 0, wins = 0, draws = 0, losses = 0;
  let formString = '';

  for (const m of recentMatches) {
    const isHome = m.homeId === String(teamId);
    const scored    = isHome ? m.homeGoals : m.awayGoals;
    const conceded  = isHome ? m.awayGoals : m.homeGoals;
    goalsScored   += scored;
    goalsConceded += conceded;
    if (scored > conceded)      { wins++;   formString += 'W'; }
    else if (scored === conceded){ draws++;  formString += 'D'; }
    else                         { losses++; formString += 'L'; }
  }

  const n = recentMatches.length;
  const avgScored    = goalsScored / n;
  const avgConceded  = goalsConceded / n;
  const avgLeague    = 1.35;

  // Attack = hoeveel meer/minder dan gemiddeld gescoord
  const attack  = Math.max(0.5, Math.min(3.0, avgScored / avgLeague));
  // Defense = hoe weinig tegendoelpunten t.o.v. gemiddeld (lager = beter)
  const defense = Math.max(0.5, Math.min(3.0, avgConceded / avgLeague));

  // Eenvoudige vorm-score voor Elo correctie
  const formScore = (wins * 3 + draws) / (n * 3); // 0-1

  return { attack, defense, formScore, formString, wins, draws, losses, n };
}

// Maak/update team in store
function getTeam(teams, id, name) {
  const key = id ? `id:${id}` : `name:${name.toLowerCase()}`;
  if (!teams[key]) {
    teams[key] = { id: id || '', name, elo: 1500, attack: 1.5, defense: 1.5, form: '', lastFormUpdate: 0 };
  }
  teams[key].name = name;
  if (id) teams[key].id = id;
  return teams[key];
}

function factorial(n) { if (n <= 1) return 1; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function poisson(l, k) { return (Math.pow(l, k) * Math.exp(-l)) / factorial(k); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function predict(home, away) {
  // Kleine home advantage
  const homeAdv = 1.1;
  const hxg = clamp(1.35 * (home.attack / away.defense) * homeAdv, 0.3, 5);
  const axg = clamp(1.35 * (away.attack / home.defense), 0.3, 5);

  let best = "1-1", bestP = 0, hp = 0, dp = 0, ap = 0;
  for (let h = 0; h <= 7; h++) {
    for (let a = 0; a <= 7; a++) {
      const p = poisson(hxg, h) * poisson(axg, a);
      if (h > a) hp += p; else if (a > h) ap += p; else dp += p;
      if (p > bestP) { bestP = p; best = `${h}-${a}`; }
    }
  }

  // Confidence hoger als Elo verschil groot is OF als vorm duidelijk beter is
  const eloDiff = Math.abs(home.elo - away.elo);
  const eloBoost = Math.min(0.15, eloDiff / 1000);
  const confidence = Math.min(0.95, bestP * 3 + eloBoost);

  const [ph, pa] = best.split('-').map(Number);
  return {
    homeProb: hp, drawProb: dp, awayProb: ap,
    homeXG: hxg, awayXG: axg,
    predHomeGoals: ph, predAwayGoals: pa,
    exactProb: bestP, confidence,
    homeForm: home.form || '', awayForm: away.form || '',
    homeElo: Math.round(home.elo), awayElo: Math.round(away.elo),
  };
}

function updateTeamsFromResult(home, away, score) {
  if (!score?.includes("-")) return;
  const [h, a] = score.split("-").map(Number);
  if (isNaN(h) || isNaN(a)) return;
  const k = 20;
  const exp = 1 / (1 + Math.pow(10, (away.elo - home.elo) / 400));
  const act = h > a ? 1 : h === a ? 0.5 : 0;
  home.elo = clamp(home.elo + k * (act - exp), 1000, 2200);
  away.elo = clamp(away.elo + k * ((1-act) - (1-exp)), 1000, 2200);
  const alpha = 0.12, avg = 1.35;
  home.attack  = clamp(home.attack  * (1-alpha) + (h/avg) * alpha, 0.4, 3.5);
  home.defense = clamp(home.defense * (1-alpha) + (a/avg) * alpha, 0.4, 3.5);
  away.attack  = clamp(away.attack  * (1-alpha) + (a/avg) * alpha, 0.4, 3.5);
  away.defense = clamp(away.defense * (1-alpha) + (h/avg) * alpha, 0.4, 3.5);
}

async function main() {
  console.log("[worker] start:", new Date().toISOString());

  let store = { teams: {}, predictions: {}, matches: {}, teamFormUpdated: {}, lastRun: null };
  if (fs.existsSync(DATA_FILE)) {
    try { store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); } catch {}
  }
  if (!store.matches) store.matches = {};
  if (!store.teamFormUpdated) store.teamFormUpdated = {};

  const today    = new Date().toISOString().split('T')[0];
  const yesterday= new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  // Stap 1: verzamel alle unieke team-IDs uit de wedstrijden van vandaag/morgen
  const teamIdsToUpdate = new Set();
  for (const date of [today, tomorrow]) {
    const json = await safeFetch(`${SOFA}/sport/football/scheduled-events/${date}`);
    if (!json?.events) continue;
    for (const e of json.events) {
      if (!getAllowedLeague(e)) continue;
      if (e.homeTeam?.id) teamIdsToUpdate.add(String(e.homeTeam.id));
      if (e.awayTeam?.id) teamIdsToUpdate.add(String(e.awayTeam.id));
    }
  }

  console.log(`[worker] ${teamIdsToUpdate.size} teams gevonden, vorm ophalen...`);

  // Stap 2: haal voor elk team de laatste 10 wedstrijden op
  // Maar niet te vaak (max 1x per 6 uur per team)
  const now = Date.now();
  const SIX_HOURS = 6 * 3600 * 1000;
  let formUpdated = 0;

  for (const teamId of teamIdsToUpdate) {
    const lastUpdate = store.teamFormUpdated[teamId] || 0;
    if (now - lastUpdate < SIX_HOURS) continue; // skip als recent bijgewerkt

    const recentMatches = await fetchTeamForm(teamId, 10);
    if (recentMatches.length > 0) {
      const stats = calcTeamStats(teamId, recentMatches);
      if (stats) {
        const key = `id:${teamId}`;
        if (!store.teams[key]) {
          store.teams[key] = { id: teamId, name: '', elo: 1500, attack: 1.5, defense: 1.5, form: '' };
        }
        // Update stats op basis van echte recente wedstrijden
        store.teams[key].attack  = stats.attack;
        store.teams[key].defense = stats.defense;
        store.teams[key].form    = stats.formString;
        // Elo aanpassen op basis van vorm
        const eloAdjust = (stats.formScore - 0.5) * 100; // max ±50
        store.teams[key].elo = clamp((store.teams[key].elo || 1500) + eloAdjust * 0.1, 1000, 2200);
        store.teamFormUpdated[teamId] = now;
        formUpdated++;
      }
    }

    // Kleine pauze om rate limiting te voorkomen
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`[worker] ${formUpdated} teams bijgewerkt met echte vorm`);

  // Stap 3: haal wedstrijden op en maak voorspellingen
  for (const date of [yesterday, today, tomorrow]) {
    const json = await safeFetch(`${SOFA}/sport/football/scheduled-events/${date}`);
    if (!json?.events) continue;

    const dayMatches = [], dayPredictions = [];

    for (const e of json.events) {
      const leagueLabel = getAllowedLeague(e);
      if (!leagueLabel) continue;

      const homeName = e.homeTeam?.name || 'Home';
      const awayName = e.awayTeam?.name || 'Away';
      const homeId   = e.homeTeam?.id ? String(e.homeTeam.id) : '';
      const awayId   = e.awayTeam?.id ? String(e.awayTeam.id) : '';

      const homeTeam = getTeam(store.teams, homeId, homeName);
      const awayTeam = getTeam(store.teams, awayId, awayName);

      const statusType = e.status?.type || 'notstarted';
      const hg = e.homeScore?.current, ag = e.awayScore?.current;
      const score = (hg != null && ag != null) ? `${hg}-${ag}` : null;

      // Leer van afgelopen wedstrijden
      if (statusType === 'finished' && score) {
        updateTeamsFromResult(homeTeam, awayTeam, score);
      }

      const pred = predict(homeTeam, awayTeam);
      const matchId = `ss-${e.id}`;

      dayMatches.push({
        id: matchId, sofaId: e.id, date,
        kickoff: e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString() : null,
        league: leagueLabel,
        homeTeamName: homeName, awayTeamName: awayName,
        homeTeamId: homeId, awayTeamId: awayId,
        homeLogo: homeId ? `https://api.sofascore.app/api/v1/team/${homeId}/image` : '',
        awayLogo: awayId ? `https://api.sofascore.app/api/v1/team/${awayId}/image` : '',
        status: statusType === 'finished' ? 'FT' : statusType === 'inprogress' ? 'LIVE' : 'NS',
        score, minute: e.time?.current ? `${e.time.current}'` : null,
      });

      dayPredictions.push({
        matchId, homeTeam: homeName, awayTeam: awayName, league: leagueLabel, ...pred
      });
    }

    console.log(`[worker] ${date}: ${dayMatches.length} wedstrijden`);
    store.matches[date] = dayMatches;
    store.predictions[date] = dayPredictions;
  }

  // Stap 4: live scores mergen
  const liveJson = await safeFetch(`${SOFA}/sport/football/events/live`);
  if (liveJson?.events) {
    if (!store.matches[today]) store.matches[today] = [];
    let liveMerged = 0;
    for (const live of liveJson.events) {
      const leagueLabel = getAllowedLeague(live);
      if (!leagueLabel) continue;
      const matchId = `ss-${live.id}`;
      const idx = store.matches[today].findIndex(m => m.id === matchId);
      const hg = live.homeScore?.current, ag = live.awayScore?.current;
      const liveMatch = {
        id: matchId, sofaId: live.id, date: today,
        kickoff: live.startTimestamp ? new Date(live.startTimestamp * 1000).toISOString() : null,
        league: leagueLabel,
        homeTeamName: live.homeTeam?.name || 'Home',
        awayTeamName: live.awayTeam?.name || 'Away',
        homeTeamId: live.homeTeam?.id ? String(live.homeTeam.id) : '',
        awayTeamId: live.awayTeam?.id ? String(live.awayTeam.id) : '',
        homeLogo: live.homeTeam?.id ? `https://api.sofascore.app/api/v1/team/${live.homeTeam.id}/image` : '',
        awayLogo: live.awayTeam?.id ? `https://api.sofascore.app/api/v1/team/${live.awayTeam.id}/image` : '',
        status: 'LIVE',
        score: (hg != null && ag != null) ? `${hg}-${ag}` : null,
        minute: live.time?.current ? `${live.time.current}'` : null,
      };
      if (idx >= 0) store.matches[today][idx] = liveMatch;
      else store.matches[today].push(liveMatch);
      liveMerged++;
    }
    console.log(`[worker] ${liveMerged} live wedstrijden gemerged`);
  }

  store.lastRun = Date.now();

  // Ruim oude data op (ouder dan 7 dagen)
  const cutoff = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
  for (const d of Object.keys(store.matches))      if (d < cutoff) delete store.matches[d];
  for (const d of Object.keys(store.predictions)) if (d < cutoff) delete store.predictions[d];

  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  console.log(`[worker] klaar! ${store.matches[today]?.length || 0} wedstrijden vandaag, ${Object.keys(store.teams).length} teams in database`);
}

main();
