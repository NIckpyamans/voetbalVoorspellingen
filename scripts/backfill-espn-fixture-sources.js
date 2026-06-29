#!/usr/bin/env node

import crypto from "crypto";
import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

const startedAt = Date.now();
const maxFixtures = Math.max(20, Number(process.env.ESPN_FIXTURE_BACKFILL_LIMIT || 700));
const maxRequests = Math.max(5, Number(process.env.ESPN_FIXTURE_BACKFILL_REQUESTS || 160));

const ESPN_SCOREBOARD_LEAGUES = {
  "Belgium - Pro League": "bel.1",
  "England - Championship": "eng.2",
  "England - Premier League": "eng.1",
  "Europe - Champions League": "uefa.champions",
  "Europe - Conference League": "uefa.europa.conf",
  "Europe - Europa League": "uefa.europa",
  "France - Ligue 1": "fra.1",
  "Germany - Bundesliga": "ger.1",
  "Italy - Serie A": "ita.1",
  "Netherlands - Eredivisie": "ned.1",
  "Portugal - Liga Portugal": "por.1",
  "Spain - LaLiga": "esp.1",
  "World - Club Friendlies": "club.friendly",
};

function digest(value, size = 24) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, size);
}

const TEAM_EQUIVALENTS = new Map(Object.entries({
  "ath madrid": "atletico madrid",
  "atletico de madrid": "atletico madrid",
  "fc barcelona": "barcelona",
  "bayern munchen": "bayern munich",
  "fc bayern munchen": "bayern munich",
  "m gladbach": "borussia monchengladbach",
  "monchengladbach": "borussia monchengladbach",
  "psg": "paris saint germain",
  "paris sg": "paris saint germain",
  "sp lisbon": "sporting lisbon",
  "sporting cp": "sporting lisbon",
  "sporting clube de portugal": "sporting lisbon",
  "sl benfica": "benfica",
  "fc porto": "porto",
  "sp braga": "braga",
  "sporting braga": "braga",
  "vitoria guimaraes": "guimaraes",
  "vitoria sc": "guimaraes",
  "gil vicente fc": "gil vicente",
  "rio ave fc": "rio ave",
  "fc famalicao": "famalicao",
  "cf estrela amadora": "estrela",
  "estrela amadora": "estrela",
  "avs futebol sad": "avs",
  "cd nacional": "nacional",
  "cd santa clara": "santa clara",
  "gd estoril praia": "estoril",
  "estoril praia": "estoril",
  "stade brestois": "brest",
  "stade brestois 29": "brest",
  "stade rennais": "rennes",
  "stade rennais 1901": "rennes",
  "olympique lyonnais": "lyon",
  "olympique de marseille": "marseille",
  "rc strasbourg": "strasbourg",
}));

function normalizeTeam(value) {
  const raw = String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, " ")
    .replace(/\b(football club|futbol club|club de futbol|de futbol|fc|afc|cf|sc|ssc|ac|as|calcio|club|stade|olympique|royal|koninklijke|de|la|the)\b/g, " ")
    .replace(/\b(19|18|20)?\d{2}\b/g, " ")
    .replace(/\butd\b/g, "united")
    .replace(/\bmunchen\b/g, "munich")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return TEAM_EQUIVALENTS.get(raw) || raw;
}

function similarity(left, right) {
  const a = normalizeTeam(left);
  const b = normalizeTeam(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 5 && b.includes(a)) return 0.94;
  if (b.length >= 5 && a.includes(b)) return 0.94;
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size || 1;
  const containment = intersection / Math.min(aTokens.size || 1, bTokens.size || 1);
  return Math.max(intersection / union, containment >= 0.8 ? 0.9 : containment * 0.88);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "voetbalvoorspellingen-espn-backfill/1.0" },
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

function yyyymmdd(value) {
  return String(value || "").slice(0, 10).replace(/-/g, "");
}

function eventTeams(event) {
  const competitors = event?.competitions?.[0]?.competitors || [];
  const home = competitors.find((item) => item.homeAway === "home") || {};
  const away = competitors.find((item) => item.homeAway === "away") || {};
  return {
    homeName: home.team?.displayName || home.team?.shortDisplayName || home.team?.name || "",
    awayName: away.team?.displayName || away.team?.shortDisplayName || away.team?.name || "",
    sourceMatchId: String(event?.id || event?.uid || `${event?.date || ""}-${home.team?.displayName || ""}-${away.team?.displayName || ""}`),
    raw: event,
  };
}

const candidates = await sql.query(
  `
    with alias_map as (
      select distinct
        nullif(source_payload->>'originalMatchId', '') as match_id,
        canonical_fixture_id as fixture_id
      from fixture_source_aliases
      where nullif(source_payload->>'originalMatchId', '') is not null
    ), scoped as (
      select
        m.match_id,
        coalesce(a.fixture_id, m.canonical_fixture_id, m.match_id) as fixture_id,
        m.date_key::text as date_key,
        coalesce(nullif(m.league, ''), 'Unknown') as league,
        m.home_team_name,
        m.away_team_name
      from matches m
      left join alias_map a on a.match_id = m.match_id
      where m.date_key::date between current_date - 90 and current_date + 180
        and m.home_team_name is not null
        and m.away_team_name is not null
    ), expanded as (
      select s.fixture_id, trim(provider_part) as provider
      from scoped s
      left join match_source_records msr on msr.match_id = s.match_id
      left join lateral unnest(string_to_array(msr.provider, '+')) provider_part on true
    ), counts as (
      select fixture_id, count(distinct provider) filter (where provider is not null and provider <> '')::int as providers
      from expanded
      group by fixture_id
    ), reps as (
      select distinct on (s.fixture_id)
        s.*
      from scoped s
      join counts c on c.fixture_id = s.fixture_id
      where c.providers < 2
      order by s.fixture_id, s.match_id
    )
    select *
    from reps
    where league = any($1::text[])
    order by date_key asc, league asc, match_id asc
    limit $2
  `,
  [Object.keys(ESPN_SCOREBOARD_LEAGUES), maxFixtures]
);

const byRequest = new Map();
for (const candidate of candidates) {
  const code = ESPN_SCOREBOARD_LEAGUES[candidate.league];
  if (!code) continue;
  const key = `${candidate.date_key}|${candidate.league}|${code}`;
  const list = byRequest.get(key) || [];
  list.push(candidate);
  byRequest.set(key, list);
}

let fetchedRequests = 0;
let fetchedEvents = 0;
let matchedFixtures = 0;
const failures = [];
const examples = [];

for (const [key, requestCandidates] of [...byRequest.entries()].slice(0, maxRequests)) {
  const [dateKey, league, code] = key.split("|");
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(code)}/scoreboard?dates=${yyyymmdd(dateKey)}`;
  const feed = await fetchJson(url);
  fetchedRequests += 1;
  if (!feed.ok) {
    failures.push({ dateKey, league, code, status: feed.status, error: feed.error || null });
    continue;
  }
  fetchedEvents += feed.events.length;
  const events = feed.events.map(eventTeams).filter((event) => event.homeName && event.awayName);

  for (const candidate of requestCandidates) {
    let best = null;
    for (const event of events) {
      const homeScore = similarity(candidate.home_team_name, event.homeName);
      const awayScore = similarity(candidate.away_team_name, event.awayName);
      const score = Math.min(homeScore, awayScore);
      if (homeScore < 0.84 || awayScore < 0.84 || (homeScore + awayScore) / 2 < 0.88) continue;
      if (!best || score > best.score) best = { event, score, homeScore, awayScore };
    }
    if (!best) continue;

    const sourceRecordId = `espn_fixture_${digest(`${candidate.match_id}|${best.event.sourceMatchId}`)}`;
    const matchSourceRecordId = `msr_${digest(`${candidate.match_id}|${sourceRecordId}`)}`;
    const payload = {
      source: "ESPN Scoreboard",
      sourceMatchId: best.event.sourceMatchId,
      matchId: candidate.match_id,
      dateKey,
      league,
      homeTeam: best.event.homeName,
      awayTeam: best.event.awayName,
      homeScore: best.homeScore,
      awayScore: best.awayScore,
      confidence: best.score,
      raw: best.event.raw,
    };

    await sql.query(
      `
        insert into source_records (
          source_record_id, provider, source_url, entity_type, entity_key, fetched_at,
          source_timestamp, content_hash, trust_score, payload
        )
        values ($1, 'espn-scoreboard-fallback', $2, 'fixture', $3, now(), null, $4, 0.72, $5::jsonb)
        on conflict (source_record_id) do update set
          source_url = excluded.source_url,
          fetched_at = excluded.fetched_at,
          content_hash = excluded.content_hash,
          trust_score = greatest(coalesce(source_records.trust_score, 0), excluded.trust_score),
          payload = excluded.payload
      `,
      [sourceRecordId, url, candidate.match_id, digest(JSON.stringify(payload), 40), JSON.stringify(payload)]
    );

    await sql.query(
      `
        insert into match_source_records (
          match_source_record_id, match_id, source_record_id, provider, source_match_id, is_primary, trust_score
        )
        values ($1, $2, $3, 'espn-scoreboard-fallback', $4, false, 0.72)
        on conflict (match_source_record_id) do update set
          provider = excluded.provider,
          source_match_id = excluded.source_match_id,
          trust_score = greatest(coalesce(match_source_records.trust_score, 0), excluded.trust_score),
          updated_at = now()
      `,
      [matchSourceRecordId, candidate.match_id, sourceRecordId, best.event.sourceMatchId]
    );

    matchedFixtures += 1;
    if (examples.length < 20) {
      examples.push({
        dateKey,
        league,
        home: candidate.home_team_name,
        away: candidate.away_team_name,
        sourceHome: best.event.homeName,
        sourceAway: best.event.awayName,
        confidence: Number(best.score.toFixed(3)),
      });
    }
  }
}

console.log(JSON.stringify({
  ok: true,
  candidates: candidates.length,
  requestBuckets: byRequest.size,
  fetchedRequests,
  fetchedEvents,
  matchedFixtures,
  failures: failures.slice(0, 15),
  examples,
  durationMs: Date.now() - startedAt,
}, null, 2));
