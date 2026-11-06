#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { fetchApiFootballH2HProfile, getApiFootballH2HCacheKey, summarizeApiFootballUsage } from "./api-football-provider.js";
import { getApiFootballKey } from "./provider-env.js";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { buildR2ObjectKey, getR2Config, putR2Object } from "../shared/cloudflare-r2.js";
import { isHiddenInternationalOrWorldCupEntity } from "../shared/competitionVisibility.js";
import { getKnownProviderIds } from "./worker/team-identity.js";
import { fetchEspnH2HProfile } from "./providers/espn-h2h-provider.js";
import { fetchApiFootballComH2HProfile } from "./providers/apifootball-com-provider.js";
import { fetchGoalApiH2HProfile } from "./providers/goal-api-provider.js";
import { fetchFootballDataCoUkH2HProfile } from "./providers/football-data-co-uk-h2h-provider.js";
import { H2H_PROFILE_SCHEMA, normalizeH2HProfile } from "./providers/h2h-contract.js";
import { buildH2HAttemptState, isH2HAttemptDue, summarizeProviderMetrics } from "./worker/h2h-backfill-ledger.js";
import { writeJsonAtomic, writeTextAtomic } from "../shared/data-publication.js";
import { buildProviderAcceptanceState } from "./worker/orchestration-policy.js";
import { buildApiFootballH2HPolicy } from "./worker/api-football-h2h-policy.js";
import { orderH2HCandidatesByCompetition } from "./worker/h2h-candidate-priority.js";
import { getCompetitionAgent } from "./worker/competition-agents.js";
import { readLocalH2HProfile } from "./worker/local-h2h-history.js";
import { normalizeStaticH2H } from "./worker/h2h-static.js";
import { loadSnapshotLedger } from "../shared/predictionSnapshotLedger.js";
import { normalizeProviderAttempt } from "./worker/provider-observability.js";

const ROOT = process.cwd();
const OUTPUT_JSON = path.join(ROOT, "monitor", "h2h-upcoming-backfill.json");
const OUTPUT_MD = path.join(ROOT, "monitor", "h2h-upcoming-backfill.md");
const API_FOOTBALL_ACCEPTANCE_FILE = path.join(ROOT, "monitor", "api-football-provider-acceptance.json");
const DAYS_AHEAD = Math.max(1, Number(process.env.H2H_BACKFILL_DAYS_AHEAD || 14));
const LIMIT = Math.max(1, Number(process.env.H2H_BACKFILL_LIMIT || 40));
const STALE_ATTEMPT_DAYS = Math.max(0, Number(process.env.H2H_BACKFILL_STALE_DAYS || 1));
const STALE_ATTEMPT_MS = STALE_ATTEMPT_DAYS * 24 * 60 * 60 * 1000;

function digest(value, size = 20) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, size);
}

function writeJson(filePath, value) {
  writeJsonAtomic(filePath, value, { pretty: true });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function persistStaticH2H(match, profile) {
  if (Date.now() >= Date.parse(match.kickoff_at)) return { updated: false, reason: "after_kickoff" };
  const filePath = path.join(ROOT, "data", "days", `${match.date_key}.json`);
  const payload = readJson(filePath);
  if (!payload || !Array.isArray(payload.matches)) return { updated: false, reason: "day_file_missing" };
  const target = payload.matches.find((item) => String(item.id) === String(match.match_id));
  if (!target) return { updated: false, reason: "match_missing" };
  const h2h = normalizeStaticH2H(match, profile);
  if (Number(target?.h2h?.played || 0) > 0 && (!h2h || Number(target.h2h.played) >= h2h.played)) {
    return { updated: false, reason: "existing_profile_equal_or_better" };
  }
  const asOf = profile?.asOf || new Date().toISOString();
  target.h2h = h2h || {
    played: 0,
    homeWins: 0,
    draws: 0,
    awayWins: 0,
    sameCompetitionPlayed: 0,
    results: [],
    status: profile?.status || "no_direct_history",
    source: profile?.source || "h2h-backfill",
    asOf,
    sourceTimestamp: asOf,
  };
  target.h2hStatus = target.h2h.status;
  target.h2hSource = target.h2h.source;
  target.h2hAsOf = target.h2h.asOf;
  target.h2hAvailability = target.h2h.played > 0 ? "beschikbaar" : target.h2h.status;
  target.sourceAsOf = { ...(target.sourceAsOf || {}), h2h: target.h2h.asOf };
  const published = writeJsonAtomic(filePath, payload);
  return { updated: true, filePath, hasHistory: Boolean(h2h), contentHash: published.hash };
}

function edgeIds(homeClubId, awayClubId, competitionId) {
  const clubA = [homeClubId, awayClubId].sort()[0];
  const clubB = [homeClubId, awayClubId].sort()[1];
  return {
    clubA,
    clubB,
    edgeId: `h2h_${digest(`${clubA}|${clubB}|${competitionId}`)}`,
  };
}

function staticCandidates(attemptLedger = readJson(OUTPUT_JSON)?.attemptLedger || {}) {
  const now = Date.now();
  const rows = [];
  for (let offset = 0; offset <= DAYS_AHEAD; offset += 1) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + offset);
    const dateKey = date.toISOString().slice(0, 10);
    const filePath = path.join(ROOT, "data", "days", `${dateKey}.json`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      for (const match of Array.isArray(payload?.matches) ? payload.matches : []) {
        if (isHiddenInternationalOrWorldCupEntity(match)) continue;
        if (!match?.homeTeamName || !match?.awayTeamName) continue;
        const staticMatchId = String(match.id || `static_${digest(`${dateKey}|${match.homeTeamName}|${match.awayTeamName}`)}`);
        const hasUsableHistory = Number(match?.h2h?.played || match?.h2h?.results?.length || 0) > 0;
        if (hasUsableHistory || !isH2HAttemptDue(staticMatchId, attemptLedger)) continue;
        const kickoff = match.kickoff || `${dateKey}T12:00:00.000Z`;
        if (Date.parse(kickoff) < now) continue;
        const homeKey = `name_${digest(match.homeTeamName)}`;
        const awayKey = `name_${digest(match.awayTeamName)}`;
        rows.push({
          match_id: String(match.id || `static_${digest(`${dateKey}|${match.homeTeamName}|${match.awayTeamName}`)}`),
          date_key: dateKey,
          kickoff_at: kickoff,
          league: match.league || "unknown",
          competition_id: `competition_${digest(match.league || "unknown")}`,
          home_team_name: match.homeTeamName,
          away_team_name: match.awayTeamName,
          home_club_id: String(match.homeTeamId || homeKey),
          away_club_id: String(match.awayTeamId || awayKey),
        });
      }
    } catch (error) {
      console.warn(`[h2h-backfill] kon ${filePath} niet lezen: ${error?.message || error}`);
    }
  }
  return rows;
}

async function storeR2H2H(match, profile) {
  const config = getR2Config();
  if (!config.configured || !profile?.results?.length) return { ok: false, skipped: true, reason: "r2_not_configured_or_empty" };
  const capturedAt = new Date().toISOString();
  if (Date.parse(capturedAt) >= Date.parse(match.kickoff_at)) return { ok: false, skipped: true, reason: "after_kickoff" };
  const contentHash = profile.contentHash || digest(JSON.stringify(profile), 64);
  const payload = `${JSON.stringify({
    schemaVersion: "critical-h2h-v2",
    matchId: match.match_id,
    kickoff: match.kickoff_at,
    capturedAt,
    provider: profile.source || "h2h-backfill",
    contentHash,
    h2h: profile,
  })}\n`;
  const revisionKey = buildR2ObjectKey(config, `critical-captures/h2h/${match.match_id}/revisions/${contentHash}.json`);
  const revisionUpload = await putR2Object({
    config,
    key: revisionKey,
    body: payload,
    contentType: "application/json",
    metadata: { match: match.match_id, provider: profile.source || "h2h-backfill", contentHash },
  });
  if (!revisionUpload?.ok) return revisionUpload;
  return putR2Object({
    config,
    key: buildR2ObjectKey(config, `critical-captures/h2h/${match.match_id}/latest.json`),
    body: payload,
    contentType: "application/json",
    metadata: { match: match.match_id, provider: profile.source || "h2h-backfill", contentHash, revisionKey },
  });
}

function orientResultForStoredEdge(result, clubA, homeClubId, awayClubId) {
  const currentHomeIsClubA = String(homeClubId) === String(clubA);
  return {
    ...result,
    storedHomeClubId: clubA,
    storedAwayClubId: currentHomeIsClubA ? awayClubId : homeClubId,
    storedHomeScore: currentHomeIsClubA ? result.homeScore : result.awayScore,
    storedAwayScore: currentHomeIsClubA ? result.awayScore : result.homeScore,
  };
}

async function upsertH2HEdge(sql, match, profile) {
  const { clubA, clubB, edgeId } = edgeIds(match.home_club_id, match.away_club_id, match.competition_id);
  const oriented = (profile.results || []).map((result) => orientResultForStoredEdge(result, clubA, match.home_club_id, match.away_club_id));
  const homeWins = oriented.filter((item) => Number(item.storedHomeScore) > Number(item.storedAwayScore)).length;
  const awayWins = oriented.filter((item) => Number(item.storedAwayScore) > Number(item.storedHomeScore)).length;
  const draws = oriented.length - homeWins - awayWins;
  const weightedRecentBalance = Number(((homeWins - awayWins) / Math.max(oriented.length, 1)).toFixed(3));
  const profileSource = String(profile.source || "h2h-backfill").toLowerCase();
  const provider = profileSource.includes("database")
    ? "database-results"
    : profileSource.includes("local immutable")
      ? "local-reviewed-results"
      : profileSource.includes("espn")
        ? "espn-team-schedule"
        : profileSource.includes("apifootball-com")
          ? "apifootball-com"
          : profileSource.includes("goal-api")
            ? "goal-api"
            : profileSource.includes("football-data.co.uk")
              ? "football-data-co-uk"
              : "api-football";
  const stableContentHash = profile.contentHash || digest(JSON.stringify(oriented), 64);
  const sourceRecordId = `${provider}-h2h:${digest(`${match.match_id}|${stableContentHash}`, 40)}`;

  await sql.query(
    `insert into source_records(source_record_id,provider,entity_type,entity_key,fetched_at,source_timestamp,content_hash,trust_score,payload)
     values($1,$2,'h2h',$3,now(),$4,$5,$6,$7::jsonb)
     on conflict(source_record_id) do update set fetched_at=excluded.fetched_at,payload=excluded.payload`,
    [sourceRecordId, provider, match.match_id, profile.asOf || new Date().toISOString(), stableContentHash, ["database-results", "local-reviewed-results"].includes(provider) ? 0.94 : provider === "espn-team-schedule" ? 0.82 : 0.86, JSON.stringify({ schemaVersion: H2H_PROFILE_SCHEMA, matchId: match.match_id, source: profile.source, contentHash: stableContentHash, results: oriented })]
  );

  await sql.query(
    `
      insert into h2h_edges(
        h2h_edge_id, home_club_id, away_club_id, competition_id, played,
        home_wins, draws, away_wins, weighted_recent_balance, results, source_record_id, updated_at
      )
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,now())
      on conflict(h2h_edge_id) do update set
        played = excluded.played,
        home_wins = excluded.home_wins,
        draws = excluded.draws,
        away_wins = excluded.away_wins,
        weighted_recent_balance = excluded.weighted_recent_balance,
        results = excluded.results,
        source_record_id = excluded.source_record_id,
        updated_at = now()
    `,
    [
      edgeId,
      clubA,
      clubB,
      match.competition_id,
      oriented.length,
      homeWins,
      draws,
      awayWins,
      weightedRecentBalance,
      JSON.stringify(oriented),
      sourceRecordId,
    ]
  );
}

async function readDatabaseH2HProfile(sql, match) {
  const rows = await sql.query(
    `select m.match_id,m.date_key,m.league,m.home_club_id,m.away_club_id,m.home_team_name,m.away_team_name,
       mr.final_home_goals,mr.final_away_goals,mr.result_source,mr.settled_at
     from matches m
     join match_results mr on mr.match_id=m.match_id
     where m.kickoff_at < $1
       and ((m.home_club_id=$2 and m.away_club_id=$3) or (m.home_club_id=$3 and m.away_club_id=$2))
       and mr.final_home_goals is not null and mr.final_away_goals is not null
     order by m.kickoff_at desc
     limit 20`,
    [match.kickoff_at, match.home_club_id, match.away_club_id]
  );
  if (!rows.length) return null;
  const results = rows.map((row) => {
    const currentOrientation = String(row.home_club_id) === String(match.home_club_id);
    return {
      date: row.date_key,
      league: row.league,
      homeTeam: currentOrientation ? row.home_team_name : row.away_team_name,
      awayTeam: currentOrientation ? row.away_team_name : row.home_team_name,
      homeScore: Number(currentOrientation ? row.final_home_goals : row.final_away_goals),
      awayScore: Number(currentOrientation ? row.final_away_goals : row.final_home_goals),
      source: row.result_source || "match_results",
    };
  });
  return { results, source: "database historical match results", asOf: rows[0]?.settled_at || new Date().toISOString() };
}

function buildBackfillRecommendation({ remaining, providerConfigured, apiFootballEnabled, filled, databaseWritable, apiFootballPairsAttempted = 0, apiFootballPairLimit = 0 }) {
  if (remaining > 0) {
    if (providerConfigured && apiFootballEnabled && apiFootballPairsAttempted >= apiFootballPairLimit && apiFootballPairLimit > 0) {
      return `API-Football H2H is onafhankelijk van fixture-acceptatie ingeschakeld; ${apiFootballPairsAttempted}/${apiFootballPairLimit} beperkte paarpogingen gedaan. Er staan nog ${remaining} fixtures in de wachtrij.`;
    }
    return `Er staan nog ${remaining} fixtures in de wachtrij; volgende batch prioriteert ontbrekende H2H en vroegste aftrap.`;
  }
  if (!providerConfigured) {
    return "API-Football is lokaal niet geconfigureerd. Laat de GitHub workflow draaien met API_KEY_API_FOOTBALL of voeg de key lokaal toe voor handmatige backfill.";
  }
  if (!apiFootballEnabled) {
    return "API-Football H2H is niet uitgevoerd: controleer de providerkey en API_FOOTBALL_H2H_ENABLED; de UEFA/vriendschappelijke fixture-acceptatiegate geldt niet voor H2H.";
  }
  if (filled.length > 0) {
    return `H2H-profielen zijn ${databaseWritable ? "naar Neon en R2" : "naar R2"} geschreven. Laat de worker draaien zodat voorspellingen de nieuwe captures gebruikt.`;
  }
  return "Geen directe H2H gevonden voor de gecontroleerde wedstrijden. Breid team-ID mapping/providerdekking uit of accepteer expliciet no-direct-history voor deze fixtures.";
}

function buildNoDirectHistoryProfile(match, status, providerAttempts = []) {
  const normalizedStatus = status === "not_found" ? "no_direct_history" : status;
  return {
    matchId: match.match_id,
    date: match.date_key,
    league: match.league,
    homeTeam: match.home_team_name,
    awayTeam: match.away_team_name,
    status: normalizedStatus,
    availabilityStatus: normalizedStatus,
    source: providerAttempts.map((attempt) => attempt?.provider).filter(Boolean).join(", ") || "h2h-backfill",
    asOf: new Date().toISOString(),
    note:
      normalizedStatus === "provider_not_configured"
        ? "Geen bruikbare provider is geconfigureerd in deze omgeving."
        : normalizedStatus === "provider_acceptance_blocked"
          ? "Een provider is geblokkeerd door de acceptatie-/accountgate; dit is geen bewijs dat H2H ontbreekt."
        : normalizedStatus === "provider_unreachable"
          ? "Een geconfigureerde provider was onbereikbaar of gaf een fout terug; er is geen afwezigheid van H2H vastgesteld."
        : normalizedStatus === "team_mapping_missing"
          ? "Providerteam-ID mapping ontbreekt; voeg aliases of provider-ID's toe voor dit clubpaar."
          : normalizedStatus === "rate_limited_locally"
            ? "Providerquota voor deze run is bereikt; volgende geplande run probeert opnieuw."
            : normalizedStatus === "provider_payload_error"
              ? "De provider gaf een fout in de payload (lege of afwijkende respons); dit is geen bewijs dat H2H ontbreekt."
              : normalizedStatus === "no_direct_history"
            ? "Geen betrouwbare directe H2H gevonden bij de providers die met succes konden worden bevraagd."
            : "H2H-status is nog niet vastgesteld.",
  };
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  let databaseWritable = Boolean(sql);
  let databaseError = sql ? null : "database_not_configured";
  let candidates = [];
  const attemptLedger = readJson(OUTPUT_JSON)?.attemptLedger || {};
  try {
    if (!sql) throw new Error("database_not_configured");
    candidates = await sql.query(`
      select m.match_id, m.date_key, m.kickoff_at, m.league, m.competition_id, m.home_team_name, m.away_team_name,
        m.home_club_id, m.away_club_id
      from matches m
      where m.kickoff_at >= now()
        and m.kickoff_at <= now() + ($1::int * interval '1 day')
        and m.identity_status = 'resolved'
        and m.home_club_id is not null
        and m.away_club_id is not null
        and not exists (
          select 1 from h2h_edges h
          where h.home_club_id = least(m.home_club_id, m.away_club_id)
            and h.away_club_id = greatest(m.home_club_id, m.away_club_id)
            and h.competition_id is not distinct from m.competition_id
            and h.played > 0
        )
      order by m.kickoff_at, m.match_id
      limit $2
    `, [DAYS_AHEAD, LIMIT * 4]);
    candidates = orderH2HCandidatesByCompetition(
      candidates.filter((match) => isH2HAttemptDue(attemptLedger[String(match.match_id)], { staleDays: STALE_ATTEMPT_DAYS })),
      attemptLedger,
    ).slice(0, LIMIT);
  } catch (error) {
    databaseWritable = false;
    databaseError = error?.message || String(error);
    candidates = staticCandidates();
  }

  // Neon can contain an H2H edge while the static Vercel fallback is still empty.
  // Always merge both candidate sets so database state cannot hide dashboard gaps.
  const staticMissing = staticCandidates(attemptLedger);
  const mergedCandidates = new Map();
  for (const match of [...staticMissing, ...candidates]) {
    if (!mergedCandidates.has(match.match_id)) mergedCandidates.set(match.match_id, match);
  }
  const orderedCandidates = orderH2HCandidatesByCompetition(
    [...mergedCandidates.values()].filter((match) => isH2HAttemptDue(attemptLedger[String(match.match_id)], { staleDays: STALE_ATTEMPT_DAYS })),
    attemptLedger,
  );
  const candidateTotal = orderedCandidates.length;
  candidates = orderedCandidates.slice(0, LIMIT);

  const store = {};
  const snapshotLedgerLoad = await loadSnapshotLedger({ root: ROOT });
  const providerConfigured = Boolean(getApiFootballKey());
  const apiFootballAcceptance = buildProviderAcceptanceState(readJson(API_FOOTBALL_ACCEPTANCE_FILE));
  const apiFootballPolicy = buildApiFootballH2HPolicy({
    configured: providerConfigured,
    enabledSetting: process.env.API_FOOTBALL_H2H_ENABLED,
    maxPairsPerRun: process.env.API_FOOTBALL_H2H_MAX_PAIRS_PER_RUN || 3,
  });
  const apiFootballEnabled = apiFootballPolicy.enabled;
  let apiFootballPairsAttempted = 0;
  const filled = [];
  const noDirectHistory = [];
  const errors = [];
  let r2Stored = 0;
  let staticUpdated = 0;

  for (const match of candidates) {
    try {
      let databaseProfile = null;
      if (databaseWritable) {
        try {
          databaseProfile = await readDatabaseH2HProfile(sql, match);
        } catch (error) {
          databaseWritable = false;
          databaseError = error?.message || String(error);
        }
      }
      if (databaseProfile?.results?.length) {
        const staticWrite = persistStaticH2H(match, databaseProfile);
        if (staticWrite.updated && staticWrite.hasHistory) staticUpdated += 1;
        const r2 = await storeR2H2H(match, databaseProfile).catch(() => null);
        if (r2?.ok) r2Stored += 1;
        if (databaseWritable) {
          try {
            await upsertH2HEdge(sql, match, databaseProfile);
          } catch (error) {
            databaseWritable = false;
            databaseError = error?.message || String(error);
          }
        }
        filled.push({
          matchId: match.match_id,
          date: match.date_key,
          homeTeam: match.home_team_name,
          awayTeam: match.away_team_name,
          played: databaseProfile.results.length,
          source: databaseProfile.source,
        });
        continue;
      }
      const providerAttempts = [];
      const localCandidate = readLocalH2HProfile(ROOT, match, 5, { ledger: snapshotLedgerLoad.ledger });
      const localProfile = localCandidate ? normalizeH2HProfile(localCandidate, { match, provider: localCandidate.source || "canonical-history" }) : null;
      providerAttempts.push(normalizeProviderAttempt({ provider: "canonical-history", status: localProfile?.results?.length ? "ok" : "not_found", records: localProfile?.results?.length || 0 }));
      const footballDataProvider = String(match.league || "").match(/^(England - Premier League|England - Championship|Germany - (?:2\. )?Bundesliga|France - Ligue ?[12]|Netherlands - Eredivisie)$/i);
      const footballDataCandidate = localProfile?.results?.length || !footballDataProvider ? null : await fetchFootballDataCoUkH2HProfile(match);
      const footballDataProfile = footballDataCandidate ? normalizeH2HProfile(footballDataCandidate, { match, provider: "football-data-co-uk" }) : null;
      if (!localProfile?.results?.length && footballDataProvider) providerAttempts.push(normalizeProviderAttempt({ provider: "football-data-co-uk", status: footballDataProfile?.results?.length ? "ok" : "no_coverage", records: footballDataProfile?.results?.length || 0 }));
      else if (!localProfile?.results?.length) providerAttempts.push(normalizeProviderAttempt({ provider: "football-data-co-uk", status: "not_configured", reason: "league_unsupported" }));
      const apiFootballComCandidate = localProfile?.results?.length || footballDataProfile?.results?.length || !["England - Championship", "France - Ligue 2"].includes(match.league) ? null : await fetchApiFootballComH2HProfile({
        homeName: match.home_team_name,
        awayName: match.away_team_name,
        leagueLabel: match.league,
      });
      const apiFootballComProfile = apiFootballComCandidate ? normalizeH2HProfile(apiFootballComCandidate, { match, provider: "apifootball-com" }) : null;
      if (!localProfile?.results?.length && !footballDataProfile?.results?.length && ["England - Championship", "France - Ligue 2"].includes(match.league)) providerAttempts.push(normalizeProviderAttempt({ provider: "apifootball-com", status: apiFootballComProfile?.results?.length ? "ok" : "no_coverage", records: apiFootballComProfile?.results?.length || 0 }));
      const goalApiCandidate = localProfile?.results?.length || footballDataProfile?.results?.length || apiFootballComProfile?.results?.length ? null : await fetchGoalApiH2HProfile(match);
      const goalApiProfile = goalApiCandidate ? normalizeH2HProfile(goalApiCandidate, { match, provider: "goal-api" }) : null;
      if (!localProfile?.results?.length && !footballDataProfile?.results?.length && !apiFootballComProfile?.results?.length) {
        providerAttempts.push(normalizeProviderAttempt({ provider: "goal-api", status: goalApiProfile?.results?.length ? "ok" : goalApiProfile?.status || "acceptance_gate_closed", records: goalApiProfile?.results?.length || 0 }));
      }
      let apiFootballAttemptedThisMatch = false;
      const hasOtherProviderHistory = Boolean(
        localProfile?.results?.length || footballDataProfile?.results?.length ||
        apiFootballComProfile?.results?.length || goalApiProfile?.results?.length
      );
      const apiFootballAtPairLimit = apiFootballPairsAttempted >= apiFootballPolicy.pairLimit;
      const apiFootballBudgetSkipped = !hasOtherProviderHistory && apiFootballEnabled && apiFootballAtPairLimit;
      const apiFootballCandidate = hasOtherProviderHistory || !apiFootballEnabled || apiFootballAtPairLimit
        ? null
        : await (async () => {
            apiFootballAttemptedThisMatch = true;
            apiFootballPairsAttempted += 1;
            return fetchApiFootballH2HProfile({
              store,
              homeName: match.home_team_name,
              awayName: match.away_team_name,
              homeId: match.home_club_id,
              awayId: match.away_club_id,
              homeProviderIds: getKnownProviderIds(match.home_team_name),
              awayProviderIds: getKnownProviderIds(match.away_team_name),
              leagueLabel: match.league,
            });
          })();
      const apiFootballProfile = apiFootballCandidate ? normalizeH2HProfile(apiFootballCandidate, { match, provider: apiFootballCandidate.source || "api-football" }) : null;
      const apiFootballPairKey = getApiFootballH2HCacheKey({
        homeName: match.home_team_name,
        awayName: match.away_team_name,
        leagueLabel: match.league,
      });
      const apiFootballAttempt = apiFootballAttemptedThisMatch
        ? store.apiFootballH2HCache?.[apiFootballPairKey]
        : null;
      if (apiFootballAttemptedThisMatch || apiFootballBudgetSkipped || apiFootballProfile?.results?.length) {
        providerAttempts.push(normalizeProviderAttempt({
          provider: "api-football",
          status: apiFootballProfile?.results?.length ? "ok" : apiFootballAttempt?.status || (apiFootballBudgetSkipped ? "rate_limited_locally" : "not_found"),
          records: apiFootballProfile?.results?.length || apiFootballAttempt?.data?.results?.length || 0,
          statusCode: apiFootballAttempt?.statusCode,
          // Zonder deze velden bleef een payloadfout onzichtbaar in het rapport.
          errorCategory: apiFootballAttempt?.errorCategory || null,
          error: apiFootballAttempt?.error || apiFootballAttempt?.errorDetail || null,
        }));
      }
      const profile = localProfile?.results?.length ? localProfile : footballDataProfile?.results?.length ? footballDataProfile : apiFootballComProfile?.results?.length ? apiFootballComProfile : goalApiProfile?.results?.length ? goalApiProfile : apiFootballProfile;
      const espnCandidate = profile?.results?.length ? null : await fetchEspnH2HProfile({
        store,
        homeName: match.home_team_name,
        awayName: match.away_team_name,
        homeProviderIds: getKnownProviderIds(match.home_team_name),
        awayProviderIds: getKnownProviderIds(match.away_team_name),
        kickoff: match.kickoff_at,
      });
      const espnProfile = espnCandidate ? normalizeH2HProfile(espnCandidate, { match, provider: "espn-team-schedule" }) : null;
      const homeEspnIds = getKnownProviderIds(match.home_team_name);
      const awayEspnIds = getKnownProviderIds(match.away_team_name);
      const espnAttempt = store.espnH2HCache?.[`${homeEspnIds.espn}:${awayEspnIds.espn}:${homeEspnIds.espnLeagueCode || awayEspnIds.espnLeagueCode}`];
      if (!profile?.results?.length && homeEspnIds.espn && awayEspnIds.espn && (homeEspnIds.espnLeagueCode || awayEspnIds.espnLeagueCode)) {
        providerAttempts.push(normalizeProviderAttempt({
          provider: "espn-team-schedule",
          status: espnProfile?.results?.length ? "ok" : espnAttempt?.status || "no_coverage",
          records: espnProfile?.results?.length || 0,
        }));
      } else if (!profile?.results?.length) {
        providerAttempts.push(normalizeProviderAttempt({ provider: "espn-team-schedule", status: "team_mapping_missing" }));
      }
      const resolvedProfile = profile?.results?.length ? profile : espnProfile;
      if (resolvedProfile?.results?.length && resolvedProfile.publishable === false) {
        throw new Error(`H2H quality gate rejected provider profile: ${JSON.stringify(resolvedProfile.quality?.rejected || {})}`);
      }
      if (resolvedProfile?.results?.length) {
        const staticWrite = persistStaticH2H(match, resolvedProfile);
        if (staticWrite.updated && staticWrite.hasHistory) staticUpdated += 1;
        const r2 = await storeR2H2H(match, resolvedProfile).catch((error) => ({ ok: false, error: error?.message || String(error) }));
        if (r2?.ok) r2Stored += 1;
        if (databaseWritable) {
          try {
            await upsertH2HEdge(sql, match, resolvedProfile);
          } catch (error) {
            databaseWritable = false;
            databaseError = error?.message || String(error);
          }
        }
        filled.push({
          matchId: match.match_id,
          date: match.date_key,
          homeTeam: match.home_team_name,
          awayTeam: match.away_team_name,
          played: resolvedProfile.results.length,
          source: resolvedProfile.source,
          providerAttempts,
        });
      } else {
        const providerResults = providerAttempts.map((attempt) => attempt.result);
        const hadProviderError = providerResults.includes("http_error") || providerAttempts.some((attempt) => attempt.result === "quota" && attempt.status !== "rate_limited_locally");
        const hadProviderUnreachable = providerAttempts.some((attempt) => /request_failed|provider_unreachable/.test(String(attempt.status || "")));
        // Een payloadfout (lege/afwijkende providerrespons) is geen bewijs dat er
        // geen H2H bestaat; die mag dus niet als "geen historie" eindigen.
        const hadProviderPayloadError = providerAttempts.some((attempt) =>
          /payload|provider_error/.test(String(attempt.status || "")) ||
          /payload|auth_or_plan/.test(String(attempt.errorCategory || ""))
        );
        const locallyRateLimited = providerAttempts.some((attempt) => attempt.status === "rate_limited_locally");
        const hadConfiguredProvider = providerAttempts.some((attempt) => ["found", "no_coverage", "not_published_yet", "http_error", "quota"].includes(attempt.result));
        const status = hadProviderPayloadError
          ? "provider_payload_error"
          : hadProviderError || hadProviderUnreachable
          ? "provider_unreachable"
          : locallyRateLimited
            ? "rate_limited_locally"
            : !hadConfiguredProvider
              ? !providerConfigured ? "provider_not_configured" : "provider_acceptance_blocked"
              : providerResults.includes("mapping_failed") && !providerResults.includes("no_coverage")
                ? "team_mapping_missing"
                : "not_found";
        const noHistoryProfile = buildNoDirectHistoryProfile(match, status, providerAttempts);
        const staticWrite = persistStaticH2H(match, noHistoryProfile);
        noDirectHistory.push({ ...noHistoryProfile, providerAttempts, staticStatusUpdated: staticWrite.updated });
      }
    } catch (error) {
      errors.push({
        matchId: match.match_id,
        homeTeam: match.home_team_name,
        awayTeam: match.away_team_name,
        error: error?.message || String(error),
      });
    }
  }

  // Volledige providerfouten in het rapport: alleen een status als "not_found"
  // verbergt waarom een batch leeg blijft.
  const providerErrorSamples = [...filled, ...noDirectHistory]
    .flatMap((item) => (item.providerAttempts || []).map((attempt) => ({
      matchId: item.matchId,
      league: item.league,
      homeTeam: item.homeTeam,
      awayTeam: item.awayTeam,
      provider: attempt.provider,
      status: attempt.status,
      result: attempt.result,
      statusCode: attempt.statusCode ?? null,
      errorCategory: attempt.errorCategory ?? null,
      error: attempt.error ?? null,
    })))
    .filter((row) => row.result !== "found" && /error|payload|quota|acceptance|mapping|unreachable|not_configured|rate_limited/.test(String(row.status || "")));
  // Een batch die niets oplevert is een signaal, geen uitkomst: laat de workflow
  // falen. Maar alleen wanneer de providers niets bruikbaars antwoordden; een
  // correcte "geen historie"-ronde is data, geen fout.
  const qualityGate = buildH2HQualityGate({
    minBatch: process.env.H2H_BACKFILL_QUALITY_MIN_BATCH,
    candidates: candidates.length,
    filled: filled.length,
    attempts: [...filled, ...noDirectHistory].flatMap((item) => item.providerAttempts || []),
  });
  const remaining = Math.max(0, candidateTotal - candidates.length);
  const report = {
    generatedAt: new Date().toISOString(),
    daysAhead: DAYS_AHEAD,
    checked: candidates.length,
    candidateTotal,
    remaining,
    byCompetition: Object.fromEntries([...new Set(candidates.map((match) => match.league || "unknown"))].map((league) => [
      league,
      {
        agent: getCompetitionAgent(league)?.key || "default-agent",
        checked: candidates.filter((match) => (match.league || "unknown") === league).length,
      },
    ])),
    databaseWritable,
    databaseError,
    r2SnapshotLedgerAvailable: Boolean(snapshotLedgerLoad.sources?.r2?.available),
    r2Stored,
    staticUpdated,
    filled: filled.length,
    noDirectHistory: noDirectHistory.length,
    errors: errors.length,
    providerErrorCount: providerErrorSamples.length,
    providerErrors: providerErrorSamples.slice(0, 25),
    qualityGate,
    apiFootballAcceptance: {
      configured: providerConfigured,
      enabled: apiFootballEnabled,
      accepted: apiFootballAcceptance.accepted,
      reason: apiFootballAcceptance.reason,
      appliesToH2H: false,
    },
    apiFootballH2HPolicy: { ...apiFootballPolicy, pairsAttempted: apiFootballPairsAttempted },
    apiFootball: summarizeApiFootballUsage(store),
    providerMetrics: summarizeProviderMetrics([...filled.flatMap((item) => item.providerAttempts || []), ...noDirectHistory.flatMap((item) => item.providerAttempts || [])]),
    // Trend t.o.v. de vorige run: een zakkende dekking valt zo op vóór iemand
    // een chip in het dashboard opmerkt.
    coverageTrend: (() => {
      const previous = readJson(OUTPUT_JSON);
      if (!previous || previous.checked === undefined) return null;
      const previousChecked = Number(previous.checked || 0);
      const previousFilled = Number(previous.filled || 0);
      return {
        generatedAt: previous.generatedAt || null,
        checked: previousChecked,
        filled: previousFilled,
        deltaFilled: filled.length - previousFilled,
        deltaChecked: candidates.length - previousChecked,
      };
    })(),
    filledSamples: filled.slice(0, 20),
    noDirectHistorySamples: noDirectHistory.slice(0, 20),
    errorSamples: errors.slice(0, 10),
    attemptLedger: (() => {
      const previous = readJson(OUTPUT_JSON)?.attemptLedger || {};
      const checkedAt = new Date().toISOString();
      const filledIds = new Set(filled.map((item) => String(item.matchId)));
      const emptyById = new Map(noDirectHistory.map((item) => [String(item.matchId), item]));
      const errorById = new Map(errors.map((item) => [String(item.matchId), item]));
      for (const match of candidates) {
        const id = String(match.match_id);
        const empty = emptyById.get(id);
        const failure = errorById.get(id);
        const providerFailure = empty?.providerAttempts?.find((attempt) => ["http_error", "quota"].includes(attempt.result));
        previous[id] = buildH2HAttemptState(previous[id], {
          checkedAt,
          status: filledIds.has(id) ? "filled" : failure ? "error" : empty?.status || "error",
          result: filledIds.has(id) ? "found" : providerFailure?.result || (empty ? "no_coverage" : "http_error"),
          error: failure?.error || null,
        });
      }
      return Object.fromEntries(
        Object.entries(previous).filter(([, value]) => Date.parse(value?.checkedAt || "") >= Date.now() - 30 * 24 * 60 * 60 * 1000)
      );
    })(),
    recommendation: buildBackfillRecommendation({
      remaining,
      providerConfigured,
      apiFootballEnabled,
      filled,
      databaseWritable,
      apiFootballPairsAttempted,
      apiFootballPairLimit: apiFootballPolicy.pairLimit,
    }),
  };

  writeJson(OUTPUT_JSON, report);
  writeTextAtomic(
    OUTPUT_MD,
    [
      "# Upcoming H2H Backfill",
      "",
      `Laatst bijgewerkt: ${report.generatedAt}`,
      `Gecontroleerd: ${report.checked}`,
      `Gevuld: ${report.filled}`,
      `Geen directe H2H: ${report.noDirectHistory}`,
      `Errors: ${report.errors}`,
      `Providerfouten: ${report.providerErrorCount}`,
      `Kwaliteitsgate: ${report.qualityGate.failed
        ? "gefaald (geen enkele providerpoging in een volle batch)"
        : report.qualityGate.degraded
          ? "gedegradeerd (providers geblokkeerd in een volle batch)"
          : report.qualityGate.applied
            ? `geslaagd (${report.qualityGate.outcome})`
            : "niet van toepassing"}`,
      "",
      `Openstaand na deze batch: ${report.remaining}`,
      "",
      "## Aanbeveling",
      report.recommendation,
      "",
      "## Gevuld",
      ...report.filledSamples.map((item) => `- ${item.date}: ${item.homeTeam} - ${item.awayTeam} (${item.played})`),
      "",
      "## Geen Directe H2H",
      ...report.noDirectHistorySamples.map((item) => `- ${item.date}: ${item.homeTeam} - ${item.awayTeam} (${item.status})`),
      "",
      ...(providerErrorSamples.length
        ? [
            "## Providerfouten",
            ...Object.entries(
              providerErrorSamples.reduce((counts, row) => {
                const code = row.statusCode ? ` ${row.statusCode}` : "";
                const category = row.errorCategory ? ` / ${row.errorCategory}` : "";
                const key = `${row.provider || "provider"}: ${row.status || row.result}${code}${category}`;
                counts[key] = (counts[key] || 0) + 1;
                return counts;
              }, {})
            )
              .sort((left, right) => right[1] - left[1])
              .slice(0, 8)
              .map(([key, count]) => `- ${count}× ${key}`),
            "",
          ]
        : []),
    ].join("\n")
  );

  console.log(JSON.stringify(report, null, 2));
  if (providerErrorSamples.length) {
    // Volledige providerfouten in de runlog, zodat "0 van 50" traceerbaar is.
    console.error("[h2h-backfill] providerfouten:", JSON.stringify(providerErrorSamples, null, 2));
  }
  if (report.qualityGate.failed) {
    console.error(`[h2h-backfill] kwaliteitsgate: 0 van ${report.qualityGate.batch} gecontroleerde wedstrijden kreeg H2H (${report.providerErrorCount} providerfouten, oorzaak: ${report.qualityGate.outcome}). Er is geen enkele providerpoging gedaan; controleer de configuratie.`);
    process.exitCode = 1;
  } else if (report.qualityGate.degraded) {
    const reason = `[h2h-backfill] providers geblokkeerd: 0 van ${report.qualityGate.batch} wedstrijden kreeg H2H (${report.providerErrorCount} providerfouten, ${report.qualityGate.blockedAttempts} geblokkeerde pogingen). Dit is een providerbeperking, geen bewijs dat H2H ontbreekt.`;
    console.error(reason);
    if (process.env.GITHUB_ACTIONS === "true") {
      console.log(`::warning title=H2H providers geblokkeerd::${reason}`);
    }
  }
}

// Gate-semantiek: alleen falen als een volle batch geen enkele providerpoging
// deed; dan is er aantoonbaar niets geprobeerd. Quota-, HTTP- en
// mappingfouten zijn een blokkade bij de provider, geen bewijs dat er geen
// historie is: die markeren we als gedegradeerd (waarschuwing, groene run),
// zodat elke run geen failure-mail oplevert voor een externe beperking.
const H2H_BLOCKED_ATTEMPT_RESULTS = new Set(["http_error", "quota", "mapping_failed"]);

export function buildH2HQualityGate({ minBatch, candidates, filled, attempts = [] } = {}) {
  const minBatchForGate = Math.max(1, Number(minBatch || 20));
  const batch = Number(candidates || 0);
  const filledCount = Number(filled || 0);
  // Een lokale rate-limit betekent dat er niets gevraagd is, dus telt niet als
  // providerantwoord en ook niet als providerblokkade.
  const effectiveAttempts = (Array.isArray(attempts) ? attempts : [])
    .filter((attempt) => String(attempt?.status || "") !== "rate_limited_locally");
  const blockedAttempts = effectiveAttempts.filter((attempt) =>
    H2H_BLOCKED_ATTEMPT_RESULTS.has(String(attempt?.result || ""))
  ).length;
  const applied = batch >= minBatchForGate;
  const outcome = !applied
    ? "not_applicable"
    : filledCount > 0
      ? "filled"
      : effectiveAttempts.length === 0
        ? "no_provider_attempts"
        : blockedAttempts > 0
          ? "provider_blocked"
          : "providers_reported_no_history";
  return {
    minBatch: minBatchForGate,
    batch,
    filled: filledCount,
    attempts: effectiveAttempts.length,
    blockedAttempts,
    applied,
    outcome,
    failed: outcome === "no_provider_attempts",
    degraded: outcome === "provider_blocked",
  };
}

export { buildBackfillRecommendation };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
