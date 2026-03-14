#!/usr/bin/env node
// server-worker.js
// Draait via GitHub Actions (elke 30 min)
// GitHub Actions IPs worden NIET geblokkeerd door SofaScore
// Slaat volledige wedstrijddata + voorspellingen op in server_data.json

import fs from "fs";
import path from "path";

const SOFA = "https://api.sofascore.com/api/v1";
const DATA_FILE = path.resolve(process.cwd(), "server_data.json");

const EUROPEAN_COUNTRIES = new Set([
  'england','spain','italy','germany','france','netherlands','portugal',
  'belgium','scotland','turkey','switzerland','austria','greece','sweden',
  'norway','denmark','poland','czech republic','romania','ukraine','serbia',
  'croatia','russia','hungary','slovakia','slovenia','ireland','wales','finland'
]);

process.on("unhandledRejection", err => console.log("[worker] promise error:", err.message));
process.on("uncaughtException", err => console.log("[worker] crash prevented:", err.message));

async function safeFetch(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Origin": "https://www.sofascore.com",
        "Referer": "https://www.sofascore.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      }
    });
    if (!res.ok) {
      console.log("[worker] api blocked:", res.status, url);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.log("[worker] network error:", err.message);
    return null;
  }
}

function isEuropean(event) {
  const category = (event?.tournament?.category?.name || '').toLowerCase();
  const tname = (event?.tournament?.name || '').toLowerCase();
  if (tname.includes('uefa') || tname.includes('champions') ||
      tname.includes('europa') || tname.includes('conference')) return true;
  for (const c of EUROPEAN_COUNTRIES) {
    if (category.includes(c) || tname.includes(c)) return true;
  }
  return false;
}

function factorial(n) {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poisson(lambda, k) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function getTeam(teams, id, name) {
  const key = id ? `id:${id}` : name.toLowerCase();
  if (!teams[key]) {
    teams[key] = { id: id || '', name, elo: 1500, attack: 1.5, defense: 1.5, form: [] };
  }
  return teams[key];
}

function scoreMatrix(hxg, axg) {
  let best = "1-1", bestProb = 0, home = 0, draw = 0, away = 0;
  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const p = poisson(hxg, h) * poisson(axg, a);
      if (h > a) home += p;
      else if (a > h) away += p;
      else draw += p;
      if (p > bestProb) { bestProb = p; best = `${h}-${a}`; }
    }
  }
  return { best, home, draw, away, bestProb };
}

function predict(homeTeam, awayTeam) {
  const homeAdv = 1.18, avgGoals = 1.35;
  const hxg = avgGoals * (homeTeam.attack / awayTeam.defense) * homeAdv;
  const axg = avgGoals * (awayTeam.attack / homeTeam.defense);
  const m = scoreMatrix(hxg, axg);
  const [predH, predA] = m.best.split('-').map(Number);
  return {
    homeProb: m.home, drawProb: m.draw, awayProb: m.away,
    homeXG: hxg, awayXG: axg,
    predHomeGoals: predH, predAwayGoals: predA,
    exactProb: m.bestProb, confidence: m.bestProb
  };
}

function updateTeams(homeTeam, awayTeam, score) {
  if (!score || !score.includes("-")) return;
  const [h, a] = score.split("-").map(Number);
  if (isNaN(h) || isNaN(a)) return;
  const k = 22;
  const expected = 1 / (1 + Math.pow(10, (awayTeam.elo - homeTeam.elo) / 400));
  const actual = h > a ? 1 : h === a ? 0.5 : 0;
  homeTeam.elo += k * (actual - expected);
  awayTeam.elo += k * ((1 - actual) - (1 - expected));
  const alpha = 0.06, avg = 1.35;
  homeTeam.attack = clamp(homeTeam.attack * (1 - alpha) + (h / avg) * alpha, 0.6, 3);
  homeTeam.defense = clamp(homeTeam.defense * (1 - alpha) + (a / avg) * alpha, 0.6, 3);
  awayTeam.attack = clamp(awayTeam.attack * (1 - alpha) + (a / avg) * alpha, 0.6, 3);
  awayTeam.defense = clamp(awayTeam.defense * (1 - alpha) + (h / avg) * alpha, 0.6, 3);
}

async function main() {
  console.log("[worker] start:", new Date().toISOString());

  // Laad bestaande data
  let store = { teams: {}, memory: [], predictions: {}, matches: {}, lastRun: null };
  if (fs.existsSync(DATA_FILE)) {
    try { store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
    catch (e) { console.log("[worker] store lezen mislukt, nieuw begin"); }
  }
  if (!store.matches) store.matches = {};

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  // Haal wedstrijden op voor gisteren, vandaag en morgen
  for (const date of [yesterday, today, tomorrow]) {
    console.log(`[worker] ophalen: ${date}`);
    const json = await safeFetch(`${SOFA}/sport/football/scheduled-events/${date}`);
    if (!json || !json.events) {
      console.log(`[worker] geen data voor ${date}`);
      continue;
    }

    const euEvents = json.events.filter(isEuropean);
    console.log(`[worker] ${date}: ${euEvents.length} Europese wedstrijden`);

    const dayMatches = [];
    const dayPredictions = [];

    for (const e of euEvents) {
      const homeName = e.homeTeam?.name || 'Home';
      const awayName = e.awayTeam?.name || 'Away';
      const homeId = e.homeTeam?.id ? String(e.homeTeam.id) : '';
      const awayId = e.awayTeam?.id ? String(e.awayTeam.id) : '';

      const homeTeam = getTeam(store.teams, homeId, homeName);
      const awayTeam = getTeam(store.teams, awayId, awayName);

      // Update namen en IDs
      homeTeam.name = homeName;
      awayTeam.name = awayName;
      if (homeId) homeTeam.id = homeId;
      if (awayId) awayTeam.id = awayId;

      // Status en score
      const statusType = e.status?.type || 'notstarted';
      const homeGoals = e.homeScore?.current;
      const awayGoals = e.awayScore?.current;
      const score = (homeGoals !== null && homeGoals !== undefined &&
                     awayGoals !== null && awayGoals !== undefined)
        ? `${homeGoals}-${awayGoals}` : null;

      // Leer van afgelopen resultaten
      if (statusType === 'finished' && score) {
        updateTeams(homeTeam, awayTeam, score);
      }

      // Maak voorspelling
      const pred = predict(homeTeam, awayTeam);
      const matchId = `ss-${e.id}`;

      // Wedstrijd data opslaan
      dayMatches.push({
        id: matchId,
        sofaId: e.id,
        date,
        kickoff: e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString() : null,
        league: [e.tournament?.category?.name, e.tournament?.name].filter(Boolean).join(' — '),
        homeTeamName: homeName,
        awayTeamName: awayName,
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeLogo: homeId ? `https://api.sofascore.app/api/v1/team/${homeId}/image` : '',
        awayLogo: awayId ? `https://api.sofascore.app/api/v1/team/${awayId}/image` : '',
        status: statusType === 'finished' ? 'FT' : statusType === 'inprogress' ? 'LIVE' : 'NS',
        score,
        minute: e.time?.current ? `${e.time.current}'` : null,
      });

      // Voorspelling opslaan
      dayPredictions.push({
        matchId,
        homeTeam: homeName,
        awayTeam: awayName,
        league: [e.tournament?.category?.name, e.tournament?.name].filter(Boolean).join(' — '),
        ...pred,
      });
    }

    store.matches[date] = dayMatches;
    store.predictions[date] = dayPredictions;
  }

  // Haal ook live wedstrijden op
  console.log("[worker] live wedstrijden ophalen...");
  const liveJson = await safeFetch(`${SOFA}/sport/football/events/live`);
  if (liveJson?.events) {
    const liveEu = liveJson.events.filter(isEuropean);
    console.log(`[worker] ${liveEu.length} live Europese wedstrijden`);
    // Merge live data in vandaag
    if (store.matches[today]) {
      for (const live of liveEu) {
        const matchId = `ss-${live.id}`;
        const idx = store.matches[today].findIndex((m) => m.id === matchId);
        const homeGoals = live.homeScore?.current;
        const awayGoals = live.awayScore?.current;
        const liveMatch = {
          id: matchId,
          sofaId: live.id,
          date: today,
          kickoff: live.startTimestamp ? new Date(live.startTimestamp * 1000).toISOString() : null,
          league: [live.tournament?.category?.name, live.tournament?.name].filter(Boolean).join(' — '),
          homeTeamName: live.homeTeam?.name || 'Home',
          awayTeamName: live.awayTeam?.name || 'Away',
          homeTeamId: live.homeTeam?.id ? String(live.homeTeam.id) : '',
          awayTeamId: live.awayTeam?.id ? String(live.awayTeam.id) : '',
          homeLogo: live.homeTeam?.id ? `https://api.sofascore.app/api/v1/team/${live.homeTeam.id}/image` : '',
          awayLogo: live.awayTeam?.id ? `https://api.sofascore.app/api/v1/team/${live.awayTeam.id}/image` : '',
          status: 'LIVE',
          score: (homeGoals !== null && homeGoals !== undefined) ? `${homeGoals}-${awayGoals}` : null,
          minute: live.time?.current ? `${live.time.current}'` : null,
        };
        if (idx >= 0) store.matches[today][idx] = liveMatch;
        else store.matches[today].push(liveMatch);
      }
    }
  }

  store.lastRun = Date.now();

  // Bewaar alleen laatste 7 dagen
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  for (const date of Object.keys(store.matches)) {
    if (date < cutoff) delete store.matches[date];
  }
  for (const date of Object.keys(store.predictions)) {
    if (date < cutoff) delete store.predictions[date];
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  console.log("[worker] klaar! wedstrijden vandaag:", store.matches[today]?.length || 0);
}

main();
