#!/usr/bin/env node

import { getApiFootballKey, getFootballDataApiKey } from "./provider-env.js";

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
      quota: quotaHeaders(response),
      errorCode: response.ok ? null : String(payload?.error_code || payload?.message || "provider_rejected_key").slice(0, 120),
    };
  } catch (error) {
    return { configured: true, valid: false, status: "request_failed", errorCode: error?.name || "request_failed" };
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

const report = {
  checkedAt: new Date().toISOString(),
  oddsApi: await auditOddsApi(),
  apiFootball: await auditApiFootball(),
  footballData: await auditFootballData(),
};
console.log(JSON.stringify(report, null, 2));

if (report.oddsApi.configured && !report.oddsApi.valid) process.exitCode = 2;
