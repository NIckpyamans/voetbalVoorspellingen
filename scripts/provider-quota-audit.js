#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getApiFootballKey, getFootballDataApiKey, getSportmonksApiKey } from "./provider-env.js";

const timeoutMs = 12_000;

function quotaHeaders(response) {
  const names = [
    "x-requests-remaining",
    "x-requests-used",
    "x-requests-last",
    "x-ratelimit-requests-limit",
    "x-ratelimit-requests-remaining",
    "x-requestcounter-reset",
    "x-requests-available-minute",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "retry-after",
  ];
  return Object.fromEntries(names.map((name) => [name, response.headers.get(name)]).filter(([, value]) => value !== null));
}

async function requestJson(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function auditOddsApi() {
  const key = String(process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || "").trim();
  if (!key) return { configured: false, valid: false, status: "missing" };
  try {
    const { response, payload } = await requestJson(
      `https://api.the-odds-api.com/v4/sports?apiKey=${encodeURIComponent(key)}`
    );
    return {
      configured: true,
      valid: response.ok,
      status: response.status,
      activeSports: Array.isArray(payload) ? payload.filter((sport) => sport?.active !== false).length : 0,
      soccerSportKeys: Array.isArray(payload)
        ? payload.filter((sport) => String(sport?.key || "").startsWith("soccer_")).map((sport) => sport.key)
        : [],
      quota: quotaHeaders(response),
      errorCode: response.ok ? null : String(payload?.error_code || payload?.message || "provider_rejected_key").slice(0, 120),
    };
  } catch (error) {
    return { configured: true, valid: false, status: "request_failed", errorCode: error?.name || "request_failed" };
  }
}

async function probeClubOdds() {
  if (String(process.env.ODDS_PROBE || "false").toLowerCase() !== "true") return { enabled: false };
  const key = String(process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || "").trim();
  if (!key) return { enabled: true, valid: false, status: "missing_key" };
  try {
    const url = new URL("https://api.the-odds-api.com/v4/sports/soccer_epl/odds/");
    url.searchParams.set("apiKey", key);
    url.searchParams.set("regions", "eu");
    url.searchParams.set("markets", "h2h");
    url.searchParams.set("oddsFormat", "decimal");
    const { response, payload } = await requestJson(url);
    const events = Array.isArray(payload) ? payload : [];
    return {
      enabled: true,
      valid: response.ok,
      status: response.status,
      events: events.length,
      bookmakerEvents: events.filter((event) => Array.isArray(event?.bookmakers) && event.bookmakers.length > 0).length,
      dateRange: events.length
        ? {
            first: events.map((event) => event.commence_time).filter(Boolean).sort()[0] || null,
            last: events.map((event) => event.commence_time).filter(Boolean).sort().at(-1) || null,
          }
        : null,
      sampleMatches: events.slice(0, 12).map((event) => `${event.home_team} - ${event.away_team}`),
      quota: quotaHeaders(response),
    };
  } catch (error) {
    return { enabled: true, valid: false, status: "request_failed", errorCode: error?.name || "request_failed" };
  }
}

async function auditApiFootball() {
  const key = getApiFootballKey();
  if (!key) return { configured: false, valid: false, status: "missing" };
  try {
    const { response, payload } = await requestJson("https://v3.football.api-sports.io/status", {
      "x-apisports-key": key,
    });
    const details = payload?.response || {};
    const current = Number(details?.requests?.current || 0);
    const limit = Number(details?.requests?.limit_day || 0);
    const remaining = limit > 0 ? Math.max(0, limit - current) : null;
    const reserve = limit > 0 ? Math.max(10, Math.ceil(limit * 0.1)) : null;
    return {
      configured: true,
      valid: response.ok && !payload?.errors?.token,
      status: response.status,
      plan: details?.subscription?.plan || null,
      subscriptionEndsAt: details?.subscription?.end || null,
      requests: { current, limitPerDay: limit, remaining, reserve },
      quota: quotaHeaders(response),
    };
  } catch (error) {
    return { configured: true, valid: false, status: "request_failed", errorCode: error?.name || "request_failed" };
  }
}

async function auditFootballData() {
  const key = getFootballDataApiKey();
  if (!key) return { configured: false, valid: false, status: "missing" };
  try {
    const { response, payload } = await requestJson("https://api.football-data.org/v4/competitions", {
      "X-Auth-Token": key,
    });
    return {
      configured: true,
      valid: response.ok,
      status: response.status,
      competitions: Array.isArray(payload?.competitions) ? payload.competitions.length : 0,
      quota: quotaHeaders(response),
    };
  } catch (error) {
    return { configured: true, valid: false, status: "request_failed", errorCode: error?.name || "request_failed" };
  }
}

function sportmonksRateLimitFromPayload(payload) {
  return payload?.rate_limit || payload?.meta?.rate_limit || payload?.meta?.pagination?.rate_limit || null;
}

function compactSportmonksStatus(response, payload) {
  return {
    valid: response.ok && !payload?.message?.toLowerCase?.().includes("unauthenticated"),
    status: response.status,
    records: Array.isArray(payload?.data) ? payload.data.length : 0,
    firstId: Array.isArray(payload?.data) ? payload.data.find((item) => item?.id)?.id || null : payload?.data?.id || null,
    firstName: Array.isArray(payload?.data)
      ? payload.data.find((item) => item?.name)?.name || null
      : payload?.data?.name || payload?.data?.fixture?.name || null,
    hasOddsFlag: Array.isArray(payload?.data)
      ? payload.data.some((item) => item?.has_odds || item?.has_premium_odds)
      : Boolean(payload?.data?.has_odds || payload?.data?.has_premium_odds),
    rateLimit: sportmonksRateLimitFromPayload(payload),
    quota: quotaHeaders(response),
    errorCode: response.ok ? null : String(payload?.message || payload?.error || "provider_rejected_endpoint").slice(0, 160),
  };
}

async function auditSportmonksEndpoint(label, url) {
  try {
    const { response, payload } = await requestJson(url);
    return {
      label,
      ...compactSportmonksStatus(response, payload),
    };
  } catch (error) {
    return {
      label,
      valid: false,
      status: "request_failed",
      errorCode: error?.name || "request_failed",
    };
  }
}

function firstSportmonksFixtureId(...payloads) {
  for (const payload of payloads) {
    const rows = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
    const fixture = rows.find((item) => item?.id && (item?.has_odds || item?.has_premium_odds)) || rows.find((item) => item?.id);
    if (fixture?.id) return fixture.id;
  }
  return null;
}

async function auditSportmonks() {
  const key = getSportmonksApiKey();
  if (!key) return { configured: false, valid: false, status: "missing" };
  try {
    const encodedKey = encodeURIComponent(key);
    const today = new Date().toISOString().slice(0, 10);
    const leaguesResult = await requestJson(`https://api.sportmonks.com/v3/football/leagues?api_token=${encodedKey}&per_page=1`);
    const allFixturesResult = await requestJson(
      `https://api.sportmonks.com/v3/football/fixtures?api_token=${encodedKey}&include=participants&per_page=1`
    );
    const fixturesDateResult = await requestJson(
      `https://api.sportmonks.com/v3/football/fixtures/date/${today}?api_token=${encodedKey}&include=participants&per_page=1`
    );
    const upcomingMarketResult = await requestJson(
      `https://api.sportmonks.com/v3/football/fixtures/upcoming/markets/1?api_token=${encodedKey}&include=participants&per_page=1`
    );
    const fixtureId = firstSportmonksFixtureId(fixturesDateResult.payload, upcomingMarketResult.payload, allFixturesResult.payload);
    const documentedSampleFixtureId = 18535517;
    const oddsByFixture = fixtureId
      ? await auditSportmonksEndpoint(
          "oddsByFixture",
          `https://api.sportmonks.com/v3/football/odds/pre-match/fixtures/${fixtureId}?api_token=${encodedKey}&filters=markets:1;bookmakers:2&per_page=1`
        )
      : { label: "oddsByFixture", valid: false, status: "skipped", errorCode: "no_fixture_id_found" };
    const oddsByDocumentedSample = await auditSportmonksEndpoint(
      "oddsByDocumentedSample",
      `https://api.sportmonks.com/v3/football/odds/pre-match/fixtures/${documentedSampleFixtureId}?api_token=${encodedKey}&filters=markets:1;bookmakers:2&per_page=1`
    );
    const oddsByFixtureMarket = fixtureId
      ? await auditSportmonksEndpoint(
          "oddsByFixtureMarket",
          `https://api.sportmonks.com/v3/football/odds/pre-match/fixtures/${fixtureId}/markets/1?api_token=${encodedKey}&filters=bookmakers:2&per_page=1`
        )
      : { label: "oddsByFixtureMarket", valid: false, status: "skipped", errorCode: "no_fixture_id_found" };
    const response = leaguesResult.response;
    const payload = leaguesResult.payload;
    const rateLimit = sportmonksRateLimitFromPayload(payload);
    return {
      configured: true,
      valid: response.ok && !payload?.message?.toLowerCase?.().includes("unauthenticated"),
      status: response.status,
      records: Array.isArray(payload?.data) ? payload.data.length : 0,
      rateLimit,
      quota: quotaHeaders(response),
      endpointAccess: {
        leagues: compactSportmonksStatus(leaguesResult.response, leaguesResult.payload),
        allFixtures: compactSportmonksStatus(allFixturesResult.response, allFixturesResult.payload),
        fixturesDate: compactSportmonksStatus(fixturesDateResult.response, fixturesDateResult.payload),
        upcomingMarket: compactSportmonksStatus(upcomingMarketResult.response, upcomingMarketResult.payload),
        testedFixtureId: fixtureId,
        oddsByFixture,
        documentedSampleFixtureId,
        oddsByDocumentedSample,
        oddsByFixtureMarket,
      },
      documentedPlanLimitsPerEntityPerHour: {
        starter: 2000,
        pro: 2500,
        growth: 3000,
        enterprise: 5000,
      },
      documentedStrategy: "Sportmonks limieten zijn per entity per uur. Gebruik includes en cache reference data om calls te beperken.",
      errorCode: response.ok ? null : String(payload?.message || payload?.error || "provider_rejected_key").slice(0, 120),
    };
  } catch (error) {
    return { configured: true, valid: false, status: "request_failed", errorCode: error?.name || "request_failed" };
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  oddsApi: await auditOddsApi(),
  clubOddsProbe: await probeClubOdds(),
  apiFootball: await auditApiFootball(),
  footballData: await auditFootballData(),
  sportmonks: await auditSportmonks(),
};
fs.mkdirSync(path.join(process.cwd(), "monitor"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "monitor", "provider-quota-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (String(process.env.PROVIDER_AUDIT_STRICT || "false").toLowerCase() === "true" && report.oddsApi.configured && !report.oddsApi.valid) {
  process.exitCode = 2;
}
