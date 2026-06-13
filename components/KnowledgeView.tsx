import React, { FormEvent, useEffect, useState } from "react";

const EXAMPLES = [
  "Welke competities zijn opgeslagen?",
  "Welke health problemen zijn bekend?",
  "Zoek Ajax",
  "Zoek wedstrijden op 2026-05-24",
];
const HISTORY_KEY = "footyai_knowledge_history_v1";
const HISTORY_LIMIT = 100;

function readHistory() {
  try {
    const rows = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(rows) ? rows.slice(-HISTORY_LIMIT).reverse() : [];
  } catch {
    return [];
  }
}

const KnowledgeView: React.FC = () => {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setHistory(readHistory()), []);

  const saveHistory = (payload: any) => {
    const chronological = readHistory().reverse();
    chronological.push({
      id: `${Date.now()}-${payload.query}`,
      query: payload.query,
      answer: payload.answer,
      answerMode: payload.answerMode,
      model: payload.model || null,
      generatedAt: payload.generatedAt,
      sources: payload.sources || [],
    });
    const compact = chronological.slice(-HISTORY_LIMIT);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(compact));
    setHistory(compact.slice().reverse());
  };

  const exportHistory = () => {
    const blob = new Blob([JSON.stringify(history.slice().reverse(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `footyai-vraaggeschiedenis-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const search = async (event?: FormEvent, directQuery?: string) => {
    event?.preventDefault();
    const nextQuery = String(directQuery || query).trim();
    if (nextQuery.length < 2) return;
    setQuery(nextQuery);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/knowledge?ai=1&q=${encodeURIComponent(nextQuery)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true || !payload.answer || !payload.generatedAt) {
        throw new Error(payload.error || "Kennis-API niet beschikbaar. Gebruik lokaal `vercel dev` om API-routes mee te starten.");
      }
      setData(payload);
      saveHistory(payload);
    } catch (nextError: any) {
      setError(nextError.message || "Zoeken mislukt");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,.16),transparent_42%),linear-gradient(135deg,rgba(2,6,23,.98),rgba(15,23,42,.88))] p-6">
        <div className="text-[10px] font-black uppercase tracking-[.28em] text-cyan-300">Gratis read-only kennislaag</div>
        <h2 className="mt-2 text-3xl font-black text-white">Zoeken & Vraag FootyAI</h2>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-400">
          Werkt zonder betaalde API. Antwoorden tonen hun bron; je vraaggeschiedenis blijft lokaal op dit apparaat bewaard.
        </p>
        <form onSubmit={search} className="mt-5 flex flex-col gap-2 md:flex-row">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Bijvoorbeeld: welke wedstrijden missen H2H?" className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/50" />
          <button className="rounded-2xl bg-cyan-500 px-5 py-3 text-xs font-black uppercase text-slate-950 hover:bg-cyan-300" disabled={loading}>{loading ? "Zoeken..." : "Vraag FootyAI"}</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => <button key={example} onClick={() => search(undefined, example)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[9px] font-bold text-slate-300 hover:border-cyan-400/30">{example}</button>)}
        </div>
      </section>

      {error && <div className="rounded-2xl border border-red-500/20 bg-red-950/20 p-4 text-sm text-red-200">{error}</div>}
      {data && (
        <>
          <section className="glass-card rounded-3xl border border-emerald-400/15 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-black uppercase text-emerald-200">Brongebonden antwoord</h3>
              <span className="text-[9px] text-slate-500">{new Date(data.generatedAt).toLocaleString("nl-NL")}</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-200">{data.answer}</p>
            <div className="mt-3 text-[9px] font-bold uppercase tracking-wider text-slate-500">
              {data.answerMode === "ollama_local_read_only" ? `Gratis Ollama lokaal · ${data.model || "model"}` : "Gratis brongebonden antwoord"}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {(data.sources || []).map((source: string) => <span key={source} className="rounded-full bg-emerald-500/10 px-3 py-1 text-[8px] font-bold text-emerald-200">{source}</span>)}
            </div>
            {!!data.recognizedTerms?.length && (
              <div className="mt-3 text-[8px] text-slate-500">Herkende zoektermen: {data.recognizedTerms.join(", ")}</div>
            )}
          </section>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(data.results || []).map((item: any) => (
              <article key={`${item.type}-${item.id}`} className="glass-card rounded-2xl border border-white/5 p-4">
                <div className="text-[8px] font-black uppercase tracking-wider text-cyan-300">{item.type}</div>
                <div className="mt-2 text-sm font-black text-white">{item.title}</div>
                <div className="mt-1 text-[10px] text-slate-400">{item.subtitle}</div>
                <div className="mt-3 truncate text-[8px] text-slate-600">{item.source}</div>
              </article>
            ))}
          </section>
        </>
      )}

      <section className="glass-card rounded-3xl border border-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black uppercase text-white">Opgeslagen vraaggeschiedenis</h3>
            <p className="mt-1 text-[9px] text-slate-500">Blijft op dit apparaat bewaard, ook wanneer er geen server draait.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={exportHistory} disabled={!history.length} className="rounded-lg border border-cyan-400/20 px-3 py-1 text-[8px] font-black uppercase text-cyan-200 disabled:opacity-40">Exporteer</button>
            <button onClick={() => { if (window.confirm("Alle lokaal opgeslagen FootyAI-vragen wissen?")) { window.localStorage.removeItem(HISTORY_KEY); setHistory([]); } }} disabled={!history.length} className="rounded-lg border border-red-400/20 px-3 py-1 text-[8px] font-black uppercase text-red-200 disabled:opacity-40">Wis lokaal</button>
          </div>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {history.slice(0, 10).map((item) => (
            <button key={item.id} onClick={() => search(undefined, item.query)} className="rounded-xl border border-white/5 bg-slate-950/35 p-3 text-left">
              <div className="text-[10px] font-black text-white">{item.query}</div>
              <div className="mt-1 line-clamp-2 text-[9px] text-slate-500">{item.answer}</div>
            </button>
          ))}
          {!history.length && <div className="text-[10px] text-slate-500">Nog geen vragen lokaal opgeslagen.</div>}
        </div>
      </section>
    </div>
  );
};

export default KnowledgeView;
