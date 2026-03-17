#!/usr/bin/env node
// server-worker.js v8 — live minuten, extra tijd, kwartaalanalyse — goal timing kwartaalanalyse toegevoegd
// Verbeteringen: blessures, Bayesiaans leren, wedstrijdbelang, live statistieken, clublogo's

import fs from "fs";
import path from "path";

const SOFA      = "https://api.sofascore.com/api/v1";
const DATA_FILE = path.resolve(process.cwd(), "server_data.json");

const ALLOWED_LEAGUES = [
  { country:'netherlands', name:'eredivisie',            label:'🇳🇱 Eredivisie',          sofaId:37    },
  { country:'netherlands', name:'eerste divisie',        label:'🇳🇱 Eerste Divisie',       sofaId:38    },
  { country:'netherlands', name:'knvb beker',            label:'🇳🇱 KNVB Beker',           sofaId:390   },
  { country:'england',     name:'premier league',        label:'🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League',       sofaId:17    },
  { country:'england',     name:'championship',          label:'🏴󠁧󠁢󠁥󠁮󠁧󠁿 Championship',          sofaId:18    },
  { country:'germany',     name:'bundesliga',            label:'🇩🇪 Bundesliga',            sofaId:35    },
  { country:'germany',     name:'2. bundesliga',         label:'🇩🇪 2. Bundesliga',         sofaId:36    },
  { country:'spain',       name:'laliga',                label:'🇪🇸 LaLiga',                sofaId:8     },
  { country:'spain',       name:'laliga2',               label:'🇪🇸 LaLiga2',               sofaId:54    },
  { country:'spain',       name:'la liga',               label:'🇪🇸 LaLiga',                sofaId:8     },
  { country:'spain',       name:'segunda',               label:'🇪🇸 LaLiga2',               sofaId:54    },
  { country:'italy',       name:'serie a',               label:'🇮🇹 Serie A',               sofaId:23    },
  { country:'italy',       name:'serie b',               label:'🇮🇹 Serie B',               sofaId:53    },
  { country:'france',      name:'ligue 1',               label:'🇫🇷 Ligue 1',               sofaId:34    },
  { country:'france',      name:'ligue 2',               label:'🇫🇷 Ligue 2',               sofaId:182   },
  { country:'portugal',    name:'liga portugal',         label:'🇵🇹 Liga Portugal',         sofaId:238   },
  { country:'portugal',    name:'liga portugal 2',       label:'🇵🇹 Liga Portugal 2',       sofaId:239   },
  { country:'belgium',     name:'pro league',            label:'🇧🇪 Pro League',             sofaId:26    },
  { country:'belgium',     name:'challenger pro league', label:'🇧🇪 Challenger Pro League', sofaId:325   },
  { country:'',            name:'champions league',      label:'🏆 Champions League',       sofaId:7     },
  { country:'',            name:'europa league',         label:'🥈 Europa League',          sofaId:679   },
  { country:'',            name:'conference league',     label:'🥉 Conference League',      sofaId:17015 },
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

process.on("unhandledRejection", e => console.log("[worker] fout:", e.message));
process.on("uncaughtException",  e => console.log("[worker] crash:", e.message));

async function safeFetch(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://www.sofascore.com",
        "Referer": "https://www.sofascore.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
      }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function factorial(n) { if (n <= 1) return 1; let r = 1; for (let i=2;i<=n;i++) r*=i; return r; }
function poisson(l, k) { return (Math.pow(l,k) * Math.exp(-l)) / factorial(k); }

// ── DIXON-COLES correctie ─────────────────────────────────────────────────────
function dixonColes(h, a, hxg, axg, rho=-0.13) {
  if (h===0&&a===0) return 1 - hxg*axg*rho;
  if (h===0&&a===1) return 1 + hxg*rho;
  if (h===1&&a===0) return 1 + axg*rho;
  if (h===1&&a===1) return 1 - rho;
  return 1;
}

// ── BLESSURES OPHALEN (verbetering 1) ────────────────────────────────────────
async function fetchInjuries(teamId) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/players`);
  if (!json?.players) return { injuredCount: 0, injuredRating: 0, keyPlayersMissing: [] };
  const injured = json.players.filter(p =>
    p.player?.injured === true || p.status === 'injured' || p.status === 'doubtful'
  );
  // Bereken gewogen impact: hogere rating = groter verlies
  let injuredRating = 0;
  const keyMissing = [];
  for (const p of injured) {
    const rating = p.player?.rating || 6.0;
    injuredRating += Math.max(0, rating - 6.0);
    if (rating >= 7.5) keyMissing.push(p.player?.name || '?');
  }
  return {
    injuredCount: injured.length,
    injuredRating: parseFloat(injuredRating.toFixed(2)),
    keyPlayersMissing: keyMissing.slice(0, 3),
  };
}

// ── SEIZOENSSTATISTIEKEN ──────────────────────────────────────────────────────
async function fetchTeamSeasonStats(teamId, tId, seasonId) {
  if (!tId || !seasonId) return null;
  const json = await safeFetch(`${SOFA}/team/${teamId}/unique-tournament/${tId}/season/${seasonId}/statistics/overall`);
  if (!json?.statistics) return null;
  const s = json.statistics;
  return {
    avgShotsOn:    s.averageShotsOnTarget || null,
    avgShots:      s.averageShots || null,
    avgPossession: s.averageBallPossession || null,
    avgCorners:    s.averageCorners || null,
    cleanSheets:   s.cleanSheets || null,
    games:         s.matches || null,
  };
}

// ── TEAMVORM ──────────────────────────────────────────────────────────────────
async function fetchTeamForm(teamId, n=10) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/events/last/0`);
  if (!json?.events) return { form:'', avgScored:1.35, avgConceded:1.35, bttsRate:0.5, gamesPlayed:0 };
  const finished = json.events.filter(e => e.status?.type==='finished').slice(-n);
  if (!finished.length) return { form:'', avgScored:1.35, avgConceded:1.35, bttsRate:0.5, gamesPlayed:0 };
  let form='', totalScored=0, totalConceded=0, btts=0;
  let weightedScored=0, weightedConceded=0, totalWeight=0;
  for (let i=0; i<finished.length; i++) {
    const e = finished[i];
    const isHome   = String(e.homeTeam?.id) === String(teamId);
    const scored   = isHome ? e.homeScore?.current : e.awayScore?.current;
    const conceded = isHome ? e.awayScore?.current : e.homeScore?.current;
    if (scored==null||conceded==null) continue;
    const weight = Math.pow(0.85, finished.length-1-i);
    totalScored+=scored; totalConceded+=conceded;
    weightedScored+=scored*weight; weightedConceded+=conceded*weight; totalWeight+=weight;
    if (scored>0&&conceded>0) btts++;
    form += scored>conceded?'W':scored===conceded?'D':'L';
  }
  const n2 = finished.length;
  return {
    form: form.slice(-5),
    avgScored:   totalWeight>0 ? weightedScored/totalWeight   : totalScored/n2,
    avgConceded: totalWeight>0 ? weightedConceded/totalWeight : totalConceded/n2,
    bttsRate: btts/n2, gamesPlayed: n2,
    wins:   (form.match(/W/g)||[]).length,
    draws:  (form.match(/D/g)||[]).length,
    losses: (form.match(/L/g)||[]).length,
  };
}


// ── DOELPUNTEN TIMING per kwartaal ────────────────────────────────────────────
async function fetchGoalTiming(teamId) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/events/last/0`);
  if (!json?.events) return null;
  const finished = json.events.filter(e => e.status?.type === 'finished').slice(-20);
  if (finished.length < 3) return null;

  const scored   = { q1:0, q2:0, q3:0, q4:0 };
  const conceded = { q1:0, q2:0, q3:0, q4:0 };
  let totalScored=0, totalConceded=0;

  for (const e of finished) {
    const isHome = String(e.homeTeam?.id) === String(teamId);
    for (const inc of (e.incidents||[])) {
      if (!['goal','Goal'].includes(inc.incidentType)) continue;
      if (inc.incidentClass === 'ownGoal') continue;
      const min = inc.time || inc.minute || 0;
      const byTeam = isHome ? inc.isHome !== false : inc.isHome === false;
      const q = min <= 22 ? 'q1' : min <= 45 ? 'q2' : min <= 67 ? 'q3' : 'q4';
      if (byTeam) { scored[q]++;   totalScored++;   }
      else        { conceded[q]++; totalConceded++; }
    }
  }
  if (totalScored === 0 && totalConceded === 0) return null;
  const pct = (n, t) => t > 0 ? Math.round((n/t)*100) : 0;
  return {
    scored: {
      ...scored, total: totalScored,
      q1pct:pct(scored.q1,totalScored), q2pct:pct(scored.q2,totalScored),
      q3pct:pct(scored.q3,totalScored), q4pct:pct(scored.q4,totalScored),
      peak: Object.entries(scored).filter(([k])=>k.length===2).sort((a,b)=>b[1]-a[1])[0]?.[0]||'q3',
    },
    conceded: {
      ...conceded, total: totalConceded,
      q1pct:pct(conceded.q1,totalConceded), q2pct:pct(conceded.q2,totalConceded),
      q3pct:pct(conceded.q3,totalConceded), q4pct:pct(conceded.q4,totalConceded),
      peak: Object.entries(conceded).filter(([k])=>k.length===2).sort((a,b)=>b[1]-a[1])[0]?.[0]||'q3',
    },
    games: finished.length,
  };
}

// ── H2H ───────────────────────────────────────────────────────────────────────
async function fetchH2H(eventId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/h2h`);
  if (!json?.events?.length) return null;
  const last10 = json.events.filter(e=>e.status?.type==='finished').slice(-10);
  let homeWins=0, draws=0, awayWins=0;
  const results = [];
  for (const e of last10) {
    const hg=e.homeScore?.current, ag=e.awayScore?.current;
    if (hg==null||ag==null) continue;
    if (hg>ag) homeWins++; else if (hg===ag) draws++; else awayWins++;
    results.push({
      home:e.homeTeam?.name, away:e.awayTeam?.name,
      score:`${hg}-${ag}`,
      date: e.startTimestamp ? new Date(e.startTimestamp*1000).toISOString().split('T')[0] : null
    });
  }
  return { played:results.length, homeWins, draws, awayWins, results };
}

// ── STAND OPHALEN ─────────────────────────────────────────────────────────────
async function fetchStandings(tId, seasonId) {
  if (!tId||!seasonId) return null;
  const json = await safeFetch(`${SOFA}/unique-tournament/${tId}/season/${seasonId}/standings/total`);
  if (!json?.standings?.[0]?.rows) return null;
  return json.standings[0].rows.map(r => ({
    pos:r.position, team:r.team?.name, teamId:String(r.team?.id||''),
    p:r.matches, w:r.wins, d:r.draws, l:r.losses,
    gf:r.scoresFor, ga:r.scoresAgainst, pts:r.points
  }));
}

// ── LIVE STATISTIEKEN (verbetering 4) ─────────────────────────────────────────
async function fetchLiveStats(eventId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/statistics`);
  if (!json?.statistics) return null;
  const stats = {};
  for (const group of json.statistics) {
    for (const item of (group.groups||[])) {
      for (const stat of (item.statisticsItems||[])) {
        const key = stat.name?.toLowerCase().replace(/\s+/g,'_');
        if (!key) continue;
        stats[key] = { home: stat.home, away: stat.away };
      }
    }
  }
  return {
    shots_on_target: stats.shots_on_target || stats.on_target || null,
    shots_total:     stats.shots_total || stats.total_shots || null,
    possession:      stats.ball_possession || null,
    corners:         stats.corner_kicks || null,
    xg:              stats.expected_goals || null,
  };
}

// ── WEDSTRIJDBELANG berekenen (verbetering 3) ─────────────────────────────────
// Hoe dichter bij kampioenschap/degradatie, hoe groter het belang
function calcMatchImportance(homePos, awayPos, totalTeams) {
  if (!homePos || !awayPos || !totalTeams) return 1.0;
  const degradationZone  = totalTeams - 2; // laatste 3
  const titleZone        = 3;
  const europaZone       = 6;
  const homePressure = (homePos <= titleZone || homePos >= degradationZone) ? 1.15
                     : (homePos <= europaZone) ? 1.05 : 1.0;
  const awayPressure = (awayPos <= titleZone || awayPos >= degradationZone) ? 1.15
                     : (awayPos <= europaZone) ? 1.05 : 1.0;
  return Math.max(homePressure, awayPressure);
}

// ── BAYESIAANS ELO UPDATE (verbetering 2) ────────────────────────────────────
// Klassiek Elo maar met dynamische K-factor op basis van onzekerheid
function bayesianEloUpdate(home, away, score, gamesPlayedHome, gamesPlayedAway) {
  if (!score?.includes("-")) return;
  const [h, a] = score.split("-").map(Number);
  if (isNaN(h)||isNaN(a)) return;
  // K-factor: hogere K bij weinig wedstrijden (meer onzekerheid)
  const kHome = gamesPlayedHome < 5 ? 32 : gamesPlayedHome < 15 ? 24 : 18;
  const kAway = gamesPlayedAway < 5 ? 32 : gamesPlayedAway < 15 ? 24 : 18;
  const expHome = 1/(1+Math.pow(10,(away.elo-home.elo)/400));
  const actHome = h>a ? 1 : h===a ? 0.5 : 0;
  home.elo = clamp(home.elo + kHome*(actHome-expHome), 900, 2300);
  away.elo = clamp(away.elo + kAway*((1-actHome)-(1-expHome)), 900, 2300);
}

// ── BLESSURE FACTOR berekenen ──────────────────────────────────────────────────
// Blessures verminderen aanvals/verdedigingskracht
function calcInjuryFactor(injuryData) {
  if (!injuryData) return { attackFactor: 1.0, defenseFactor: 1.0 };
  const impact = Math.min(0.20, injuryData.injuredRating * 0.04);
  const keyImpact = injuryData.keyPlayersMissing.length * 0.03;
  const totalImpact = Math.min(0.25, impact + keyImpact);
  return {
    attackFactor:  parseFloat((1.0 - totalImpact).toFixed(3)),
    defenseFactor: parseFloat((1.0 + totalImpact * 0.5).toFixed(3)),
  };
}

// ── HOOFD VOORSPELLINGSMODEL ──────────────────────────────────────────────────
function dixonColesPredict(homeStats, awayStats, homeSeasonStats, awaySeasonStats,
                            homeElo, awayElo, h2h,
                            homeInjury, awayInjury,
                            homePos, awayPos, totalTeams) {
  const homeAdv  = 1.1;
  const avgLeague = 1.35;

  // Basisaanvals/verdedigingskracht
  let homeAtk = clamp(homeStats.avgScored   / avgLeague, 0.35, 3.2);
  let homeDef = clamp(homeStats.avgConceded / avgLeague, 0.35, 3.2);
  let awayAtk = clamp(awayStats.avgScored   / avgLeague, 0.35, 3.2);
  let awayDef = clamp(awayStats.avgConceded / avgLeague, 0.35, 3.2);

  // Seizoensstatistieken meewegen (schoten als extra signaal)
  if (homeSeasonStats?.avgShotsOn && awaySeasonStats?.avgShotsOn) {
    const avg = (homeSeasonStats.avgShotsOn + awaySeasonStats.avgShotsOn) / 2;
    if (avg > 0) {
      homeAtk = homeAtk*0.7 + (homeSeasonStats.avgShotsOn/avg)*0.3;
      awayAtk = awayAtk*0.7 + (awaySeasonStats.avgShotsOn/avg)*0.3;
    }
  }

  // Verbetering 1: Blessure correctie
  const homeInj = calcInjuryFactor(homeInjury);
  const awayInj = calcInjuryFactor(awayInjury);
  homeAtk *= homeInj.attackFactor;
  homeDef *= homeInj.defenseFactor;
  awayAtk *= awayInj.attackFactor;
  awayDef *= awayInj.defenseFactor;

  // Elo correctie
  const eloFactor = clamp(Math.pow(10, (homeElo-awayElo)/1200), 0.8, 1.25);
  let hxg = clamp(avgLeague * homeAtk / awayDef * homeAdv * Math.sqrt(eloFactor), 0.15, 5.5);
  let axg = clamp(avgLeague * awayAtk / homeDef / Math.sqrt(eloFactor), 0.15, 5.5);

  // Verbetering 3: Wedstrijdbelang correctie
  const importance = calcMatchImportance(homePos, awayPos, totalTeams);
  hxg *= (importance > 1.0 ? (1 + (importance-1)*0.5) : 1.0);
  axg *= (importance > 1.0 ? (1 + (importance-1)*0.5) : 1.0);

  // Doelpunten timing correctie (kwartaalanalyse)
  const homeT = homeStats?.goalTiming;
  const awayT  = awayStats?.goalTiming;
  if (homeT || awayT) {
    if (homeT?.scored?.q4pct > 35) hxg = clamp(hxg * 1.03, 0.15, 5.5);
    if (homeT?.scored?.q1pct > 35) hxg = clamp(hxg * 1.02, 0.15, 5.5);
    if (awayT?.scored?.q1pct > 35) axg = clamp(axg * 1.04, 0.15, 5.5);
    if (homeT?.conceded?.q3pct > 35) axg = clamp(axg * 1.03, 0.15, 5.5);
  }

  // H2H correctie
  if (h2h?.played >= 4) {
    const h2hBoost = (h2h.homeWins/h2h.played - 0.4) * 0.08;
    hxg = clamp(hxg*(1+h2hBoost), 0.15, 5.5);
    axg = clamp(axg*(1-h2hBoost), 0.15, 5.5);
  }

  // Dixon-Coles scorematrix
  let hp=0, dp=0, ap=0, bestScore='1-1', bestP=0;
  const scoreMatrix = {};
  let over05=0, over15=0, over25=0, over35=0, btts=0;
  for (let h=0; h<=7; h++) {
    for (let a=0; a<=7; a++) {
      const rawP = poisson(hxg,h)*poisson(axg,a);
      const dcMod = dixonColes(h,a,hxg,axg);
      const p = rawP*dcMod;
      if (h>a) hp+=p; else if (a>h) ap+=p; else dp+=p;
      if (p>bestP) { bestP=p; bestScore=`${h}-${a}`; }
      const tot=h+a;
      if (tot>0.5) over05+=p;
      if (tot>1.5) over15+=p;
      if (tot>2.5) over25+=p;
      if (tot>3.5) over35+=p;
      if (h>0&&a>0) btts+=p;
      if (p>0.008) scoreMatrix[`${h}-${a}`]=parseFloat(p.toFixed(4));
    }
  }
  const tot=hp+dp+ap;
  hp/=tot; dp/=tot; ap/=tot;
  const eloDiff  = Math.abs(homeElo-awayElo);
  const eloBoost = Math.min(0.12, eloDiff/1200);
  const h2hBoost = h2h?.played>=6 ? 0.03 : 0;
  // Verbetering 2: Bayesiaans confidence (lagere confidence bij weinig data)
  const dataConfidence = Math.min(1.0,
    (homeStats.gamesPlayed||0)/10 * 0.5 + (awayStats.gamesPlayed||0)/10 * 0.5
  );
  const confidence = Math.min(0.93, bestP*3.5*dataConfidence + eloBoost + h2hBoost);
  const [predH, predA] = bestScore.split('-').map(Number);
  const sortedMatrix = Object.fromEntries(
    Object.entries(scoreMatrix).sort((a,b)=>b[1]-a[1]).slice(0,8)
  );
  return {
    homeProb:parseFloat(hp.toFixed(4)), drawProb:parseFloat(dp.toFixed(4)), awayProb:parseFloat(ap.toFixed(4)),
    homeXG:parseFloat(hxg.toFixed(2)), awayXG:parseFloat(axg.toFixed(2)),
    predHomeGoals:predH, predAwayGoals:predA,
    exactProb:parseFloat(bestP.toFixed(4)), confidence:parseFloat(confidence.toFixed(3)),
    over05:parseFloat(over05.toFixed(3)), over15:parseFloat(over15.toFixed(3)),
    over25:parseFloat(over25.toFixed(3)), over35:parseFloat(over35.toFixed(3)),
    btts:parseFloat(btts.toFixed(3)), scoreMatrix:sortedMatrix,
    matchImportance: parseFloat(importance.toFixed(2)),
  };
}

function getTeam(teams, id, name) {
  const key = id ? `id:${id}` : `name:${name.toLowerCase()}`;
  if (!teams[key]) teams[key]={ id:id||'', name, elo:1500 };
  teams[key].name=name;
  if (id) teams[key].id=id;
  return teams[key];
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("[worker] start v6:", new Date().toISOString());
  let store = {
    teams:{}, predictions:{}, matches:{}, standings:{},
    teamStats:{}, teamSeasonStats:{}, teamInjuries:{},
    teamStatsUpdated:{}, teamSeasonStatsUpdated:{}, teamInjuriesUpdated:{},
    lastRun:null
  };
  if (fs.existsSync(DATA_FILE)) {
    try { store = JSON.parse(fs.readFileSync(DATA_FILE,'utf-8')); } catch {}
  }
  ['matches','standings','teamStats','teamSeasonStats','teamInjuries',
   'teamStatsUpdated','teamSeasonStatsUpdated','teamInjuriesUpdated'].forEach(k=>{
    if (!store[k]) store[k]={};
  });

  const today     = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now()-86400000).toISOString().split('T')[0];
  const tomorrow  = new Date(Date.now()+86400000).toISOString().split('T')[0];
  const now       = Date.now();
  const SIX_HOURS    = 6*3600*1000;
  const TWELVE_HOURS = 12*3600*1000;
  const FOUR_HOURS   = 4*3600*1000;

  // ── Stap 1: wedstrijden ophalen ──────────────────────────────────────────
  const allEventsByDate = {};
  const teamIdsNeeded   = new Set();
  const tournamentsMap  = new Map();
  for (const date of [yesterday, today, tomorrow]) {
    const json = await safeFetch(`${SOFA}/sport/football/scheduled-events/${date}`);
    if (!json?.events) continue;
    const filtered = json.events.filter(e=>getAllowedLeague(e));
    allEventsByDate[date] = filtered;
    for (const e of filtered) {
      if (e.homeTeam?.id) teamIdsNeeded.add(String(e.homeTeam.id));
      if (e.awayTeam?.id)  teamIdsNeeded.add(String(e.awayTeam.id));
      const tId = e.uniqueTournament?.id || e.tournament?.uniqueTournament?.id;
      const sId = e.season?.id;
      if (tId && sId) {
        const li = getAllowedLeague(e);
        if (li) tournamentsMap.set(`${tId}_${sId}`, { tId, sId, label:li.label });
      }
    }
    await sleep(300);
  }
  console.log(`[worker] ${teamIdsNeeded.size} teams, ${tournamentsMap.size} competities`);

  // ── Stap 2: teamvorm ─────────────────────────────────────────────────────
  let formUpdated=0;
  for (const teamId of teamIdsNeeded) {
    if (now-(store.teamStatsUpdated[teamId]||0) < SIX_HOURS) continue;
    const stats = await fetchTeamForm(teamId,10);
    store.teamStats[teamId]=stats;
    // Doelpunten timing ophalen (kwartaalanalyse)
    const timing = await fetchGoalTiming(teamId);
    if (timing) store.teamStats[teamId].goalTiming = timing;
    store.teamStatsUpdated[teamId]=now;
    formUpdated++;
    await sleep(200);
  }
  console.log(`[worker] ${formUpdated} teamvormen bijgewerkt`);

  // ── Stap 3: seizoensstatistieken ─────────────────────────────────────────
  const teamTournamentMap = new Map();
  for (const [, info] of tournamentsMap) {
    for (const date of [today, tomorrow]) {
      for (const e of (allEventsByDate[date]||[])) {
        if (e.homeTeam?.id) teamTournamentMap.set(String(e.homeTeam.id), info);
        if (e.awayTeam?.id)  teamTournamentMap.set(String(e.awayTeam.id), info);
      }
    }
  }
  let seasonUpdated=0;
  for (const teamId of teamIdsNeeded) {
    if (now-(store.teamSeasonStatsUpdated[teamId]||0) < TWELVE_HOURS) continue;
    const ti = teamTournamentMap.get(teamId);
    if (!ti) continue;
    const stats = await fetchTeamSeasonStats(teamId,ti.tId,ti.sId);
    if (stats) { store.teamSeasonStats[teamId]=stats; store.teamSeasonStatsUpdated[teamId]=now; seasonUpdated++; }
    await sleep(180);
  }
  console.log(`[worker] ${seasonUpdated} seizoensstatistieken bijgewerkt`);

  // ── Stap 4: BLESSURES ophalen (verbetering 1) ─────────────────────────────
  // Alleen vandaag/morgen teams ophalen om rate limiting te voorkomen
  const todayTomorrowTeams = new Set();
  for (const date of [today, tomorrow]) {
    for (const e of (allEventsByDate[date]||[])) {
      if (e.homeTeam?.id) todayTomorrowTeams.add(String(e.homeTeam.id));
      if (e.awayTeam?.id)  todayTomorrowTeams.add(String(e.awayTeam.id));
    }
  }
  let injuriesUpdated=0;
  for (const teamId of todayTomorrowTeams) {
    if (now-(store.teamInjuriesUpdated[teamId]||0) < FOUR_HOURS) continue;
    const injuries = await fetchInjuries(teamId);
    store.teamInjuries[teamId]=injuries;
    store.teamInjuriesUpdated[teamId]=now;
    injuriesUpdated++;
    await sleep(200);
  }
  console.log(`[worker] ${injuriesUpdated} blessuredossiers bijgewerkt`);

  // ── Stap 5: standen + standings lookup ───────────────────────────────────
  let standingsUpdated=0;
  const standingsLookup = {}; // tId_sId → { teamId: pos }
  for (const [key, {tId,sId,label}] of tournamentsMap) {
    if (store.standings[key] && now-(store.standings[key].updated||0) < SIX_HOURS) {
      if (store.standings[key].rows) {
        standingsLookup[key] = {};
        for (const row of store.standings[key].rows) standingsLookup[key][row.teamId]=row.pos;
      }
      continue;
    }
    const rows = await fetchStandings(tId,sId);
    if (rows) {
      store.standings[key]={ label, rows, updated:now };
      standingsLookup[key]={};
      for (const row of rows) standingsLookup[key][row.teamId]=row.pos;
      standingsUpdated++;
    }
    await sleep(200);
  }
  console.log(`[worker] ${standingsUpdated} standen bijgewerkt`);

  // ── Stap 6: wedstrijden verwerken + voorspellingen ───────────────────────
  for (const date of [yesterday, today, tomorrow]) {
    const events = allEventsByDate[date] || [];
    const dayMatches=[], dayPreds=[];
    for (const e of events) {
      const li = getAllowedLeague(e);
      if (!li) continue;
      const homeName = e.homeTeam?.name||'Home';
      const awayName = e.awayTeam?.name||'Away';
      const homeId   = e.homeTeam?.id ? String(e.homeTeam.id):'';
      const awayId   = e.awayTeam?.id  ? String(e.awayTeam.id):'';
      const homeTeam = getTeam(store.teams, homeId, homeName);
      const awayTeam = getTeam(store.teams, awayId, awayName);

      const statusType = e.status?.type||'notstarted';
      const hg=e.homeScore?.current, ag=e.awayScore?.current;
      const score=(hg!=null&&ag!=null)?`${hg}-${ag}`:null;
      const homeFormData = store.teamStats[homeId]||{gamesPlayed:0};
      const awayFormData = store.teamStats[awayId]||{gamesPlayed:0};
      if (statusType==='finished'&&score) {
        // Verbetering 2: Bayesiaans Elo update
        bayesianEloUpdate(homeTeam, awayTeam, score,
          homeFormData.gamesPlayed||5, awayFormData.gamesPlayed||5);
      }

      // Standings positie opzoeken
      const tId  = e.uniqueTournament?.id || e.tournament?.uniqueTournament?.id;
      const sId  = e.season?.id;
      const standKey  = `${tId}_${sId}`;
      const sMap      = standingsLookup[standKey] || {};
      const homePos   = homeId ? sMap[homeId] : null;
      const awayPos   = awayId ? sMap[awayId]  : null;
      const totalTeams = store.standings[standKey]?.rows?.length || 20;

      const pred = dixonColesPredict(
        homeFormData, awayFormData,
        store.teamSeasonStats[homeId]||null,
        store.teamSeasonStats[awayId]||null,
        homeTeam.elo, awayTeam.elo,
        null, // h2h komt later
        store.teamInjuries[homeId]||null,
        store.teamInjuries[awayId]||null,
        homePos, awayPos, totalTeams
      );

      const matchId = `ss-${e.id}`;
      dayMatches.push({
        id:matchId, sofaId:e.id, date,
        kickoff: e.startTimestamp ? new Date(e.startTimestamp*1000).toISOString() : null,
        league:li.label,
        homeTeamName:homeName, awayTeamName:awayName,
        homeTeamId:homeId, awayTeamId:awayId,
        // Logo URL — direct van SofaScore CDN
        homeLogo: homeId ? `https://api.sofascore.app/api/v1/team/${homeId}/image` : '',
        awayLogo: awayId  ? `https://api.sofascore.app/api/v1/team/${awayId}/image`  : '',
        status: statusType==='finished'?'FT':statusType==='inprogress'?'LIVE':'NS',
        score,
        minute: e.time?.current ? `${e.time.current}'` : null,
        extraTime: e.time?.extra || null,
        period: e.status?.description || null,
        homeForm:homeFormData.form||'', awayForm:awayFormData.form||'',
        homeElo:Math.round(homeTeam.elo), awayElo:Math.round(awayTeam.elo),
        homePos, awayPos,
        matchImportance:pred.matchImportance,
        homeInjuries:   store.teamInjuries[homeId]||null,
        awayInjuries:   store.teamInjuries[awayId]||null,
        homeGoalTiming: store.teamStats[homeId]?.goalTiming || null,
        awayGoalTiming: store.teamStats[awayId]?.goalTiming  || null,
        homeSeasonStats: store.teamSeasonStats[homeId]||null,
        awaySeasonStats: store.teamSeasonStats[awayId]||null,
      });
      dayPreds.push({
        matchId, homeTeam:homeName, awayTeam:awayName,
        league:li.label, ...pred,
        homeForm:homeFormData.form||'', awayForm:awayFormData.form||'',
        homeElo:Math.round(homeTeam.elo), awayElo:Math.round(awayTeam.elo),
      });
    }
    store.matches[date]=dayMatches;
    store.predictions[date]=dayPreds;
    console.log(`[worker] ${date}: ${dayMatches.length} wedstrijden`);
  }

  // ── Stap 7: H2H voor vandaag ─────────────────────────────────────────────
  const todayMatches = store.matches[today]||[];
  let h2hFetched=0;
  for (const m of todayMatches.slice(0,25)) {
    if (m.h2h) continue;
    await sleep(250);
    const h2h = await fetchH2H(m.sofaId);
    if (!h2h) continue;
    m.h2h=h2h; h2hFetched++;
    const predIdx = store.predictions[today]?.findIndex(p=>p.matchId===m.id);
    if (predIdx>=0) {
      const p = store.predictions[today][predIdx];
      const homeFormData = store.teamStats[m.homeTeamId]||{gamesPlayed:0};
      const awayFormData = store.teamStats[m.awayTeamId]||{gamesPlayed:0};
      const tId = m.sofaId ? null : null;
      const newPred = dixonColesPredict(
        homeFormData, awayFormData,
        store.teamSeasonStats[m.homeTeamId]||null,
        store.teamSeasonStats[m.awayTeamId]||null,
        m.homeElo||1500, m.awayElo||1500,
        h2h,
        store.teamInjuries[m.homeTeamId]||null,
        store.teamInjuries[m.awayTeamId]||null,
        m.homePos, m.awayPos, 20
      );
      store.predictions[today][predIdx]={ ...p, ...newPred };
    }
  }
  console.log(`[worker] ${h2hFetched} H2H opgehaald`);

  // ── Stap 8: Live scores mergen + live statistieken (verbetering 4) ───────
  const liveJson = await safeFetch(`${SOFA}/sport/football/events/live`);
  if (liveJson?.events) {
    if (!store.matches[today]) store.matches[today]=[];
    let merged=0;
    for (const live of liveJson.events) {
      const li = getAllowedLeague(live);
      if (!li) continue;
      const matchId=`ss-${live.id}`;
      const idx=store.matches[today].findIndex(m=>m.id===matchId);
      const hg=live.homeScore?.current, ag=live.awayScore?.current;
      // Bepaal nauwkeurige minuutweergave inclusief extra tijd en periode
      const liveMin = live.time?.current || 0;
      const liveExtra = live.time?.extra || 0;
      const livePeriod = live.status?.description || '';
      let minuteDisplay = null;
      if (liveMin > 0) {
        if (liveExtra > 0) {
          minuteDisplay = `${liveMin}+${liveExtra}'`;
        } else if (livePeriod.toLowerCase().includes('half')) {
          minuteDisplay = `HT`;
        } else {
          minuteDisplay = `${liveMin}'`;
        }
      }
      const liveData={
        status:'LIVE',
        score:(hg!=null&&ag!=null)?`${hg}-${ag}`:null,
        minute: minuteDisplay,
        period: livePeriod,
        extraTime: liveExtra || null,
      };
      if (idx>=0) {
        Object.assign(store.matches[today][idx], liveData);
        // Verbetering 4: live statistieken ophalen
        if (live.id && !store.matches[today][idx].liveStats) {
          const lStats = await fetchLiveStats(live.id);
          if (lStats) store.matches[today][idx].liveStats=lStats;
          await sleep(150);
        }
      } else {
        const homeId=live.homeTeam?.id?String(live.homeTeam.id):'';
        const awayId=live.awayTeam?.id?String(live.awayTeam.id):'';
        store.matches[today].push({
          id:matchId, sofaId:live.id, date:today,
          kickoff:live.startTimestamp?new Date(live.startTimestamp*1000).toISOString():null,
          league:li.label,
          homeTeamName:live.homeTeam?.name||'Home',
          awayTeamName:live.awayTeam?.name||'Away',
          homeTeamId:homeId, awayTeamId:awayId,
          homeLogo:homeId?`https://api.sofascore.app/api/v1/team/${homeId}/image`:'',
          awayLogo:awayId?`https://api.sofascore.app/api/v1/team/${awayId}/image`:'',
          ...liveData
        });
      }
      merged++;
    }
    console.log(`[worker] ${merged} live wedstrijden gemerged`);
  }

  // ── Opslaan ──────────────────────────────────────────────────────────────
  store.lastRun = Date.now();
  store.workerVersion = 'v6';
  const cutoff = new Date(Date.now()-7*86400000).toISOString().split('T')[0];
  for (const d of Object.keys(store.matches))     if(d<cutoff) delete store.matches[d];
  for (const d of Object.keys(store.predictions)) if(d<cutoff) delete store.predictions[d];

  fs.writeFileSync(DATA_FILE, JSON.stringify(store,null,2));
  const totalToday = store.matches[today]?.length||0;
  console.log(`[worker] klaar! ${totalToday} wedstrijden vandaag, ${Object.keys(store.teams).length} teams totaal`);
}

main();
