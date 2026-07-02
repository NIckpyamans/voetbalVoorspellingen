import crypto from "crypto";
import { getSportmonksApiKey } from "./provider-env.js";

const fetchCache = new Map();
const DEFAULT_TIMEOUT_MS = Math.max(1000, Number(process.env.SPORTMONKS_FETCH_TIMEOUT_MS || 12000));

function digest(value, size = 24) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, size);
}

export function normalizeSportmonksTeam(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, " ")
    .replace(/\b(football club|futbol club|club de futbol|fc|afc|cf|sc|ssc|ac|as|calcio|club|stade|royal|de|la|the)\b/g, " ")
    .replace(/\butd\b/g, "united")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function teamSimilarity(left, right) {
  const a = normalizeSportmonksTeam(left);
  const b = normalizeSportmonksTeam(right);
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

function dateKey(value) {
  return String(value || "").slice(0, 10);
}

function addDays(key, days) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function participants(fixture) {
  const rows = asArray(fixture?.participants || fixture?.participant || fixture?.teams);
  const home =
    rows.find((item) => item?.meta?.location === "home") ||
    rows.find((item) => item?.location === "home") ||
    fixture?.localteam ||
    fixture?.home_team;
  const away =
    rows.find((item) => item?.meta?.location === "away") ||
    rows.find((item) => item?.location === "away") ||
    fixture?.visitorteam ||
    fixture?.away_team;
  const names = String(fixture?.name || "").split(/\s+vs\s+/i);
  return {
    home: home?.name || home?.team_name || names[0] || null,
    away: away?.name || away?.team_name || names[1] || null,
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "voetbalvoorspellingen-sportmonks-fixture-resolver/1.0" },
    });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFixturesForDateRange(startDate, endDate) {
  const key = getSportmonksApiKey();
  if (!key) return { ok: false, status: "missing_key", fixtures: [] };
  const cacheKey = `${startDate}|${endDate}`;
  if (fetchCache.has(cacheKey)) return fetchCache.get(cacheKey);
  const url = `https://api.sportmonks.com/v3/football/fixtures/between/${encodeURIComponent(startDate)}/${encodeURIComponent(endDate)}?api_token=${encodeURIComponent(key)}&include=participants&per_page=100`;
  const result = await fetchJson(url);
  const fixtures = Array.isArray(result.payload?.data) ? result.payload.data : [];
  const value = { ok: result.ok, status: result.status, fixtures, url };
  fetchCache.set(cacheKey, value);
  return value;
}

export async function findSportmonksFixture(match) {
  const kickoffDate = dateKey(match?.kickoff || match?.kickoff_at || match?.date_key);
  if (!kickoffDate || !match?.homeTeam || !match?.awayTeam) return null;
  const feed = await fetchFixturesForDateRange(addDays(kickoffDate, -1), addDays(kickoffDate, 1));
  if (!feed.ok) return { status: "provider_error", statusCode: feed.status, sourceUrl: feed.url };
  let best = null;
  for (const fixture of feed.fixtures) {
    const fixtureDate = dateKey(fixture?.starting_at);
    if (fixtureDate && Math.abs(Date.parse(`${fixtureDate}T00:00:00Z`) - Date.parse(`${kickoffDate}T00:00:00Z`)) > 86400000) continue;
    const teams = participants(fixture);
    const homeScore = teamSimilarity(match.homeTeam, teams.home);
    const awayScore = teamSimilarity(match.awayTeam, teams.away);
    const reversedHomeScore = teamSimilarity(match.homeTeam, teams.away);
    const reversedAwayScore = teamSimilarity(match.awayTeam, teams.home);
    const direct = Math.min(homeScore, awayScore);
    const reversed = Math.min(reversedHomeScore, reversedAwayScore);
    const score = Math.max(direct, reversed);
    if (score < 0.82) continue;
    if (!best || score > best.confidence) {
      best = {
        status: "matched",
        fixtureId: String(fixture.id),
        confidence: score,
        reversed: reversed > direct,
        homeName: teams.home,
        awayName: teams.away,
        startingAt: fixture.starting_at || null,
        hasOdds: Boolean(fixture.has_odds || fixture.has_premium_odds),
        raw: fixture,
        sourceUrl: feed.url,
      };
    }
  }
  return best || { status: "not_found", checkedFixtures: feed.fixtures.length, sourceUrl: feed.url };
}

export async function getStoredSportmonksFixtureId(sql, matchId) {
  if (!sql || !matchId) return null;
  const [row] = await sql.query(
    `select source_match_id
     from fixture_source_aliases
     where canonical_match_id=$1 and provider='sportmonks'
     order by updated_at desc
     limit 1`,
    [String(matchId)]
  );
  return row?.source_match_id ? String(row.source_match_id) : null;
}

export async function storeSportmonksFixtureAlias(sql, match, resolved) {
  if (!sql || !match?.matchId || !resolved?.fixtureId) return false;
  const sourceRecordId = `sportmonks_fixture_${digest(`${match.matchId}|${resolved.fixtureId}`)}`;
  const aliasId = `fixture_alias_${digest(`sportmonks|${resolved.fixtureId}`)}`;
  const matchSourceRecordId = `msr_${digest(`${match.matchId}|${sourceRecordId}`)}`;
  const canonicalFixtureId = String(match.canonicalFixtureId || match.matchId);
  const payload = {
    source: "Sportmonks",
    sourceMatchId: resolved.fixtureId,
    matchId: match.matchId,
    homeTeam: resolved.homeName,
    awayTeam: resolved.awayName,
    startingAt: resolved.startingAt,
    confidence: resolved.confidence,
    hasOdds: resolved.hasOdds,
    raw: resolved.raw,
  };
  await sql.query(
    `insert into source_records (
       source_record_id, provider, source_url, entity_type, entity_key, fetched_at,
       source_timestamp, content_hash, trust_score, payload
     )
     values ($1,'sportmonks',$2,'fixture',$3,now(),$4,$5,0.82,$6::jsonb)
     on conflict (source_record_id) do update set
       source_url=excluded.source_url,
       fetched_at=excluded.fetched_at,
       source_timestamp=excluded.source_timestamp,
       content_hash=excluded.content_hash,
       trust_score=greatest(coalesce(source_records.trust_score,0), excluded.trust_score),
       payload=excluded.payload`,
    [
      sourceRecordId,
      resolved.sourceUrl || null,
      String(match.matchId),
      resolved.startingAt || null,
      digest(JSON.stringify(payload), 40),
      JSON.stringify(payload),
    ]
  );
  await sql.query(
    `insert into match_source_records (
       match_source_record_id, match_id, source_record_id, provider, source_match_id, is_primary, trust_score
     )
     values ($1,$2,$3,'sportmonks',$4,false,0.82)
     on conflict (match_source_record_id) do update set
       source_match_id=excluded.source_match_id,
       trust_score=greatest(coalesce(match_source_records.trust_score,0), excluded.trust_score),
       updated_at=now()`,
    [matchSourceRecordId, String(match.matchId), sourceRecordId, resolved.fixtureId]
  );
  await sql.query(
    `insert into fixture_source_aliases (
       fixture_source_alias_id, canonical_fixture_id, canonical_match_id, source_match_id, provider, source_payload
     )
     values ($1,$2,$3,$4,'sportmonks',$5::jsonb)
     on conflict (provider, source_match_id) do update set
       canonical_fixture_id=excluded.canonical_fixture_id,
       canonical_match_id=excluded.canonical_match_id,
       source_payload=excluded.source_payload,
       updated_at=now()`,
    [aliasId, canonicalFixtureId, String(match.matchId), resolved.fixtureId, JSON.stringify(payload)]
  );
  return true;
}

export async function resolveSportmonksFixtureId(sql, match) {
  const existing = await getStoredSportmonksFixtureId(sql, match?.matchId);
  if (existing) return { fixtureId: existing, status: "stored" };
  const resolved = await findSportmonksFixture(match);
  if (resolved?.fixtureId) {
    await storeSportmonksFixtureAlias(sql, match, resolved);
    return resolved;
  }
  return resolved;
}
