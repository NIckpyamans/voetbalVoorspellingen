#!/usr/bin/env node

import crypto from "crypto";
import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());

const sql = getSql();
if (!sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

const apiKey = String(process.env.THESPORTSDB_API_KEY || "3").trim();
const baseUrl = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}`;
const maxDates = Math.min(Math.max(Number(process.env.THESPORTSDB_BACKFILL_DATES || 45), 1), 90);
const startedAt = Date.now();

function digest(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 24);
}

function normalizeTeamName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(fc|cf|afc|sc|club|football|voetbal|calcio|deportivo)\b/g, " ")
    .replace(/\butd\b/g, "united")
    .replace(/\bintl\b/g, "international")
    .replace(/\binter\b/g, "internazionale")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenSet(value) {
  return new Set(normalizeTeamName(value).split(" ").filter(Boolean));
}

function teamSimilarity(left, right) {
  const a = normalizeTeamName(left);
  const b = normalizeTeamName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 6 && b.includes(a)) return 0.92;
  if (b.length >= 6 && a.includes(b)) return 0.92;
  const aTokens = tokenSet(a);
  const bTokens = tokenSet(b);
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size || 1;
  return intersection / union;
}

function matchesFixture(candidate, event) {
  const homeScore = teamSimilarity(candidate.home_team_name, event.strHomeTeam);
  const awayScore = teamSimilarity(candidate.away_team_name, event.strAwayTeam);
  return homeScore >= 0.82 && awayScore >= 0.82
    ? { matched: true, confidence: Math.min(homeScore, awayScore), homeScore, awayScore }
    : { matched: false, confidence: Math.min(homeScore, awayScore), homeScore, awayScore };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "voetbalvoorspellingen-source-backfill/1.0" },
    });
    if (!response.ok) return { ok: false, status: response.status, events: [] };
    const payload = await response.json();
    return { ok: true, status: response.status, events: Array.isArray(payload?.events) ? payload.events : [] };
  } catch (error) {
    return { ok: false, status: "fetch_error", error: error?.message || String(error), events: [] };
  } finally {
    clearTimeout(timeout);
  }
}

const candidates = await sql.query(
  `
    with provider_counts as (
      select match_id, count(distinct provider)::int as providers
      from match_source_records
      group by match_id
    )
    select
      m.match_id,
      m.date_key::text as date_key,
      m.home_team_name,
      m.away_team_name,
      '' as league_name,
      coalesce(pc.providers, 0)::int as provider_count
    from matches m
    left join provider_counts pc on pc.match_id = m.match_id
    where m.date_key::date between current_date - 7 and current_date + 180
      and coalesce(pc.providers, 0) < 2
      and m.home_team_name is not null
      and m.away_team_name is not null
    order by m.date_key::date asc, coalesce(pc.providers, 0) asc
    limit 400
  `
);

const candidatesByDate = new Map();
for (const candidate of candidates) {
  const list = candidatesByDate.get(candidate.date_key) || [];
  list.push(candidate);
  candidatesByDate.set(candidate.date_key, list);
}

let fetchedDates = 0;
let fetchedEvents = 0;
let matchedFixtures = 0;
let sourceRecordsUpserted = 0;
let matchSourceRecordsUpserted = 0;
const fetchFailures = [];
const matchedRows = [];

for (const [dateKey, dateCandidates] of [...candidatesByDate.entries()].slice(0, maxDates)) {
  const url = `${baseUrl}/eventsday.php?d=${encodeURIComponent(dateKey)}&s=Soccer`;
  const feed = await fetchJson(url);
  fetchedDates += 1;
  if (!feed.ok) {
    fetchFailures.push({ dateKey, status: feed.status, error: feed.error || null });
    continue;
  }
  fetchedEvents += feed.events.length;

  for (const candidate of dateCandidates) {
    let best = null;
    for (const event of feed.events) {
      const result = matchesFixture(candidate, event);
      if (!result.matched) continue;
      if (!best || result.confidence > best.result.confidence) best = { event, result };
    }
    if (!best) continue;

    const sourceMatchId = String(best.event.idEvent || `${dateKey}-${best.event.strHomeTeam}-${best.event.strAwayTeam}`);
    const sourceRecordId = `thesportsdb_fixture_${digest(`${candidate.match_id}|${sourceMatchId}`)}`;
    const matchSourceRecordId = `msr_${digest(`${candidate.match_id}|${sourceRecordId}`)}`;
    const sourceUrl = best.event.idEvent ? `https://www.thesportsdb.com/event/${encodeURIComponent(best.event.idEvent)}` : null;
    const payload = {
      source: "TheSportsDB",
      sourceMatchId,
      dateKey,
      matchId: candidate.match_id,
      leagueName: candidate.league_name,
      homeTeam: best.event.strHomeTeam,
      awayTeam: best.event.strAwayTeam,
      homeScore: best.result.homeScore,
      awayScore: best.result.awayScore,
      confidence: best.result.confidence,
      raw: best.event,
    };

    await sql.query(
      `
        insert into source_records (
          source_record_id, provider, source_url, entity_type, entity_key, fetched_at,
          source_timestamp, content_hash, trust_score, payload
        )
        values ($1, 'thesportsdb-fixture-fallback', $2, 'fixture', $3, now(), null, $4, 0.68, $5::jsonb)
        on conflict (source_record_id) do update set
          source_url = excluded.source_url,
          fetched_at = excluded.fetched_at,
          content_hash = excluded.content_hash,
          trust_score = greatest(coalesce(source_records.trust_score, 0), excluded.trust_score),
          payload = excluded.payload
      `,
      [sourceRecordId, sourceUrl, candidate.match_id, digest(JSON.stringify(payload)), JSON.stringify(payload)]
    );
    sourceRecordsUpserted += 1;

    await sql.query(
      `
        insert into match_source_records (
          match_source_record_id, match_id, source_record_id, provider, source_match_id, is_primary, trust_score
        )
        values ($1, $2, $3, 'thesportsdb-fixture-fallback', $4, false, 0.68)
        on conflict (match_source_record_id) do update set
          provider = excluded.provider,
          source_match_id = excluded.source_match_id,
          trust_score = greatest(coalesce(match_source_records.trust_score, 0), excluded.trust_score),
          updated_at = now()
      `,
      [matchSourceRecordId, candidate.match_id, sourceRecordId, sourceMatchId]
    );
    matchSourceRecordsUpserted += 1;
    matchedFixtures += 1;
    matchedRows.push({
      dateKey,
      home: candidate.home_team_name,
      away: candidate.away_team_name,
      sourceHome: best.event.strHomeTeam,
      sourceAway: best.event.strAwayTeam,
      confidence: Number(best.result.confidence.toFixed(3)),
    });
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      candidates: candidates.length,
      fetchedDates,
      fetchedEvents,
      matchedFixtures,
      sourceRecordsUpserted,
      matchSourceRecordsUpserted,
      fetchFailures: fetchFailures.slice(0, 10),
      examples: matchedRows.slice(0, 10),
      durationMs: Date.now() - startedAt,
    },
    null,
    2
  )
);
