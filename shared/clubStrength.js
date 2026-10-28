// Clubsterkte met tijdsverval (Dixon-Coles-lite).
//
// Doel: de opgeslagen wedstrijden per club omzetten in aanvals- en
// verdedigingssterktes, zodat een nieuwe voorspelling niet alleen naar de laatste
// uitslagen kijkt maar naar de onderliggende kracht. Dat is de "rode draad" per
// club: een ploeg die veel scoort maar ook veel weggeeft krijgt een hoge aanval
// en een zwakke verdediging, in plaats van een enkele hitrate.
//
// Model:
//   verwachte thuisgoals = basis * aanval(thuis) * verdediging(uit) * thuisvoordeel
//   verwachte uitgoals   = basis * aanval(uit) * verdediging(thuis)
// met een exponentiele halveringstijd op de historie (recente duels tellen
// zwaarder), shrinkage naar het competitiegemiddelde bij weinig duels, en
// normalisatie zodat gemiddelde aanval en verdediging 1 zijn.
//
// De kansen komen uit een Poisson-matrix met de Dixon-Coles-correctie voor de
// lage uitslagen (0-0, 1-0, 0-1, 1-1), die anders structureel onderschat
// worden. Alles is puur en werkt op records uit shared/matchStore.js.

import { canonicalDedupeTeam } from "./matchNormalization.js";

const DAY_MS = 86400000;
const DEFAULT_HALF_LIFE_DAYS = 120;
const MAX_GOALS = 10;

function key(value) {
  return canonicalDedupeTeam(value) || String(value || "").trim().toLowerCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Kansverdeling van een duel uit twee verwachte doelpuntentalen.
export function poissonPmf(goals, lambda) {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  let logFactorial = 0;
  for (let step = 2; step <= goals; step += 1) logFactorial += Math.log(step);
  return Math.exp(-lambda + goals * Math.log(lambda) - logFactorial);
}

// Dixon-Coles-correctie voor de laagste uitslagen. rho < 0 trekt 1-1 iets omhoog
// en 1-0/0-1 iets omlaag, wat het standaard Poisson-model structureel mist.
export function dixonColesTau(homeGoals, awayGoals, homeXG, awayXG, rho = -0.06) {
  if (homeGoals === 0 && awayGoals === 0) return 1 - homeXG * awayXG * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + homeXG * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + awayXG * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

export function scoreMatrix(homeXG, awayXG, options = {}) {
  const rho = Number.isFinite(Number(options.rho)) ? Number(options.rho) : -0.06;
  const maxGoals = Math.max(4, Number(options.maxGoals || MAX_GOALS));
  let total = 0;
  let homeProb = 0;
  let drawProb = 0;
  let awayProb = 0;
  let btts = 0;
  let over25 = 0;
  const matrix = [];
  for (let home = 0; home <= maxGoals; home += 1) {
    const row = [];
    for (let away = 0; away <= maxGoals; away += 1) {
      const probability = poissonPmf(home, homeXG)
        * poissonPmf(away, awayXG)
        * dixonColesTau(home, away, homeXG, awayXG, rho);
      row.push(probability);
      total += probability;
    }
    matrix.push(row);
  }
  if (!(total > 0)) return null;
  let best = { homeGoals: 0, awayGoals: 0, probability: -1 };
  for (let home = 0; home <= maxGoals; home += 1) {
    for (let away = 0; away <= maxGoals; away += 1) {
      const probability = matrix[home][away] / total;
      if (probability > best.probability) best = { homeGoals: home, awayGoals: away, probability };
      if (home > away) homeProb += probability;
      else if (home === away) drawProb += probability;
      else awayProb += probability;
      if (home > 0 && away > 0) btts += probability;
      if (home + away > 2.5) over25 += probability;
    }
  }
  return {
    probabilities: {
      homeProb: Math.round(homeProb * 10000) / 10000,
      drawProb: Math.round(drawProb * 10000) / 10000,
      awayProb: Math.round(awayProb * 10000) / 10000,
    },
    btts: Math.round(btts * 10000) / 10000,
    over25: Math.round(over25 * 10000) / 10000,
    mostLikelyScore: `${best.homeGoals}-${best.awayGoals}`,
    rho,
  };
}

// records: [{ d, h, a, hs, as, lg }]
export function buildStrengthModel(records = [], options = {}) {
  const halfLifeDays = Math.max(1, Number(options.halfLifeDays || DEFAULT_HALF_LIFE_DAYS));
  const iterations = Math.max(1, Number(options.iterations || 40));
  const priorMatches = Math.max(0, Number(options.priorMatches ?? 4));
  const minMatches = Math.max(1, Number(options.minMatches || 3));

  const finished = [];
  for (const record of records || []) {
    if (!record) continue;
    const date = String(record.d || "").slice(0, 10);
    if (!date || !record.h || !record.a) continue;
    if (!Number.isFinite(Number(record.hs)) || !Number.isFinite(Number(record.as))) continue;
    finished.push({
      date,
      home: record.h,
      away: record.a,
      homeKey: key(record.h),
      awayKey: key(record.a),
      homeGoals: Number(record.hs),
      awayGoals: Number(record.as),
      league: record.lg || null,
    });
  }
  finished.sort((left, right) => left.date.localeCompare(right.date));
  if (options.asOf) {
    const cutoff = String(options.asOf).slice(0, 10);
    for (let position = finished.length - 1; position >= 0; position -= 1) {
      if (finished[position].date >= cutoff) finished.splice(position, 1);
    }
  }
  if (!finished.length) {
    return {
      asOf: options.asOf ? String(options.asOf).slice(0, 10) : null,
      matches: 0,
      baseGoals: null,
      homeAdvantage: null,
      halfLifeDays,
      teams: {},
    };
  }
  const asOf = String(options.asOf || finished[finished.length - 1].date).slice(0, 10);
  const reference = Date.parse(`${asOf}T00:00:00Z`);

  let weightSum = 0;
  let homeGoals = 0;
  let awayGoals = 0;
  for (const match of finished) {
    const age = (reference - Date.parse(`${match.date}T00:00:00Z`)) / DAY_MS;
    match.weight = Math.pow(0.5, Math.max(0, age) / halfLifeDays);
    weightSum += match.weight;
    homeGoals += match.weight * match.homeGoals;
    awayGoals += match.weight * match.awayGoals;
  }
  const baseGoals = (homeGoals + awayGoals) / (2 * weightSum);
  const rawHomeAdvantage = awayGoals > 0 ? homeGoals / awayGoals : 1.1;
  const homeAdvantage = clamp(
    1 + (rawHomeAdvantage - 1) * (weightSum / (weightSum + priorMatches * 2)),
    1,
    1.6,
  );

  const state = new Map();
  const ensure = (teamKey) => {
    if (!state.has(teamKey)) {
      state.set(teamKey, {
        attack: 1,
        defence: 1,
        weight: 0,
        matches: 0,
        scored: 0,
        conceded: 0,
        results: [],
      });
    }
    return state.get(teamKey);
  };
  for (const match of finished) {
    const home = ensure(match.homeKey);
    const away = ensure(match.awayKey);
    home.weight += match.weight;
    away.weight += match.weight;
    home.matches += 1;
    away.matches += 1;
    home.scored += match.homeGoals;
    home.conceded += match.awayGoals;
    away.scored += match.awayGoals;
    away.conceded += match.homeGoals;
    home.results.push({ date: match.date, goalsFor: match.homeGoals, goalsAgainst: match.awayGoals });
    away.results.push({ date: match.date, goalsFor: match.awayGoals, goalsAgainst: match.homeGoals });
  }

  // Fixed-point-iteratie: aanval en verdediging schatten elkaar, daarom
  // afwisselen en daarna normaliseren (gemiddelde 1). Teller en noemer zijn
  // beide tijdsgewogen, anders zou een oude wedstrijd even zwaar in de teller
  // als in de noemer staan.
  for (let step = 0; step < iterations; step += 1) {
    const scored = new Map();
    const conceded = new Map();
    const attackDenominator = new Map();
    const defenceDenominator = new Map();
    for (const teamKey of state.keys()) {
      scored.set(teamKey, 0);
      conceded.set(teamKey, 0);
      attackDenominator.set(teamKey, 0);
      defenceDenominator.set(teamKey, 0);
    }
    for (const match of finished) {
      const home = state.get(match.homeKey);
      const away = state.get(match.awayKey);
      const homeVenue = homeAdvantage;
      const awayVenue = 1;
      scored.set(match.homeKey, scored.get(match.homeKey) + match.weight * match.homeGoals);
      scored.set(match.awayKey, scored.get(match.awayKey) + match.weight * match.awayGoals);
      conceded.set(match.homeKey, conceded.get(match.homeKey) + match.weight * match.awayGoals);
      conceded.set(match.awayKey, conceded.get(match.awayKey) + match.weight * match.homeGoals);
      // Noemer: verwachte goals zonder de eigen aanvals- of verdedigingskracht.
      attackDenominator.set(
        match.homeKey,
        attackDenominator.get(match.homeKey) + match.weight * baseGoals * away.defence * homeVenue,
      );
      attackDenominator.set(
        match.awayKey,
        attackDenominator.get(match.awayKey) + match.weight * baseGoals * home.defence * awayVenue,
      );
      defenceDenominator.set(
        match.homeKey,
        defenceDenominator.get(match.homeKey) + match.weight * baseGoals * away.attack * awayVenue,
      );
      defenceDenominator.set(
        match.awayKey,
        defenceDenominator.get(match.awayKey) + match.weight * baseGoals * home.attack * homeVenue,
      );
    }
    const attackValues = [];
    const defenceValues = [];
    for (const [teamKey, team] of state) {
      const attack = attackDenominator.get(teamKey) > 0
        ? scored.get(teamKey) / attackDenominator.get(teamKey)
        : team.attack;
      const defence = defenceDenominator.get(teamKey) > 0
        ? conceded.get(teamKey) / defenceDenominator.get(teamKey)
        : team.defence;
      team.rawAttack = clamp(attack, 0.2, 5);
      team.rawDefence = clamp(defence, 0.2, 5);
      attackValues.push(team.rawAttack);
      defenceValues.push(team.rawDefence);
    }
    const attackMean = attackValues.reduce((sum, value) => sum + value, 0) / attackValues.length || 1;
    const defenceMean = defenceValues.reduce((sum, value) => sum + value, 0) / defenceValues.length || 1;
    for (const team of state.values()) {
      team.attack = team.rawAttack / attackMean;
      team.defence = team.rawDefence / defenceMean;
    }
  }

  const teams = {};
  for (const [teamKey, team] of state) {
    const shrink = team.weight / (team.weight + priorMatches);
    const recent = team.results
      .slice(-5)
      .map((result) => (result.goalsFor > result.goalsAgainst ? "W" : result.goalsFor === result.goalsAgainst ? "D" : "L"))
      .join("");
    teams[teamKey] = {
      attack: Math.round((1 + (team.attack - 1) * shrink) * 1000) / 1000,
      defence: Math.round((1 + (team.defence - 1) * shrink) * 1000) / 1000,
      matches: team.matches,
      goalsFor: team.scored,
      goalsAgainst: team.conceded,
      form: recent,
      enough: team.matches >= minMatches,
    };
  }

  return {
    asOf,
    matches: finished.length,
    baseGoals: Math.round(baseGoals * 1000) / 1000,
    homeAdvantage: Math.round(homeAdvantage * 1000) / 1000,
    halfLifeDays,
    teams,
  };
}

export function expectedGoals(model, homeTeamName, awayTeamName, options = {}) {
  if (!model || !model.baseGoals) return null;
  const home = model.teams?.[key(homeTeamName)] || { attack: 1, defence: 1 };
  const away = model.teams?.[key(awayTeamName)] || { attack: 1, defence: 1 };
  const neutral = options.neutral === true;
  const homeXG = model.baseGoals * home.attack * away.defence * (neutral ? 1 : model.homeAdvantage);
  const awayXG = model.baseGoals * away.attack * home.defence;
  return {
    homeXG: Math.round(clamp(homeXG, 0.05, 6) * 1000) / 1000,
    awayXG: Math.round(clamp(awayXG, 0.05, 6) * 1000) / 1000,
    known: {
      home: Boolean(model.teams?.[key(homeTeamName)]),
      away: Boolean(model.teams?.[key(awayTeamName)]),
    },
  };
}

// Volledige voorspelling uit het sterktenmodel: verwachte goals, 1X2, BTTS en
// over 2.5. Bedoeld als extra component naast het bestaande ensemble, niet als
// vervanging: het model kent geen blessures, opstellingen of odds.
export function predictFromStrength(model, homeTeamName, awayTeamName, options = {}) {
  const goals = expectedGoals(model, homeTeamName, awayTeamName, options);
  if (!goals) return null;
  const matrix = scoreMatrix(goals.homeXG, goals.awayXG, options);
  if (!matrix) return null;
  return {
    homeTeam: homeTeamName,
    awayTeam: awayTeamName,
    homeXG: goals.homeXG,
    awayXG: goals.awayXG,
    ...matrix,
    coverage: goals.known,
  };
}

// Rapportregels: sterkste aanval, zwakste verdediging, vorm.
export function strengthRows(model, options = {}) {
  const minMatches = Math.max(1, Number(options.minMatches || 5));
  const rows = [];
  for (const [teamKey, team] of Object.entries(model?.teams || {})) {
    if (team.matches < minMatches) continue;
    rows.push({
      team: teamKey,
      attack: team.attack,
      defence: team.defence,
      matches: team.matches,
      form: team.form,
      goalsFor: team.goalsFor,
      goalsAgainst: team.goalsAgainst,
    });
  }
  return rows.sort((left, right) => right.attack - left.attack || left.defence - right.defence);
}
