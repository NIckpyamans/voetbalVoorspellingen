#!/usr/bin/env node
// ESM worker script that fetches matches, updates team model & memory and writes predictions to server_data.json
import fs from 'fs';
import path from 'path';
const fetch = global.fetch || (await import('node-fetch')).default;
const { execSync } = await import('node:child_process');

const SOFASCORE_BASE = 'https://api.sofascore.com/api/v1';
const DATA_FILE = path.resolve(process.cwd(), 'server_data.json');

function safeStr(v, fallback = '') { return typeof v === 'string' ? v : fallback; }

function mapStatus(event) {
  const type = safeStr(event?.status?.type).toLowerCase();
  const description = safeStr(event?.status?.description);
  const home = event?.homeScore?.current;
  const away = event?.awayScore?.current;
  const score = Number.isFinite(home) && Number.isFinite(away) ? `${home}-${away}` : 'v';
  const min = event?.time?.current;
  const minute = Number.isFinite(min) ? `${min}'` : undefined;
  if (type === 'finished') return { status: 'FT', score };
  if (type === 'inprogress') return { status: description || 'LIVE', minute, score };
  if (type === 'notstarted') return { status: 'NS', score: 'v' };
  return { status: description || event?.status?.type || '', minute, score };
}

function mapLeague(event) {
  const tournament = safeStr(event?.tournament?.name);
  const category = safeStr(event?.tournament?.category?.name);
  if (tournament && category) return `${category} — ${tournament}`;
  return tournament || category || 'Unknown';
}

function mapEventToMatch(dateISO, event) {
  const home = safeStr(event?.homeTeam?.name, 'Home');
  const away = safeStr(event?.awayTeam?.name, 'Away');
  const homeId = String(event?.homeTeam?.id ?? home).toLowerCase();
  const awayId = String(event?.awayTeam?.id ?? away).toLowerCase();
  const startTs = event?.startTimestamp;
  const kickoff = Number.isFinite(startTs) ? new Date(startTs * 1000).toISOString() : new Date().toISOString();
  const { status, minute, score } = mapStatus(event);
  const homeLogo = event?.homeTeam?.id ? `https://api.sofascore.app/api/v1/team/${event.homeTeam.id}/image` : `https://picsum.photos/seed/${encodeURIComponent(home)}/64`;
  const awayLogo = event?.awayTeam?.id ? `https://api.sofascore.app/api/v1/team/${event.awayTeam.id}/image` : `https://picsum.photos/seed/${encodeURIComponent(away)}/64`;
  return {
    id: `ss-${event?.id ?? `${home}-${away}-${kickoff}`}`,
    date: dateISO,
    kickoff,
    league: mapLeague(event),
    homeTeamId: homeId,
    awayTeamId: awayId,
    homeTeamName: home,
    awayTeamName: away,
    homeLogo,
    awayLogo,
    status,
    minute,
    score,
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function poisson(lambda, k) { return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k); }
function factorial(n) { if (n === 0 || n === 1) return 1; let res = 1; for (let i = 2; i <= n; i++) res *= i; return res; }
function generateScoreMatrix(hxg, axg) {
  const matrix = {};
  for (let h = 0; h <= 6; h++) for (let a = 0; a <= 6; a++) matrix[`${h}-${a}`] = poisson(hxg, h) * poisson(axg, a);
  return matrix;
}

function calculatePrediction(home, away) {
  const homeAdv = 1.18; const avgLeagueGoals = 1.35;
  const calculateFormModifier = (form) => { if (!form) return 1.0; const points = form.split('').reduce((acc, char) => { if (char === 'W') return acc + 1.2; if (char === 'D') return acc + 1.0; return acc + 0.8; }, 0); return points / form.length; };
  const homeFormMod = calculateFormModifier(home.form);
  const awayFormMod = calculateFormModifier(away.form);
  const homeXG = avgLeagueGoals * (home.attack / away.defense) * homeAdv * homeFormMod;
  const awayXG = avgLeagueGoals * (away.attack / home.defense) * awayFormMod;
  const matrix = generateScoreMatrix(homeXG, awayXG);
  let homeProb = 0, drawProb = 0, awayProb = 0, bestScore = '1-1', maxScoreProb = 0;
  Object.entries(matrix).forEach(([score, prob]) => { const [h, a] = score.split('-').map(Number); if (h > a) homeProb += prob; else if (h < a) awayProb += prob; else drawProb += prob; if (prob > maxScoreProb) { maxScoreProb = prob; bestScore = score; } });
  const [predH, predA] = bestScore.split('-').map(Number);
  const eloDiff = Math.abs(home.elo - away.elo);
  const confidence = Math.min(0.98, (maxScoreProb * 2.5) + (eloDiff / 3500) + (Math.abs(homeFormMod - awayFormMod) / 5));
  return { homeProb, drawProb, awayProb, homeXG, awayXG, predHomeGoals: predH, predAwayGoals: predA, exactProb: maxScoreProb, confidence };
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function getOrCreateTeam(store, params) {
  const key = params.id ? `id:${params.id}` : `name:${params.name.toLowerCase()}`;
  if (!store[key]) {
    store[key] = { id: params.id, name: params.name, league: params.league, logo: params.logo, elo: 1500, attack: 1.5, defense: 1.5, lastUpdated: Date.now() };
  } else {
    store[key] = { ...store[key], id: params.id || store[key].id, name: params.name || store[key].name, league: params.league || store[key].league, logo: params.logo || store[key].logo };
  }
  return store[key];
}

function expectedScore(eloA, eloB) { return 1 / (1 + Math.pow(10, (eloB - eloA) / 400)); }

function updateTeamModelsFromResult(store, match, homeKey, awayKey) {
  if (!match.score || !match.score.includes('-')) return;
  const [hG, aG] = match.score.split('-').map((x) => Number(x.trim()));
  if (!Number.isFinite(hG) || !Number.isFinite(aG)) return;
  const homeEntry = store[homeKey];
  const awayEntry = store[awayKey];
  if (!homeEntry || !awayEntry) return;
  const k = 22;
  const homeExp = expectedScore(homeEntry.elo, awayEntry.elo);
  const homeAct = hG === aG ? 0.5 : hG > aG ? 1 : 0;
  const awayAct = 1 - homeAct;
  homeEntry.elo = homeEntry.elo + k * (homeAct - homeExp);
  awayEntry.elo = awayEntry.elo + k * (awayAct - (1 - homeExp));
  const alpha = 0.06; const avgGoals = 1.35;
  homeEntry.attack = clamp(homeEntry.attack * (1 - alpha) + (hG / avgGoals) * alpha, 0.6, 3.0);
  homeEntry.defense = clamp(homeEntry.defense * (1 - alpha) + (aG / avgGoals) * alpha, 0.6, 3.0);
  awayEntry.attack = clamp(awayEntry.attack * (1 - alpha) + (aG / avgGoals) * alpha, 0.6, 3.0);
  awayEntry.defense = clamp(awayEntry.defense * (1 - alpha) + (hG / avgGoals) * alpha, 0.6, 3.0);
  homeEntry.lastUpdated = Date.now(); awayEntry.lastUpdated = Date.now();
}

async function fetchMatchesForDate(dateISO) {
  // Scheduled
  const url = `${SOFASCORE_BASE}/sport/football/scheduled-events/${dateISO}`;
  const json = await fetchJson(url);
  const events = json?.events ?? [];
  const scheduled = events.map(e => mapEventToMatch(dateISO, e));
  // Live
  let live = [];
  try { const liveJson = await fetchJson(`${SOFASCORE_BASE}/sport/football/events/live`); live = (liveJson?.events ?? []).map(e => mapEventToMatch(dateISO, e)); } catch (e) { }
  const byId = new Map(); for (const m of scheduled) byId.set(m.id, m); for (const m of live) { const existing = byId.get(m.id); byId.set(m.id, existing ? { ...existing, ...m } : m); }
  return Array.from(byId.values()).sort((a,b) => a.kickoff.localeCompare(b.kickoff));
}

(async function main() {
  try {
    const dateISO = new Date().toISOString().split('T')[0];
    console.log('[worker] running for', dateISO);
    const matches = await fetchMatchesForDate(dateISO);
    const raw = fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE, 'utf-8') : null;
    const store = raw ? JSON.parse(raw) : { teams: {}, memory: [], predictions: {}, lastRun: null };

    // Process finished matches and update team store & memory
    for (const m of matches) {
      if (!m.score || m.score === 'v' || !m.score.includes('-')) continue;
      const key = `ss-${m.id}`;
      // check if memory already has this match
      const seen = store.memory && store.memory.find(e => e.matchId === m.id);
      const homeKey = m.homeTeamId ? `id:${m.homeTeamId}` : `name:${m.homeTeamName.toLowerCase()}`;
      const awayKey = m.awayTeamId ? `id:${m.awayTeamId}` : `name:${m.awayTeamName.toLowerCase()}`;
      getOrCreateTeam(store.teams, { id: m.homeTeamId, name: m.homeTeamName, league: m.league, logo: m.homeLogo });
      getOrCreateTeam(store.teams, { id: m.awayTeamId, name: m.awayTeamName, league: m.league, logo: m.awayLogo });
      if (!seen) {
        // add to memory
        const predFake = '0-0';
        const [aH, aA] = m.score.split('-').map(Number);
        store.memory = store.memory || [];
        store.memory.push({ matchId: m.id, prediction: predFake, actual: m.score, wasCorrect: false, errorMargin: Math.abs(aH - 0) + Math.abs(aA - 0), timestamp: Date.now() });
        // update teams
        updateTeamModelsFromResult(store.teams, m, homeKey, awayKey);
      }
    }

    // Generate predictions for upcoming & live
    const pool = matches.filter(m => !(m.status && (m.status === 'FT' || m.status === 'FT')));
    const preds = [];
    for (const m of pool) {
      const home = getOrCreateTeam(store.teams, { id: m.homeTeamId, name: m.homeTeamName, league: m.league, logo: m.homeLogo });
      const away = getOrCreateTeam(store.teams, { id: m.awayTeamId, name: m.awayTeamName, league: m.league, logo: m.awayLogo });
      const base = calculatePrediction(home, away);
      preds.push({ ...base, matchId: m.id, homeTeam: m.homeTeamName, awayTeam: m.awayTeamName, league: m.league });
    }

    store.predictions = store.predictions || {};
    store.predictions[dateISO] = preds;
    store.lastRun = Date.now();

    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');

    // Commit + push changes (only if running in CI with GITHUB_TOKEN)
    if (process.env.GITHUB_TOKEN) {
      console.log('[worker] attempting to commit changes');
      execSync('git config user.name "github-actions[bot]"');
      execSync('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
      execSync('git add server_data.json');
      try { execSync('git commit -m "server: update predictions and model [ci]"'); execSync('git push'); console.log('[worker] committed & pushed'); } catch (e) { console.log('[worker] nothing to commit or push', e?.message); }
    }

    console.log('[worker] done');
  } catch (err) {
    console.error('[worker] error', err);
    process.exit(1);
  }
})();
