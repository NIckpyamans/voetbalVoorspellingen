#!/usr/bin/env node

import fs from "fs";
import path from "path";
import process from "process";

const fetch = global.fetch;

const DATA_FILE = path.resolve(process.cwd(), "server_data.json");
const SOFASCORE_BASE = "https://api.sofascore.com/api/v1";

/* ------------------ STABILITY LAYER ------------------ */

process.on("unhandledRejection", err => {
  console.log("[worker] unhandled rejection:", err.message);
});

process.on("uncaughtException", err => {
  console.log("[worker] uncaught exception:", err.message);
});

async function safeFetch(url) {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 FootballPredictionBot"
      }
    });

    if (!res.ok) {
      console.log("[worker] API blocked:", res.status);
      return null;
    }

    return await res.json();

  } catch (err) {
    console.log("[worker] network error:", err.message);
    return null;
  }
}

/* ------------------ UTIL ------------------ */

function poisson(lambda, k) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function factorial(n) {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/* ------------------ TEAM STORE ------------------ */

function getTeam(store, name) {
  const key = name.toLowerCase();

  if (!store[key]) {
    store[key] = {
      name,
      elo: 1500,
      attack: 1.5,
      defense: 1.5,
      form: ""
    };
  }

  return store[key];
}

/* ------------------ MODEL ------------------ */

function generateScoreMatrix(hxg, axg) {

  let bestScore = "1-1";
  let maxProb = 0;

  let homeProb = 0;
  let drawProb = 0;
  let awayProb = 0;

  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {

      const prob = poisson(hxg, h) * poisson(axg, a);

      if (h > a) homeProb += prob;
      else if (a > h) awayProb += prob;
      else drawProb += prob;

      if (prob > maxProb) {
        maxProb = prob;
        bestScore = `${h}-${a}`;
      }
    }
  }

  return { bestScore, homeProb, drawProb, awayProb, maxProb };
}

function predict(home, away) {

  const homeAdv = 1.18;
  const avgGoals = 1.35;

  const homeXG =
    avgGoals * (home.attack / away.defense) * homeAdv;

  const awayXG =
    avgGoals * (away.attack / home.defense);

  const matrix = generateScoreMatrix(homeXG, awayXG);

  return {
    score: matrix.bestScore,
    homeProb: matrix.homeProb,
    drawProb: matrix.drawProb,
    awayProb: matrix.awayProb,
    confidence: matrix.maxProb
  };
}

/* ------------------ LEARNING ------------------ */

function updateTeams(home, away, score) {

  if (!score.includes("-")) return;

  const [h, a] = score.split("-").map(Number);

  const k = 22;

  const expHome = 1 / (1 + Math.pow(10, (away.elo - home.elo) / 400));
  const actHome = h === a ? 0.5 : h > a ? 1 : 0;

  home.elo += k * (actHome - expHome);
  away.elo += k * ((1 - actHome) - (1 - expHome));

  const alpha = 0.06;
  const avg = 1.35;

  home.attack = clamp(home.attack * (1 - alpha) + (h / avg) * alpha, 0.6, 3);
  home.defense = clamp(home.defense * (1 - alpha) + (a / avg) * alpha, 0.6, 3);

  away.attack = clamp(away.attack * (1 - alpha) + (a / avg) * alpha, 0.6, 3);
  away.defense = clamp(away.defense * (1 - alpha) + (h / avg) * alpha, 0.6, 3);
}

/* ------------------ FALLBACK MATCH GENERATOR ------------------ */

function generateSyntheticMatches() {

  const teams = [
    "Ajax","PSV","Feyenoord","AZ",
    "Arsenal","Liverpool","Chelsea","Man City",
    "Real Madrid","Barcelona","Atletico",
    "Bayern","Dortmund","Leipzig"
  ];

  const matches = [];

  for (let i = 0; i < 6; i++) {

    const home = teams[Math.floor(Math.random()*teams.length)];
    let away = teams[Math.floor(Math.random()*teams.length)];

    if (home === away) away = teams[(i+1)%teams.length];

    matches.push({
      id: `sim-${Date.now()}-${i}`,
      home,
      away
    });
  }

  return matches;
}

/* ------------------ FETCH MATCHES ------------------ */

async function fetchMatches() {

  const date = new Date().toISOString().split("T")[0];

  const url =
    `${SOFASCORE_BASE}/sport/football/scheduled-events/${date}`;

  const json = await safeFetch(url);

  if (!json || !json.events) {
    console.log("[worker] using synthetic matches");
    return generateSyntheticMatches();
  }

  return json.events.map(e => ({
    id: e.id,
    home: e.homeTeam?.name || "Home",
    away: e.awayTeam?.name || "Away"
  }));
}

/* ------------------ MAIN ------------------ */

async function main() {

  console.log("[worker] start");

  const matches = await fetchMatches();

  let store = {
    teams: {},
    memory: [],
    predictions: {},
    lastRun: null
  };

  if (fs.existsSync(DATA_FILE)) {
    store = JSON.parse(fs.readFileSync(DATA_FILE));
  }

  const preds = [];

  for (const m of matches) {

    const home = getTeam(store.teams, m.home);
    const away = getTeam(store.teams, m.away);

    const p = predict(home, away);

    preds.push({
      match: `${m.home} vs ${m.away}`,
      prediction: p.score,
      confidence: p.confidence
    });
  }

  const date = new Date().toISOString().split("T")[0];

  store.predictions[date] = preds;
  store.lastRun = Date.now();

  fs.writeFileSync(DATA_FILE, JSON.stringify(store,null,2));

  console.log("[worker] predictions generated:", preds.length);
  console.log("[worker] done");
}

main();
