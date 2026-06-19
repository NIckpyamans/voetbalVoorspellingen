import fs from "fs";
import path from "path";
import { setCorsHeaders } from "../shared/cors.js";
import { fetchRepoJson, fetchServerStore } from "./_dataSource.js";

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

async function readStoredJson(relativePath: string, fallback: any) {
  const local = readJson(relativePath, null);
  if (local !== null) return local;
  try {
    return (await fetchRepoJson(relativePath)).data;
  } catch {
    return fallback;
  }
}

function queryTerms(query: string) {
  const aliases: Record<string, string[]> = {
    competitie: ["competition", "league", "season"],
    competities: ["competition", "league", "season"],
    seizoen: ["season"],
    seizoenen: ["season"],
    opgeslagen: ["planned", "active", "closed"],
    wedstrijd: ["match"],
    wedstrijden: ["match"],
    club: ["team"],
    clubs: ["team"],
    ploeg: ["team"],
    ploegen: ["team"],
    probleem: ["health"],
    problemen: ["health"],
    fout: ["health"],
    fouten: ["health"],
    storing: ["health", "provider"],
    storingen: ["health", "provider"],
    bron: ["source", "provider"],
    bronnen: ["source", "provider"],
  };
  const stopWords = new Set(["de", "het", "een", "en", "of", "op", "in", "van", "voor", "met", "welke", "wat", "zijn", "is"]);
  const base = normalize(query).split(" ").filter((term) => term.length > 1 && !stopWords.has(term));
  const knownTerms = Object.keys(aliases);
  return [...new Set(base.flatMap((term) => {
    const corrected = aliases[term]
      ? term
      : knownTerms.find((candidate) => candidate.length >= 4 && editDistance(term, candidate) <= 2);
    return [term, ...(corrected && corrected !== term ? [corrected] : []), ...(aliases[corrected || term] || [])];
  }))];
}

function editDistance(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= right.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
  }
  return rows[left.length][right.length];
}

function competitionItems(index: any) {
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

function matchItems(store: any) {
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

function teamItems(teams: any) {
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

function healthItems(findings: any) {
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

async function buildIndex() {
  if (cachedIndex && Date.now() - cachedAt < INDEX_TTL_MS) return cachedIndex;
  const [competitionIndex, teams, findings, store] = await Promise.all([
    readStoredJson("data/competitions/index.json", { competitions: [] }),
    readStoredJson("data/teams.json", {}),
    readStoredJson("monitor/daily-findings.json", { days: {} }),
    fetchServerStore().then((result) => result.store).catch(() => readJson("server_data.json", { matches: {} })),
  ]);
  cachedIndex = [
    ...competitionItems(competitionIndex),
    ...matchItems(store),
    ...teamItems(teams),
    ...healthItems(findings),
  ];
  cachedAt = Date.now();
  return cachedIndex;
}

function score(item: KnowledgeItem, terms: string[]) {
  const title = normalize(item.title);
  const haystack = normalize(`${item.title} ${item.subtitle} ${item.text} ${item.type}`);
  const words = [...new Set(haystack.split(" ").filter(Boolean))];
  return terms.reduce((total, term) => {
    const titleMatch = title.includes(term);
    const exactMatch = haystack.includes(term);
    const fuzzy = !exactMatch && term.length >= 4 && words.some((word) => Math.abs(word.length - term.length) <= 1 && editDistance(word, term) <= 1);
    return total + (titleMatch ? 8 : 0) + (exactMatch ? 2 : 0) + (fuzzy ? 1 : 0);
  }, 0);
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
  const terms = queryTerms(query);
  const results = (await buildIndex())
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
    recognizedTerms: terms,
    sources: [...new Set(results.slice(0, 8).map((item) => item.source))],
    results,
  });
}
