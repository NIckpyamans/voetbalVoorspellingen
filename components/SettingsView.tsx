import React, { useEffect, useState } from "react";

const SettingsView: React.FC = () => {
  const [historyCount, setHistoryCount] = useState(0);
  const [teamCount, setTeamCount] = useState(0);
  const [lastWorker, setLastWorker] = useState<string | null>(null);
  const [analysisEngine, setAnalysisEngine] = useState<"checking" | "ollama" | "template">("checking");

  useEffect(() => {
    try {
      setHistoryCount(JSON.parse(localStorage.getItem("footypredict_memory") || "[]").length);
    } catch {}
    try {
      setTeamCount(Object.keys(JSON.parse(localStorage.getItem("footypredict_team_store_v1") || "{}")).length);
    } catch {}

    fetch(`/api/matches?date=${new Date().toISOString().split("T")[0]}`)
      .then((response) => response.json())
      .then((data) => {
        if (data.lastRun) setLastWorker(new Date(data.lastRun).toLocaleString("nl-NL"));
      })
      .catch(() => {});

    fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        match: { id: "test", homeTeamName: "Ajax", awayTeamName: "PSV", league: "Netherlands - Eredivisie" },
        prediction: { homeProb: 0.44, drawProb: 0.26, awayProb: 0.3, homeXG: 1.4, awayXG: 1.1, predHomeGoals: 1, predAwayGoals: 1, over25: 0.52, btts: 0.57 },
      }),
    })
      .then((response) => response.json())
      .then((data) => setAnalysisEngine(data.engine === "ollama-local" ? "ollama" : "template"))
      .catch(() => setAnalysisEngine("template"));
  }, []);

  const clearCache = () => {
    Object.keys(localStorage)
      .filter((key) => key.startsWith("footypredict_") && !key.includes("memory"))
      .forEach((key) => localStorage.removeItem(key));
    window.location.reload();
  };

  const clearHistory = () => {
    if (!window.confirm("Alle voorspellingengeschiedenis wissen?")) return;
    localStorage.removeItem("footypredict_memory");
    setHistoryCount(0);
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-2xl font-black text-white uppercase tracking-tight">Instellingen</h2>
        <p className="text-slate-500 text-xs mt-0.5">
          Modelstatus, lokale opslag en controle van de huidige AI-opzet.
        </p>
      </div>

      <div className="glass-card rounded-2xl border border-white/5 p-5 space-y-3">
        <div className="text-[10px] font-black text-slate-400 uppercase">App informatie</div>
        {[
          { label: "Opgeslagen voorspellingen", value: historyCount.toLocaleString() },
          { label: "Teams in lokale leerstore", value: teamCount.toLocaleString() },
          { label: "Laatste worker run", value: lastWorker || "Onbekend" },
          { label: "Analyse-engine", value: analysisEngine === "checking" ? "Controleren..." : analysisEngine === "ollama" ? "Ollama lokaal" : "Template fallback" },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
            <span className="text-[11px] text-slate-400">{label}</span>
            <span className="text-[11px] font-black text-white">{value}</span>
          </div>
        ))}
      </div>

      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Actieve voorspellaag</div>
        <div className="space-y-3">
          {[
            {
              name: "Dixon-Coles + Poisson",
              desc: "De hoofdmotor voor kansen en scorematrix. Dit is inhoudelijk sterker voor wedstrijdkansen dan een chatmodel alleen.",
              tone: "green",
            },
            {
              name: "Heuristische ensemblelaag",
              desc: "Voegt ClubElo, rust, splitvorm, lineups, keeperverschil, corners, kaarten en reislast toe als extra correctielaag.",
              tone: "blue",
            },
            {
              name: "Lokale AI-analyse",
              desc: "Ollama schrijft de Nederlandse analyse als die lokaal beschikbaar is. Anders valt de app automatisch terug op een gratis templatesamenvatting.",
              tone: "purple",
            },
            {
              name: "Trainingsvoorbereiding",
              desc: "De worker schrijft featuredata weg voor een volgende stap met CatBoost of LightGBM. Dat is de beste route als je de voorspellingen nog stabieler wilt maken.",
              tone: "amber",
            },
          ].map((item) => (
            <div key={item.name} className="flex gap-3 pb-3 border-b border-white/5 last:border-0">
              <span
                className={`flex-shrink-0 mt-0.5 text-[8px] font-black px-1.5 py-0.5 rounded h-fit ${
                  item.tone === "green"
                    ? "bg-green-900/30 text-green-400"
                    : item.tone === "blue"
                      ? "bg-blue-900/30 text-blue-400"
                      : item.tone === "purple"
                        ? "bg-purple-900/30 text-purple-400"
                        : "bg-amber-900/30 text-amber-400"
                }`}
              >
                actief
              </span>
              <div>
                <div className="text-[11px] font-black text-white">{item.name}</div>
                <div className="text-[9px] text-slate-500 mt-0.5 leading-relaxed">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Aanbevolen volgende stap</div>
        <div className="space-y-2 text-[11px] text-slate-300 leading-relaxed">
          <div>
            <span className="font-black text-white">1. Workerdata verder benutten:</span> corners, keeper-rating, lineup continuity,
            kaartenritme en reislast zitten nu in de features en kunnen direct in het model meewegen.
          </div>
          <div>
            <span className="font-black text-white">2. Later een ML-laag toevoegen:</span> train eerst op de `training-snapshot`
            met CatBoost. Houd de huidige engine als basis en gebruik ML als extra correctielaag.
          </div>
          <div>
            <span className="font-black text-white">3. LLM alleen voor uitleg:</span> de tekst-AI is handig voor analyses, maar
            niet als hoofdvoorspeller.
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Cache beheer</div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-black text-white">App-cache wissen</div>
              <div className="text-[9px] text-slate-500">Verwijdert tijdelijke data en haalt de data opnieuw op.</div>
            </div>
            <button
              onClick={clearCache}
              className="px-4 py-1.5 rounded-lg text-[10px] font-black bg-slate-700 text-slate-300 hover:bg-slate-600 transition"
            >
              Cache wissen
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-white/5 pt-3">
            <div>
              <div className="text-[11px] font-black text-white">Voorspellingsgeschiedenis wissen</div>
              <div className="text-[9px] text-slate-500">{historyCount.toLocaleString()} opgeslagen resultaten</div>
            </div>
            <button
              onClick={clearHistory}
              className="px-4 py-1.5 rounded-lg text-[10px] font-black bg-red-900/20 border border-red-500/20 text-red-400 hover:bg-red-900/30 transition"
            >
              Wissen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsView;
