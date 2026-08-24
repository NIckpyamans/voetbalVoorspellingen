#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { canonicalDedupeTeam } from "../shared/matchNormalization.js";
import { normalizeFotMob, normalizeSofaScore } from "./providers/lineup-normalizers.js";

const ROOT = process.cwd();
const DAYS_DIR = path.join(ROOT, "data", "days");
const REPORT_FILE = path.join(ROOT, "monitor", "recent-match-context-backfill.json");
const DAYS_BACK = Math.max(1, Number(process.env.RECENT_CONTEXT_DAYS_BACK || 35));
const LINEUP_LIMIT = Math.max(0, Number(process.env.RECENT_CONTEXT_LINEUP_LIMIT || 30));
const FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.RECENT_CONTEXT_FETCH_TIMEOUT_MS || 7000));

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function scorePair(match) {
  const direct = String(match?.score || "").match(/(\d+)\s*-\s*(\d+)/);
  if (direct) return [Number(direct[1]), Number(direct[2])];
  const home = Number(match?.homeScore);
  const away = Number(match?.awayScore);
  return Number.isFinite(home) && Number.isFinite(away) ? [home, away] : null;
}

function isFinished(match) {
  return /^(FT|AET|PEN|FINISHED)$/i.test(String(match?.status || "")) && Boolean(scorePair(match));
}

function kickoffMs(match, fallbackDate) {
  return Date.parse(match?.kickoff || `${match?.date || fallbackDate}T12:00:00.000Z`) || 0;
}

function teamKey(value) {
  return canonicalDedupeTeam(value);
}

function fixtureKey(match) {
  const pair = [teamKey(match?.homeTeamName), teamKey(match?.awayTeamName)].sort().join("__");
  return `${String(match?.date || match?._dateKey || "").slice(0, 10)}|${pair}|${match?.score || ""}`;
}

export function buildHistoricalH2H(match, history, limit = 5) {
  const homeKey = teamKey(match?.homeTeamName);
  const awayKey = teamKey(match?.awayTeamName);
  const cutoff = kickoffMs(match, match?._dateKey);
  const prior = history
    .filter((item) => item._kickoffMs < cutoff && isFinished(item))
    .filter((item) => {
      const itemHome = teamKey(item.homeTeamName);
      const itemAway = teamKey(item.awayTeamName);
      return (itemHome === homeKey && itemAway === awayKey) || (itemHome === awayKey && itemAway === homeKey);
    });
  const unique = new Map(prior.map((item) => [fixtureKey(item), item]));
  const rows = [...unique.values()].sort((a, b) => a._kickoffMs - b._kickoffMs).slice(-limit);
  if (!rows.length) return null;
  const homeId = String(match?.homeTeamId || homeKey);
  const awayId = String(match?.awayTeamId || awayKey);
  const results = rows.map((item) => {
    const [homeGoals, awayGoals] = scorePair(item);
    const winnerTeam = homeGoals === awayGoals ? "" : homeGoals > awayGoals ? item.homeTeamName : item.awayTeamName;
    const winnerKey = teamKey(winnerTeam);
    return {
      eventId: item.id || null,
      date: item.date || item._dateKey,
      home: item.homeTeamName,
      away: item.awayTeamName,
      homeTeamId: teamKey(item.homeTeamName) === homeKey ? homeId : awayId,
      awayTeamId: teamKey(item.awayTeamName) === awayKey ? awayId : homeId,
      score: `${homeGoals}-${awayGoals}`,
      winnerId: !winnerTeam ? "" : winnerKey === homeKey ? homeId : awayId,
      source: item.dataSource || "local-finished-match-history",
    };
  });
  const homeWins = results.filter((item) => item.winnerId === homeId).length;
  const awayWins = results.filter((item) => item.winnerId === awayId).length;
  const weights = results.map((_, index) => index + 1);
  const weighted = results.reduce((sum, item, index) => sum + (item.winnerId === homeId ? weights[index] : item.winnerId === awayId ? -weights[index] : 0), 0);
  return {
    played: results.length,
    homeWins,
    draws: results.length - homeWins - awayWins,
    awayWins,
    sameCompetitionPlayed: rows.filter((item) => String(item.league || "") === String(match.league || "")).length,
    weightedRecentBalance: Number((weighted / Math.max(1, weights.reduce((a, b) => a + b, 0))).toFixed(3)),
    results,
    status: "local-immutable-history",
    source: "local immutable finished-match history",
    asOf: new Date(Math.max(...rows.map((item) => item._kickoffMs))).toISOString(),
  };
}

function summarizeFormRows(rows, teamName) {
  const currentTeam = teamKey(teamName);
  const recentMatches = rows.map((item) => {
    const [homeGoals, awayGoals] = scorePair(item);
    const home = teamKey(item.homeTeamName) === currentTeam;
    const goalsFor = home ? homeGoals : awayGoals;
    const goalsAgainst = home ? awayGoals : homeGoals;
    return {
      date: item.date || item._dateKey,
      eventId: item.id || null,
      league: item.league || null,
      venue: home ? "H" : "A",
      opponent: home ? item.awayTeamName : item.homeTeamName,
      opponentId: home ? item.awayTeamId || null : item.homeTeamId || null,
      score: `${goalsFor}-${goalsAgainst}`,
      goalsFor,
      goalsAgainst,
      result: goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D",
      source: item.dataSource || "local-finished-match-history",
    };
  });
  const split = (venue) => {
    const selected = recentMatches.filter((item) => item.venue === venue);
    const games = selected.length;
    const scored = selected.reduce((sum, item) => sum + item.goalsFor, 0);
    const conceded = selected.reduce((sum, item) => sum + item.goalsAgainst, 0);
    return {
      games,
      avgScored: games ? Number((scored / games).toFixed(2)) : 0,
      avgConceded: games ? Number((conceded / games).toFixed(2)) : 0,
      bttsRate: games ? Number((selected.filter((item) => item.goalsFor && item.goalsAgainst).length / games).toFixed(2)) : 0,
      over15Rate: games ? Number((selected.filter((item) => item.goalsFor + item.goalsAgainst > 1).length / games).toFixed(2)) : 0,
      over25Rate: games ? Number((selected.filter((item) => item.goalsFor + item.goalsAgainst > 2).length / games).toFixed(2)) : 0,
      cleanSheetRate: games ? Number((selected.filter((item) => item.goalsAgainst === 0).length / games).toFixed(2)) : 0,
      failToScoreRate: games ? Number((selected.filter((item) => item.goalsFor === 0).length / games).toFixed(2)) : 0,
      wins: selected.filter((item) => item.result === "W").length,
      draws: selected.filter((item) => item.result === "D").length,
      losses: selected.filter((item) => item.result === "L").length,
      scoredTotal: scored,
      concededTotal: conceded,
    };
  };
  const games = recentMatches.length;
  const scored = recentMatches.reduce((sum, item) => sum + item.goalsFor, 0);
  const conceded = recentMatches.reduce((sum, item) => sum + item.goalsAgainst, 0);
  return {
    form: recentMatches.slice(-5).map((item) => item.result).join(""),
    avgScored: Number((scored / games).toFixed(2)),
    avgConceded: Number((conceded / games).toFixed(2)),
    bttsRate: Number((recentMatches.filter((item) => item.goalsFor && item.goalsAgainst).length / games).toFixed(2)),
    over15Rate: Number((recentMatches.filter((item) => item.goalsFor + item.goalsAgainst > 1).length / games).toFixed(2)),
    over25Rate: Number((recentMatches.filter((item) => item.goalsFor + item.goalsAgainst > 2).length / games).toFixed(2)),
    cleanSheetRate: Number((recentMatches.filter((item) => item.goalsAgainst === 0).length / games).toFixed(2)),
    failToScoreRate: Number((recentMatches.filter((item) => item.goalsFor === 0).length / games).toFixed(2)),
    yellowCardRate: 0,
    redCardRate: 0,
    gamesPlayed: games,
    wins: recentMatches.filter((item) => item.result === "W").length,
    draws: recentMatches.filter((item) => item.result === "D").length,
    losses: recentMatches.filter((item) => item.result === "L").length,
    splits: { home: split("H"), away: split("A") },
    recentMatches,
    strongestSide: split("H").avgScored - split("H").avgConceded >= split("A").avgScored - split("A").avgConceded ? "home" : "away",
    source: "local immutable finished-match history",
  };
}

export function buildHistoricalForm(match, history, teamName, limit = 10) {
  const key = teamKey(teamName);
  const cutoff = kickoffMs(match, match?._dateKey);
  const candidates = history
    .filter((item) => item._kickoffMs < cutoff && isFinished(item))
    .filter((item) => teamKey(item.homeTeamName) === key || teamKey(item.awayTeamName) === key)
    .sort((a, b) => a._kickoffMs - b._kickoffMs);
  const unique = new Map(candidates.map((item) => [fixtureKey(item), item]));
  const rows = [...unique.values()].slice(-limit);
  return rows.length ? summarizeFormRows(rows, teamName) : null;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; footyai-context-backfill/1.0)" }, signal: controller.signal });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHistoricalLineup(match) {
  const id = String(match?.id || match?.providerEventId || "");
  const fotmobId = id.match(/(?:^|ss-)fotmob-(\d+)$/i)?.[1];
  if (fotmobId) {
    const payload = await fetchJson(`https://www.fotmob.com/api/data/matchDetails?matchId=${encodeURIComponent(fotmobId)}`);
    const lineup = normalizeFotMob(payload);
    if (lineup?.confirmed) return lineup;
  }
  const sofaId = id.match(/^ss-(\d+)$/i)?.[1];
  if (sofaId) {
    const payload = await fetchJson(`https://www.sofascore.com/api/v1/event/${encodeURIComponent(sofaId)}/lineups`);
    const lineup = normalizeSofaScore(payload);
    if (lineup?.confirmed) return lineup;
  }
  return null;
}

function loadDays() {
  const days = [];
  for (const filename of fs.readdirSync(DAYS_DIR).filter((item) => /^\d{4}-\d{2}-\d{2}\.json$/.test(item))) {
    const filePath = path.join(DAYS_DIR, filename);
    const payload = readJson(filePath, {});
    const dateKey = filename.slice(0, 10);
    days.push({ filename, filePath, dateKey, payload });
  }
  return days;
}

async function main() {
  const now = Date.now();
  const cutoff = now - DAYS_BACK * 24 * 60 * 60 * 1000;
  const days = loadDays();
  const history = days.flatMap((day) => (day.payload.matches || []).map((match) => ({ ...match, _dateKey: day.dateKey, _kickoffMs: kickoffMs(match, day.dateKey) })))
    .filter(isFinished);
  const targets = days.flatMap((day) => (day.payload.matches || []).map((match, index) => ({ day, match, index, _dateKey: day.dateKey, _kickoffMs: kickoffMs(match, day.dateKey) })))
    .filter((item) => isFinished(item.match) && item._kickoffMs >= cutoff && item._kickoffMs < now)
    .sort((a, b) => b._kickoffMs - a._kickoffMs);
  let h2hFilled = 0;
  let formFilled = 0;
  let lineupsFilled = 0;
  let lineupAttempts = 0;
  const changedFiles = new Set();

  for (const target of targets) {
    const current = { ...target.match, _dateKey: target._dateKey, _kickoffMs: target._kickoffMs };
    const h2h = buildHistoricalH2H(current, history);
    if (h2h && Number(h2h.played) > Number(target.match?.h2h?.played || 0)) {
      target.match.h2h = h2h;
      target.match.h2hStatus = h2h.status;
      h2hFilled += 1;
      changedFiles.add(target.day.filePath);
    }
    const homeRecent = buildHistoricalForm(current, history, current.homeTeamName);
    const awayRecent = buildHistoricalForm(current, history, current.awayTeamName);
    const currentFormGames = Math.min(Number(target.match?.homeRecent?.gamesPlayed || 0), Number(target.match?.awayRecent?.gamesPlayed || 0));
    const newFormGames = Math.min(Number(homeRecent?.gamesPlayed || 0), Number(awayRecent?.gamesPlayed || 0));
    if (homeRecent && awayRecent && newFormGames > currentFormGames) {
      target.match.homeRecent = homeRecent;
      target.match.awayRecent = awayRecent;
      target.match.homeForm = homeRecent.form;
      target.match.awayForm = awayRecent.form;
      formFilled += 1;
      changedFiles.add(target.day.filePath);
    }
    if (!target.match?.lineupSummary?.confirmed && lineupAttempts < LINEUP_LIMIT) {
      lineupAttempts += 1;
      const lineup = await fetchHistoricalLineup(target.match);
      if (lineup?.confirmed) {
        const retrievedAt = new Date().toISOString();
        target.match.lineupSummary = {
          ...lineup,
          historicalBackfill: true,
          preMatchUsable: false,
          captureTiming: "post_match",
          retrievedAt,
          summary: "Werkelijke basisopstellingen na afloop teruggevonden; alleen voor historie en toekomstige teamanalyse, niet als pre-match bewijs.",
        };
        lineupsFilled += 1;
        changedFiles.add(target.day.filePath);
      }
    }
  }

  for (const day of days) {
    if (!changedFiles.has(day.filePath)) continue;
    fs.writeFileSync(day.filePath, `${JSON.stringify(day.payload)}\n`);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    daysBack: DAYS_BACK,
    checked: targets.length,
    h2hFilled,
    formFilled,
    lineupAttempts,
    lineupsFilled,
    changedFiles: [...changedFiles].map((item) => path.basename(item)),
    note: "Historische lineups worden als post_match gemarkeerd en tellen nooit als pre-match bewijs.",
  };
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
