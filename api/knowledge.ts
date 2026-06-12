import fs from "fs";
import path from "path";
import { setCorsHeaders } from "../shared/cors.js";

type KnowledgeItem = {
  id: string;
  type: "competition" | "match" | "team" | "health";
  title: string;
  subtitle: string;
  text: string;
  source: string;
  date?: string | null;
};

const ROOT = process.cwd();
const MAX_RESULTS = 30;
const INDEX_TTL_MS = 5 * 60_000;
let cachedIndex: KnowledgeItem[] | null = null;
let cachedAt = 0;

function readJson(relativePath: string, fallback: any) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, ...relativePath.split("/")), "utf8"));
  } catch {
    return fallback;
  }
}

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function competitionItems() {
  const index = readJson("data/competitions/index.json", { competitions: [] });
  return (index.competitions || []).map((item: any): KnowledgeItem => ({
    id: item.key,
    type: "competition",
    title: item.league,
    subtitle: `${item.season} · ${item.status} · ${item.totalMatches || 0} wedstrijden`,
    text: `${item.league} ${item.season} ${item.status} ${item.teamCount || 0} teams`,
    source: item.archiveFile || "data/competitions/index.json",
    date: item.lastMatchDate || null,
  }));
}

function matchItems() {
  const store = readJson("server_data.json", { matches: {} });
  const rows: KnowledgeItem[] = [];
  for (const [date, matches] of Object.entries(store.matches || {})) {
    for (const match of (matches as any[]).slice(0, 400)) {
      rows.push({
        id: String(match.id || `${date}-${match.homeTeamName}-${match.awayTeamName}`),
        type: "match",
        title: `${match.homeTeamName || "Thuis"} - ${match.awayTeamName || "Uit"}`,
        subtitle: `${match.league || "Competitie onbekend"} · ${date} · ${match.status || "onbekend"}`,
        text: [
          match.homeTeamName,
          match.awayTeamName,
          match.league,
          match.status,
          match.score,
          match.minute,
          match.h2h?.played ? `h2h ${match.h2h.played}` : "h2h leeg",
        ].join(" "),
        source: `data/days/${date}.json`,
        date,
      });
    }
  }
  return rows.slice(-5000);
}

function teamItems() {
  const teams = readJson("data/teams.json", {});
  const rows = Array.isArray(teams) ? teams : Object.values(teams || {});
  return rows.slice(0, 3000).map((team: any, index: number): KnowledgeItem => ({
    id: String(team.id || team.teamId || team.name || index),
    type: "team",
    title: String(team.name || team.teamName || "Onbekend team"),
    subtitle: String(team.league || team.country || "Teamprofiel"),
    text: JSON.stringify(team).slice(0, 1500),
    source: "data/teams.json",
  }));
}

function healthItems() {
  const findings = readJson("monitor/daily-findings.json", { days: {} });
  const dates = Object.keys(findings.days || {}).sort();
  const latestDate = dates.at(-1);
  const latest = latestDate ? findings.days[latestDate]?.runs?.at(-1) : null;
  return (latest?.issues || []).map((issue: any, index: number): KnowledgeItem => ({
    id: `${latestDate}-${issue.key}-${index}`,
    type: "health",
    title: issue.message,
    subtitle: `${issue.severity || "unknown"} · ${issue.key}`,
    text: `${issue.key} ${issue.message} ${JSON.stringify(issue.details || {})}`,
    source: "monitor/daily-findings.json",
    date: latestDate || null,
  }));
}

function buildIndex() {
  if (cachedIndex && Date.now() - cachedAt < INDEX_TTL_MS) return cachedIndex;
  cachedIndex = [...competitionItems(), ...matchItems(), ...teamItems(), ...healthItems()];
  cachedAt = Date.now();
  return cachedIndex;
}

function score(item: KnowledgeItem, terms: string[]) {
  const title = normalize(item.title);
  const haystack = normalize(`${item.title} ${item.subtitle} ${item.text} ${item.type}`);
  return terms.reduce((total, term) => total + (title.includes(term) ? 8 : 0) + (haystack.includes(term) ? 2 : 0), 0);
}

function answerFor(query: string, results: KnowledgeItem[], generatedAt: string) {
  const normalized = normalize(query);
  if (!results.length) return `Ik vond geen brongebonden FootyAI-data voor "${query}". Controleer de spelling of zoek op club, competitie, datum of health-signaal.`;
  if (normalized.includes("health") || normalized.includes("gezond") || normalized.includes("fout") || normalized.includes("probleem")) {
    const health = results.filter((item) => item.type === "health");
    return health.length
      ? `Er zijn ${health.length} relevante health-signalen gevonden. Het belangrijkste signaal is: ${health[0].title}`
      : `Er zijn geen passende health-signalen gevonden. De zoekresultaten komen vooral uit ${results[0].type}-data.`;
  }
  if (normalized.includes("competitie") || normalized.includes("seizoen")) {
    const competitions = results.filter((item) => item.type === "competition");
    if (competitions.length) return `Ik vond ${competitions.length} passende competitiearchieven. De beste match is ${competitions[0].title}: ${competitions[0].subtitle}.`;
  }
  return `Ik vond ${results.length} relevante items. De beste match is ${results[0].title}: ${results[0].subtitle}. Antwoord gegenereerd uit read-only FootyAI-bronnen op ${generatedAt}.`;
}

async function answerWithOllama(query: string, results: KnowledgeItem[]) {
  if (String(process.env.FOOTYAI_OLLAMA_ENABLED || "").toLowerCase() !== "true") return null;
  const evidence = results.slice(0, 10).map((item, index) => ({
    sourceNumber: index + 1,
    type: item.type,
    title: item.title,
    subtitle: item.subtitle,
    source: item.source,
    date: item.date || null,
    excerpt: item.text.slice(0, 500),
  }));
  const baseUrl = String(process.env.FOOTYAI_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_500);
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: process.env.FOOTYAI_OLLAMA_MODEL || process.env.OLLAMA_MODEL || "llama3.2:3b",
      stream: false,
      prompt: [
        "Je bent de gratis read-only FootyAI-assistent.",
        "Gebruik uitsluitend het bewijs hieronder. Noem bronnummers tussen blokhaken.",
        "Zeg duidelijk wanneer bewijs ontbreekt. Voer nooit wijzigingen uit.",
        JSON.stringify({ question: query, evidence }),
      ].join("\n"),
      options: { temperature: 0.2, num_predict: 350 },
    }),
  });
  clearTimeout(timeout);
  if (!response.ok) throw new Error(`ollama_${response.status}`);
  const payload = await response.json();
  const answer = String(payload?.response || "").trim();
  return answer ? { answer, model: payload?.model || process.env.FOOTYAI_OLLAMA_MODEL || "local" } : null;
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(req, res, { methods: "GET, OPTIONS" });
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const query = String(req.query?.q || "").trim().slice(0, 240);
  if (query.length < 2) return res.status(400).json({ ok: false, error: "query_too_short" });
  const generatedAt = new Date().toISOString();
  const terms = normalize(query).split(" ").filter((term) => term.length > 1);
  const results = buildIndex()
    .map((item) => ({ ...item, score: score(item, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, MAX_RESULTS);
  const useModel = String(req.query?.ai || "") === "1";
  let modelAnswer: any = null;
  if (useModel && results.length) {
    try {
      modelAnswer = await answerWithOllama(query, results);
    } catch (error: any) {
      console.warn(JSON.stringify({ event: "footyai_ollama_unavailable", error: error?.message || String(error) }));
    }
  }

  return res.status(200).json({
    ok: true,
    readOnly: true,
    query,
    generatedAt,
    answer: modelAnswer?.answer || answerFor(query, results, generatedAt),
    answerMode: modelAnswer?.answer ? "ollama_local_read_only" : "deterministic_read_only",
    model: modelAnswer?.model || null,
    freeMode: true,
    sources: [...new Set(results.slice(0, 8).map((item) => item.source))],
    results,
  });
}
