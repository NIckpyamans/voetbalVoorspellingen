import React, { useEffect, useState } from "react";

const SettingsView: React.FC = () => {
  const [historyCount, setHistoryCount] = useState(0);
  const [teamCount, setTeamCount] = useState(0);
  const [historySizeKb, setHistorySizeKb] = useState(0);
  const [teamStoreSizeKb, setTeamStoreSizeKb] = useState(0);
  const [lastWorker, setLastWorker] = useState<string | null>(null);
  const [analysisEngine, setAnalysisEngine] = useState<"checking" | "ollama" | "template">("checking");
  const [workerVersion, setWorkerVersion] = useState<string>("onbekend");
  const [sourceBranch, setSourceBranch] = useState<string>("onbekend");
  const [reviewCount, setReviewCount] = useState(0);
  const [teamLearningCount, setTeamLearningCount] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("footypredict_memory") || "[]";
      setHistoryCount(JSON.parse(raw).length);
      setHistorySizeKb(Math.round((new Blob([raw]).size / 1024) * 10) / 10);
    } catch {}
    try {
      const raw = localStorage.getItem("footypredict_team_store_v1") || "{}";
      setTeamCount(Object.keys(JSON.parse(raw)).length);
      setTeamStoreSizeKb(Math.round((new Blob([raw]).size / 1024) * 10) / 10);
    } catch {}

    fetch(`/api/matches?date=${new Date().toISOString().split("T")[0]}`)
      .then((response) => response.json())
      .then((data) => {
        if (data.lastRun) setLastWorker(new Date(data.lastRun).toLocaleString("nl-NL"));
        if (data.workerVersion) setWorkerVersion(data.workerVersion);
        if (data.sourceBranch) setSourceBranch(data.sourceBranch);
        if (data.reviewCount != null) setReviewCount(Number(data.reviewCount || 0));
        if (data.teamLearningCount != null) setTeamLearningCount(Number(data.teamLearningCount || 0));
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
          Modelstatus, workerdata, reviewlaag en controle van de huidige AI-opzet.
        </p>
      </div>

      <div className="glass-card rounded-2xl border border-white/5 p-5 space-y-3">
        <div className="text-[10px] font-black text-slate-400 uppercase">App informatie</div>
        {[
          { label: "Opgeslagen voorspellingen", value: historyCount.toLocaleString() },
          { label: "Teams in lokale leerstore", value: teamCount.toLocaleString() },
          { label: "Geheugen voorspellingen", value: `${historySizeKb.toLocaleString()} KB` },
          { label: "Geheugen teamstore", value: `${teamStoreSizeKb.toLocaleString()} KB` },
          { label: "Laatste worker run", value: lastWorker || "Onbekend" },
          { label: "Worker versie", value: workerVersion },
          { label: "Databron branch", value: sourceBranch },
          { label: "Reviews opgeslagen", value: reviewCount.toLocaleString() },
          { label: "Teams met leerdata", value: teamLearningCount.toLocaleString() },
          { label: "Senior-filter", value: "vrouwen + jeugd/U21 uitgesloten" },
          { label: "Analyse-engine", value: analysisEngine === "checking" ? "Controleren..." : analysisEngine === "ollama" ? "Ollama lokaal" : "Template/review fallback" },
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
              desc: "De hoofdmotor voor kansen en scorematrix. Dit blijft de basis voor wedstrijdkansen.",
              tone: "green",
            },
            {
              name: "Heuristische ensemblelaag",
              desc: "Voegt ClubElo, rust, splitvorm, lineups, keeperverschil, corners, kaarten, reislast en referee-profiel toe als correctielaag.",
              tone: "blue",
            },
            {
              name: "Closing-line calibratie",
              desc: "Historische implied strength, closing-profiel en bookmaker-consensus sturen de kansverdeling nu sterker bij, vooral bij interlands en toernooiwedstrijden.",
              tone: "blue",
            },
            {
              name: "Post-match reviewlaag",
              desc: "Verwerkt voorspelde uitslag versus echte uitslag, failure-signals en teambias om volgende voorspellingen scherper te maken.",
              tone: "purple",
            },
            {
              name: "Competitie-betrouwbaarheid",
              desc: "Elke competitie bouwt een eigen betrouwbaarheidsscore op uit outcome hitrate, exact hitrate en gemiddelde goal error.",
              tone: "green",
            },
            {
              name: "Fase-betrouwbaarheid",
              desc: "League, kwalificatie, vriendschappelijk, cup en two-leg knockout krijgen nu aparte betrouwbaarheidsscores, zodat wedstrijdtypes strakker gescheiden worden.",
              tone: "amber",
            },
            {
              name: "Historische scheidsdata",
              desc: "Waar beschikbaar komt kaartenritme en penalty-profiel nu uit historische referee-rows uit football-data.co.uk, met competitie-specifieke alias-cache voor betere matchrate.",
              tone: "amber",
            },
            {
              name: "AI verbeterlus",
              desc: "De app leert nu uit reviews en monitor-data, maar schrijft niet blind live code over. De veilige route blijft: voorstellen, controleren en dan pas uitrollen.",
              tone: "purple",
            },
            {
              name: "Trainingsvoorbereiding",
              desc: "De worker schrijft featuredata en reviews weg voor CatBoost of LightGBM als volgende stap.",
              tone: "amber",
            },
            {
              name: "Compacte opslaglaag",
              desc: "Lokale opslag en workerdata worden nu automatisch ingekort zodat history, reviewdata en cache niet onnodig blijven groeien.",
              tone: "green",
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
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Achtergrondupdates</div>
        <div className="space-y-2 text-[11px] text-slate-300 leading-relaxed">
          <div><span className="font-black text-white">Worker-runs:</span> blijven op de achtergrond draaien zonder extra leer-workflow erbovenop.</div>
          <div><span className="font-black text-white">Build-noise:</span> worker commits met alleen dataverandering kunnen nu door Vercel worden overgeslagen.</div>
          <div><span className="font-black text-white">Mail:</span> eventuele GitHub accountmails voor watches of Actions komen uit je accountinstellingen, niet uit de app zelf.</div>
          <div><span className="font-black text-white">Data-filter:</span> senior-mannenfeed blijft nu schoner doordat vrouwen en jeugd/U21 centraal uit de worker worden gefilterd.</div>
        </div>
      </div>

      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">AI reviewstatus</div>
        <div className="space-y-2 text-[11px] text-slate-300 leading-relaxed">
          <div><span className="font-black text-white">Outcome learning:</span> teams bouwen nu biasdata op uit echte uitslagen.</div>
          <div><span className="font-black text-white">Failure-signals:</span> open lineups, weer, H2H en rustverschil worden achteraf gelogd als een voorspelling fout zat.</div>
          <div><span className="font-black text-white">UI-review:</span> gespeelde wedstrijden tonen nu modelreview met voorspeld versus werkelijk resultaat.</div>
          <div><span className="font-black text-white">Competitieprofiel:</span> interlands en clubcompetities krijgen nu een aparte betrouwbaarheidsscore in de kaart.</div>
          <div><span className="font-black text-white">Faseprofiel:</span> kwalificatie, friendly, league, cup en two-leg knockout worden nu apart beoordeeld zodat de confidence per wedstrijdtype scherper wordt.</div>
          <div><span className="font-black text-white">Referee-history:</span> historische kaarten- en penaltydata van scheidsrechters wordt waar mogelijk direct in de heuristiek gebruikt, met competitie-specifieke alias-cache.</div>
          <div><span className="font-black text-white">Bookmakerlaag:</span> closing-odds worden niet meer alleen samengesteld bekeken, maar ook per bookmaker gewogen in de calibratie.</div>
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
