import React, { FormEvent, useState } from "react";

const EXAMPLES = [
  "Welke competities zijn opgeslagen?",
  "Welke health problemen zijn bekend?",
  "Zoek Ajax",
  "Zoek wedstrijden op 2026-05-24",
];

const KnowledgeView: React.FC = () => {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Zoeken mislukt");
      setData(payload);
    } catch (nextError: any) {
      setError(nextError.message || "Zoeken mislukt");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,.16),transparent_42%),linear-gradient(135deg,rgba(2,6,23,.98),rgba(15,23,42,.88))] p-6">
        <div className="text-[10px] font-black uppercase tracking-[.28em] text-cyan-300">Read-only kennislaag</div>
        <h2 className="mt-2 text-3xl font-black text-white">Zoeken & Vraag FootyAI</h2>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-400">
          Zoek door teams, wedstrijden, competitiearchieven en health-signalen. Antwoorden tonen altijd hun bron en kunnen niets wijzigen.
        </p>
        <form onSubmit={search} className="mt-5 flex flex-col gap-2 md:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Bijvoorbeeld: welke wedstrijden missen H2H?"
            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/50"
          />
          <button className="rounded-2xl bg-cyan-500 px-5 py-3 text-xs font-black uppercase text-slate-950 hover:bg-cyan-300" disabled={loading}>
            {loading ? "Zoeken..." : "Vraag FootyAI"}
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button key={example} onClick={() => search(undefined, example)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[9px] font-bold text-slate-300 hover:border-cyan-400/30">
              {example}
            </button>
          ))}
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
              {data.answerMode === "openai_read_only" ? `OpenAI read-only · ${data.model || "model"}` : "Deterministische read-only fallback"}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {(data.sources || []).map((source: string) => <span key={source} className="rounded-full bg-emerald-500/10 px-3 py-1 text-[8px] font-bold text-emerald-200">{source}</span>)}
            </div>
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
    </div>
  );
};

export default KnowledgeView;
