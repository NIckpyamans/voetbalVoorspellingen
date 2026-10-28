// De gepubliceerde compacte wedstrijdopslag (R2: match-store/*.json) als
// historiebron voor de live worker.
//
// De analyses in de repo (clubanalyse, modelrapport, backtest) lezen
// data/match-store.json; datzelfde bestand gaat via scripts/publish-match-store.js
// naar R2. Zonder deze lectura bouwt de worker zijn vorm uit eigen caches en
// providers, waardoor voorspelling en analyse verschillende historie kunnen
// zien. Deze module leest eerst het manifest (klein), weigert objecten die niet
// bij het manifest passen en zet de records om in het dagpayload-formaat van
// buildLocalTeamFormIndex, zodat mergeLocalTeamForm ze ongewijzigd kan
// samenvoegen met provider- en reviewvorm.

import { buildR2ObjectKey, getR2Config, getR2Object } from "../../shared/cloudflare-r2.js";
import { readRemoteMatchStore } from "../../shared/matchStoreRemote.js";
import { canonicalDedupeTeam } from "../../shared/matchNormalization.js";
import { buildLocalTeamFormIndex, mergeLocalTeamForm } from "./local-team-form-history.js";

export const MATCH_STORE_FORM_SOURCE = "match-store-r2";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Zet compacte records (d/lg/h/a/hs/as) om in dagpayloads met afgeronde duels.
// De opslag bevat alleen FT/AET/PEN-records; middernacht als aftrap houdt de
// statuscontrole "afgerond vóór nu" daarmee altijd geldig.
export function dayPayloadsFromMatchStore(store = {}) {
  const days = new Map();
  for (const [id, record] of Object.entries(store?.matches || {})) {
    if (!record || typeof record !== "object") continue;
    const date = String(record.d || "");
    const homeTeamName = String(record.h || "").trim();
    const awayTeamName = String(record.a || "").trim();
    if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) continue;
    if (!homeTeamName || !awayTeamName) continue;
    // expliciete null-check: Number(null) is 0 en zou een ontbrekende stand
    // als 0-0 de vorm in loodsen.
    if (record.hs == null || record.as == null) continue;
    const homeGoals = Number(record.hs);
    const awayGoals = Number(record.as);
    if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) continue;
    if (homeGoals < 0 || awayGoals < 0) continue;
    const match = {
      id,
      date,
      kickoff: `${date}T00:00:00.000Z`,
      league: record.lg || null,
      homeTeamName,
      awayTeamName,
      homeScore: homeGoals,
      awayScore: awayGoals,
      score: `${homeGoals}-${awayGoals}`,
      status: "FT",
      dataSource: MATCH_STORE_FORM_SOURCE,
    };
    if (!days.has(date)) days.set(date, { date, matches: [] });
    days.get(date).matches.push(match);
  }
  return [...days.values()].sort((left, right) => left.date.localeCompare(right.date));
}

// Clubindex uit de opslag: key = canonicalDedupeTeam, zoals elke andere bron.
export function buildMatchStoreFormIndex(store, options = {}) {
  return buildLocalTeamFormIndex(dayPayloadsFromMatchStore(store), options);
}

// Vormprofiel voor één club; null wanneer de club geen afgeronde duels in de
// opslag heeft. Dezelfde vorm als de team-form-cache, zodat de bestaande
// merge-functies (mergeTeamFormWithExternalRecent) het profiel direct kunnen
// verwerken.
export function matchStoreFormProfile(index, teamName, options = {}) {
  if (!index || typeof index.get !== "function" || !teamName) return null;
  const matches = index.get(canonicalDedupeTeam(teamName)) || [];
  if (!matches.length) return null;
  return mergeLocalTeamForm(null, matches, teamName, options);
}

// De reader krijgt relatieve sleutels (match-store/manifest.json) aangeboden;
// R2-objecten staan onder de prefix uit de config, dus die wordt hier toegevoegd.
function prefixedR2Reader({ config, key }) {
  return getR2Object({ config, key: buildR2ObjectKey(config, key) });
}

function emptyResult(reason, extra = {}) {
  return {
    loaded: false,
    matches: 0,
    teams: 0,
    publishedAt: null,
    sourceFingerprint: null,
    reason,
    manifest: null,
    index: null,
    ...extra,
  };
}

// Leest manifest + store + index uit R2 en bouwt de clubindex. Faalt altijd
// naar een gerapporteerde reden: de worker moet doordraaien wanneer R2
// niet beschikbaar of nog niet gepubliceerd is.
export async function loadRemoteMatchStoreIndex(options = {}) {
  const config = options.config || getR2Config();
  const now = Number(options.now || Date.now());
  if (!config.configured) return emptyResult("r2_not_configured");
  try {
    const result = await readRemoteMatchStore({
      get: options.get || prefixedR2Reader,
      config,
      keys: options.keys,
    });
    if (!result?.ok) return emptyResult(result?.reason || "onbekend", { manifest: result?.manifest || null });
    const index = buildMatchStoreFormIndex(result.store, { now });
    return {
      loaded: true,
      matches: Number(result.manifest.matches || 0),
      teams: index.size,
      publishedAt: result.manifest.publishedAt || null,
      sourceFingerprint: result.manifest.sourceFingerprint || null,
      reason: null,
      manifest: result.manifest,
      index,
    };
  } catch (error) {
    return emptyResult(error?.message || String(error));
  }
}
