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
  const [aiAdvice, setAiAdvice] = useState<any[]>([]);
  const [biweeklyDigest, setBiweeklyDigest] = useState<any | null>(null);
  const [manualAdvice, setManualAdvice] = useState("");

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
    setManualAdvice(localStorage.getItem("footypredict_manual_ai_advice") || "");

    fetch(`/api/matches?date=${new Date().toISOString().split("T")[0]}`)
      .then((response) => response.json())
      .then((data) => {
        if (data.lastRun) setLastWorker(new Date(data.lastRun).toLocaleString("nl-NL"));
        if (data.workerVersion) setWorkerVersion(data.workerVersion);
        if (data.sourceBranch) setSourceBranch(data.sourceBranch);
        if (data.reviewCount != null) setReviewCount(Number(data.reviewCount || 0));
        if (data.teamLearningCount != null) setTeamLearningCount(Number(data.teamLearningCount || 0));
        if (Array.isArray(data.aiAdvice)) setAiAdvice(data.aiAdvice);
        if (data.biweeklyDigest) setBiweeklyDigest(data.biweeklyDigest);
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

  const saveManualAdvice = () => {
    localStorage.setItem("footypredict_manual_ai_advice", manualAdvice.trim());
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
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">AI advies van deze week</div>
        <div className="space-y-3">
          {(aiAdvice || []).length > 0 ? (
            aiAdvice.map((item, index) => (
              <div key={`${item.title || "advice"}-${index}`} className="rounded-xl border border-white/5 bg-slate-900/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-black text-white">{item.title}</div>
                  <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${
                    item.priority === "high" ? "bg-red-900/30 text-red-300" : item.priority === "medium" ? "bg-amber-900/30 text-amber-300" : "bg-green-900/30 text-green-300"
                  }`}>
                    {item.priority || "info"}
                  </span>
                </div>
                <div className="text-[10px] text-slate-300 mt-1">{item.summary}</div>
                <div className="text-[9px] text-slate-500 mt-1">{item.action}</div>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-slate-500">Nog geen nieuw AI advies opgebouwd uit de monitor.</div>
          )}

          <div className="rounded-xl border border-blue-500/10 bg-blue-950/10 p-3">
            <div className="text-[10px] font-black text-blue-300 uppercase mb-2">Eigen verbeternotitie voor AI</div>
            <div className="text-[10px] text-slate-400 mb-2">
              Typ hier een verbeterpunt of wens. Deze notitie blijft lokaal bewaard zodat je hem later direct kunt meenemen in nieuwe AI-aanpassingen.
            </div>
            <textarea
              value={manualAdvice}
              onChange={(event) => setManualAdvice(event.target.value)}
              rows={4}
              className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-[11px] text-white outline-none focus:border-blue-500/30"
              placeholder="Bijvoorbeeld: geef knock-out interlands extra gewicht aan schorsingen en eerste duel..."
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={saveManualAdvice}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[10px] font-black hover:bg-blue-500 transition"
              >
                Notitie bewaren
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Tweewekelijkse AI bundel</div>
        {biweeklyDigest ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black text-white">{biweeklyDigest.summary}</div>
                  <div className="text-[9px] text-slate-500 mt-1">
                    Periode {biweeklyDigest.range?.from || "?"} t/m {biweeklyDigest.range?.to || "?"}
                  </div>
                </div>
                <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-300">
                  {biweeklyDigest.cadence || "bundel"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Runs", value: biweeklyDigest.totals?.totalRuns || 0 },
                { label: "Bevindingen", value: biweeklyDigest.totals?.totalIssues || 0 },
                { label: "Thema's", value: biweeklyDigest.totals?.uniqueIssueTypes || 0 },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2">
                  <div className="text-[9px] font-black text-slate-500 uppercase">{item.label}</div>
                  <div className="text-[16px] font-black text-white mt-1">{item.value}</div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              {(biweeklyDigest.topFindings || []).slice(0, 6).map((item: any) => (
                <div key={item.key} className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] font-black text-white">{item.title}</div>
                    <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${
                      item.highestSeverity === "high"
                        ? "bg-red-900/30 text-red-300"
                        : item.highestSeverity === "medium"
                          ? "bg-amber-900/30 text-amber-300"
                          : "bg-green-900/30 text-green-300"
                    }`}>
                      {item.count}x
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">{item.recommendation}</div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-purple-500/10 bg-purple-950/10 p-3">
              <div className="text-[10px] font-black text-purple-300 uppercase mb-1">Mailstatus</div>
              <div className="text-[10px] text-slate-300">
                {biweeklyDigest.delivery?.note || "De AI bundel wordt opgebouwd en opgeslagen. Voor echte e-mailverzending is nog een mailservice of mailcredential nodig."}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-slate-500">
            Nog geen tweewekelijkse bundel beschikbaar. Deze wordt automatisch opgebouwd zodra de digest-workflow draait.
          </div>
        )}
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
              desc: "De app leert nu uit reviews en monitor-data, maakt aan het eind van de dag een voorstelbranch met patchadvies, maar schrijft nooit blind live code over.",
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
          <div><span className="font-black text-white">Reviewvoorstel:</span> de monitor bouwt nu dagelijks een voorstelbranch-plan op zonder automatisch live te gaan.</div>
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
          <div><span className="font-black text-white">Reviewbranch generator:</span> dagelijkse monitorbevindingen worden automatisch samengevat in een patchvoorstel, zodat verbeteringen sneller maar veilig doorgezet kunnen worden.</div>
        </div>
      </div>

      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Gratis databronnen met meeste extra waarde</div>
        <div className="space-y-3">
          {[
            {
              name: "football-data.co.uk",
              status: "gekoppeld",
              desc: "Blijft de sterkste gratis bron voor historische odds, closing-lijnen, bookmakerkolommen en veel competitiemeta.",
            },
            {
              name: "Understat",
              status: "aanbevolen",
              desc: "Kan extra xG/xGA-profielen voor topcompetities leveren en is vooral nuttig voor clubwedstrijden met veel schotdata.",
            },
            {
              name: "FBref",
              status: "aanbevolen",
              desc: "Kan geavanceerde teamstatistieken en home/away splits aanvullen waar de huidige feed dun blijft.",
            },
            {
              name: "Transfermarkt",
              status: "deels gekoppeld",
              desc: "Wordt al best-effort gebruikt voor interland blessures/schorsingen; kan later nog breder per competitie worden ingezet.",
            },
          ].map((item) => (
            <div key={item.name} className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-black text-white">{item.name}</div>
                <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${
                  item.status === "gekoppeld"
                    ? "bg-green-900/30 text-green-300"
                    : item.status === "deels gekoppeld"
                      ? "bg-blue-900/30 text-blue-300"
                      : "bg-amber-900/30 text-amber-300"
                }`}>
                  {item.status}
                </span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1">{item.desc}</div>
            </div>
          ))}
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
