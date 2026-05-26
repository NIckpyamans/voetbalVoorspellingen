import React, { useEffect, useState } from "react";
import { todayAmsterdamKey } from "../shared/date.js";
import { logClientWarning } from "../shared/clientLogger";

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
  const [rufloReport, setRufloReport] = useState<any | null>(null);
  const [featureDiagnostics, setFeatureDiagnostics] = useState<any | null>(null);
  const [sourceCoverage, setSourceCoverage] = useState<any | null>(null);
  const [dataScout, setDataScout] = useState<any | null>(null);
  const [dataCompletenessAudit, setDataCompletenessAudit] = useState<any | null>(null);
  const [oddsIntegrationReadiness, setOddsIntegrationReadiness] = useState<any | null>(null);
  const [modelPerformance, setModelPerformance] = useState<any | null>(null);
  const [backtestSummary, setBacktestSummary] = useState<any | null>(null);
  const [anomalyReport, setAnomalyReport] = useState<any | null>(null);
  const [competitionArchiveIndex, setCompetitionArchiveIndex] = useState<any | null>(null);
  const [teamSquadSummary, setTeamSquadSummary] = useState<any | null>(null);
  const [manualAdvice, setManualAdvice] = useState("");
  const [glassTransparency, setGlassTransparency] = useState(46);
  const [settingsWarning, setSettingsWarning] = useState<string | null>(null);

  useEffect(() => {
    try {
      setGlassTransparency(Math.min(80, Math.max(15, Number(localStorage.getItem("footyai_glass_transparency") || 46))));
    } catch (error) {
      logClientWarning("settings_transparency_read_failed", { error });
    }
    try {
      const raw = localStorage.getItem("footypredict_memory") || "[]";
      setHistoryCount(JSON.parse(raw).length);
      setHistorySizeKb(Math.round((new Blob([raw]).size / 1024) * 10) / 10);
    } catch (error) {
      logClientWarning("settings_history_read_failed", { error });
    }
    try {
      const raw = localStorage.getItem("footypredict_team_store_v1") || "{}";
      setTeamCount(Object.keys(JSON.parse(raw)).length);
      setTeamStoreSizeKb(Math.round((new Blob([raw]).size / 1024) * 10) / 10);
    } catch (error) {
      logClientWarning("settings_team_store_read_failed", { error });
    }
    setManualAdvice(localStorage.getItem("footypredict_manual_ai_advice") || "");

    fetch(`/api/matches?date=${todayAmsterdamKey()}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.error || `Instellingen ophalen mislukt (${response.status})`);
        return data;
      })
      .then((data) => {
        if (data.lastRun) setLastWorker(new Date(data.lastRun).toLocaleString("nl-NL"));
        if (data.workerVersion) setWorkerVersion(data.workerVersion);
        if (data.sourceBranch) setSourceBranch(data.sourceBranch);
        if (data.reviewCount != null) setReviewCount(Number(data.reviewCount || 0));
        if (data.teamLearningCount != null) setTeamLearningCount(Number(data.teamLearningCount || 0));
        if (Array.isArray(data.aiAdvice)) setAiAdvice(data.aiAdvice);
        if (data.biweeklyDigest) setBiweeklyDigest(data.biweeklyDigest);
        if (data.rufloReport) setRufloReport(data.rufloReport);
        if (data.featureDiagnostics) setFeatureDiagnostics(data.featureDiagnostics);
        if (data.sourceCoverage) setSourceCoverage(data.sourceCoverage);
        if (data.dataScout) setDataScout(data.dataScout);
        if (data.dataCompletenessAudit) setDataCompletenessAudit(data.dataCompletenessAudit);
        if (data.oddsIntegrationReadiness) setOddsIntegrationReadiness(data.oddsIntegrationReadiness);
        if (data.modelPerformance) setModelPerformance(data.modelPerformance);
        if (data.backtestSummary) setBacktestSummary(data.backtestSummary);
        if (data.anomalyReport) setAnomalyReport(data.anomalyReport);
        if (data.competitionArchiveIndex) setCompetitionArchiveIndex(data.competitionArchiveIndex);
        if (data.teamSquadSummary) setTeamSquadSummary(data.teamSquadSummary);
        setAnalysisEngine("template");
      })
      .catch((error) => {
        logClientWarning("settings_metadata_fetch_failed", { error });
        setSettingsWarning("Instellingen konden de actuele workerstatus niet ophalen. Laatst bekende browserdata blijft zichtbaar.");
        setAnalysisEngine("template");
      });
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

  const updateGlassTransparency = (value: number) => {
    const next = Math.min(80, Math.max(15, value));
    setGlassTransparency(next);
    localStorage.setItem("footyai_glass_transparency", String(next));
    window.dispatchEvent(new Event("footyai-glass-change"));
  };

  const bundleUpdatedAt = biweeklyDigest?.generatedAt
    ? new Date(biweeklyDigest.generatedAt).toLocaleString("nl-NL")
    : null;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-2xl font-black text-white uppercase tracking-tight">Instellingen</h2>
        <p className="text-slate-500 text-xs mt-0.5">
          Modelstatus, workerdata, reviewlaag en controle van de huidige AI-opzet.
        </p>
        {settingsWarning && (
          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-[11px] font-bold text-amber-200">
            {settingsWarning}
          </div>
        )}
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
          { label: "Competitie-archieven", value: `${Number(competitionArchiveIndex?.closedCount || 0).toLocaleString()} gesloten / ${Number(competitionArchiveIndex?.totalCompetitions || 0).toLocaleString()} totaal` },
          { label: "Teams met selectieprofiel", value: Number(teamSquadSummary?.teams || 0).toLocaleString() },
          { label: "Senior-filter", value: "vrouwen + jeugd/U21 uitgesloten" },
          { label: "Analyse-engine", value: analysisEngine === "checking" ? "Controleren..." : analysisEngine === "ollama" ? "Ollama lokaal" : "Template/review fallback" },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
            <span className="text-[11px] text-slate-400">{label}</span>
            <span className="text-[11px] font-black text-white">{value}</span>
          </div>
        ))}
      </div>

      <div className="glass-card rounded-2xl border border-emerald-500/10 p-5 bg-emerald-950/5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[10px] font-black text-emerald-300 uppercase">Competitie-archief en teamselecties</div>
            <div className="text-[11px] text-slate-400 mt-1">
              Afgesloten competities blijven apart bewaard per seizoen. Gevulde spelerslijsten worden maandelijks gecontroleerd; tijdens transferwindows schakelt de worker naar snellere bewaking.
            </div>
          </div>
          <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-300">
            workerdata
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: "Archieven totaal", value: Number(competitionArchiveIndex?.totalCompetitions || 0).toLocaleString() },
            { label: "Actieve competities", value: Number(competitionArchiveIndex?.activeCount || 0).toLocaleString() },
            { label: "Gesloten competities", value: Number(competitionArchiveIndex?.closedCount || 0).toLocaleString() },
            { label: "Teams gevolgd", value: Number(teamSquadSummary?.teams || 0).toLocaleString() },
            { label: "Spelerslijsten gevuld", value: Number(teamSquadSummary?.teamsWithPlayers || 0).toLocaleString() },
            { label: "Selecties toe aan check", value: Number(teamSquadSummary?.rostersDueForRefresh || 0).toLocaleString() },
            { label: "Transfers bewaakt", value: Number(teamSquadSummary?.transfersWatched || 0).toLocaleString() },
            { label: "Transfer risico hoog", value: Number(teamSquadSummary?.highTransferRisk || 0).toLocaleString() },
            { label: "Gem. teamrating", value: Number(teamSquadSummary?.averageRating || 0).toLocaleString("nl-NL") },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2">
              <div className="text-[9px] font-black text-slate-500 uppercase">{item.label}</div>
              <div className="text-[16px] font-black text-white mt-1">{item.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-cyan-400/10 bg-cyan-950/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-black text-cyan-200 uppercase">Transferwindow-bewaking</div>
              <div className="text-[11px] text-slate-400">
                Status: <span className="font-black text-white">{teamSquadSummary?.transferWindow?.label || "onbekend"}</span>
                {teamSquadSummary?.transferWindow?.startAt && (
                  <>
                    {" "}· volgende/periode:{" "}
                    {new Date(teamSquadSummary.transferWindow.startAt).toLocaleDateString("nl-NL")} t/m{" "}
                    {teamSquadSummary?.transferWindow?.endAt
                      ? new Date(teamSquadSummary.transferWindow.endAt).toLocaleDateString("nl-NL")
                      : "onbekend"}
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <span className="rounded-full bg-slate-900/70 px-3 py-1 text-[9px] font-black text-slate-300">
                normaal {Number(teamSquadSummary?.monthlyRefreshDays || 30)}d
              </span>
              <span className="rounded-full bg-emerald-900/30 px-3 py-1 text-[9px] font-black text-emerald-200">
                transfer {Number(teamSquadSummary?.transferWindowRefreshDays || 3)}d
              </span>
            </div>
          </div>
        </div>

        {Array.isArray(teamSquadSummary?.fallbackPolicy) && (
          <div className="mt-3 rounded-xl border border-blue-400/10 bg-blue-950/10 p-3">
            <div className="text-[10px] font-black text-blue-200 uppercase mb-2">Spelerslijst bronvolgorde</div>
            <div className="grid md:grid-cols-2 gap-2">
              {teamSquadSummary.fallbackPolicy.map((item: string) => (
                <div key={item} className="rounded-lg border border-white/5 bg-slate-950/30 px-3 py-2 text-[10px] text-slate-300">
                  {item}
                </div>
              ))}
            </div>
          </div>
        )}

        {Array.isArray(teamSquadSummary?.strongestTeams) && teamSquadSummary.strongestTeams.length > 0 && (
          <div className="mt-3 rounded-xl border border-white/5 bg-slate-900/30 p-3">
            <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Sterkste selectieprofielen</div>
            <div className="grid md:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
              {teamSquadSummary.strongestTeams.map((team: any, index: number) => (
                <div key={`${team.teamName}-${index}`} className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-950/30 px-3 py-2">
                  <div>
                    <div className="text-[10px] font-black text-white">#{index + 1} {team.teamName}</div>
                    <div className="text-[8px] text-slate-500">{Number(team.playerCount || 0)} spelers - {team.source}</div>
                  </div>
                  <div className="text-[16px] font-black text-emerald-300">{team.rating}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="glass-card rounded-2xl border border-cyan-500/15 p-5 space-y-4">
        <div>
          <div className="text-[10px] font-black text-cyan-300 uppercase">Layout en achtergrond</div>
          <p className="mt-1 text-[11px] text-slate-500">
            Bepaal hoeveel van de stadionachtergrond door de kaarten heen zichtbaar is.
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-slate-950/25 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-black text-white">Kaders doorzichtiger maken</div>
              <div className="text-[9px] text-slate-500">Lager = rustiger, hoger = meer achtergrond zichtbaar.</div>
            </div>
            <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-[11px] font-black text-cyan-200">
              {glassTransparency}%
            </span>
          </div>
          <input
            type="range"
            min="15"
            max="80"
            step="5"
            value={glassTransparency}
            onChange={(event) => updateGlassTransparency(Number(event.target.value))}
            className="w-full accent-cyan-400"
            aria-label="Doorzichtigheid van kaders"
          />
          <div className="mt-2 flex justify-between text-[8px] font-black uppercase text-slate-600">
            <span>Donkerder</span>
            <span>Meer beeld</span>
          </div>
        </div>
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
                  <div className="text-[9px] text-slate-600 mt-1">
                    Laatste bundelupdate {bundleUpdatedAt || "onbekend"}
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


      <div className="glass-card rounded-2xl border border-cyan-500/10 p-5 bg-cyan-950/5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[10px] font-black text-cyan-300 uppercase">Ruflo AI-agentlaag</div>
            <div className="text-[11px] text-slate-400 mt-1">
              Extra reviewlaag naast productie: leest monitor, data en reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te gaan.
            </div>
          </div>
          <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-cyan-900/30 text-cyan-300">
            veilig naast app
          </span>
        </div>

        {rufloReport ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3">
              <div className="text-[11px] font-black text-white">{rufloReport.summary}</div>
              <div className="text-[9px] text-slate-500 mt-1">
                Laatste Ruflo-run {rufloReport.generatedAt ? new Date(rufloReport.generatedAt).toLocaleString("nl-NL") : "onbekend"}
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-2">
              {[
                { key: "data", label: "Betere datalaag", agent: rufloReport.agents?.data, tone: "blue" },
                { key: "learning", label: "Betere leerlaag", agent: rufloReport.agents?.learning, tone: "green" },
                { key: "control", label: "Ontwikkelcontrole", agent: rufloReport.agents?.control, tone: "purple" },
              ].map((item) => (
                <div key={item.key} className="rounded-xl border border-white/5 bg-slate-900/40 p-3">
                  <div className={`text-[9px] font-black uppercase ${item.tone === "green" ? "text-emerald-300" : item.tone === "purple" ? "text-purple-300" : "text-blue-300"}`}>
                    {item.label}
                  </div>
                  <div className="text-[22px] font-black text-white mt-1">{Number(item.agent?.score || 0)}%</div>
                  <div className="text-[9px] text-slate-500 mt-1 leading-relaxed">{item.agent?.summary || "Nog geen agentrapport."}</div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
              <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Gratis acties die Ruflo adviseert</div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {(rufloReport.recommendedNextActions || []).slice(0, 10).map((item: any, index: number) => (
                  <div key={`${item.title}-${index}`} className="rounded-lg border border-white/5 bg-slate-950/30 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[10px] font-black text-white">{item.title}</div>
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${
                        item.priority === "high"
                          ? "bg-red-900/30 text-red-300"
                          : item.priority === "medium"
                            ? "bg-amber-900/30 text-amber-300"
                            : "bg-green-900/30 text-green-300"
                      }`}>
                        {item.agent || "agent"} · {item.priority || "low"}
                      </span>
                    </div>
                    <div className="text-[9px] text-slate-400 mt-1 leading-relaxed">{item.freeSolution}</div>
                    {Array.isArray(item.files) && item.files.length > 0 && (
                      <div className="text-[8px] text-slate-600 mt-1">Bestanden: {item.files.join(", ")}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-emerald-500/10 bg-emerald-950/10 p-3">
              <div className="text-[10px] font-black text-emerald-300 uppercase mb-1">Gratis guardrails</div>
              <div className="space-y-1">
                {(rufloReport.freeOnlyGuardrails || []).map((item: string) => (
                  <div key={item} className="text-[10px] text-slate-300">- {item}</div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-slate-500">Nog geen Ruflo-agentrapport. Draai `npm run monitor:ruflo` of wacht op de review-workflow.</div>
        )}
      </div>

      <div className="glass-card rounded-2xl border border-emerald-500/10 p-5 bg-emerald-950/5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[10px] font-black text-emerald-300 uppercase">Footy data-scout AI</div>
            <div className="text-[11px] text-slate-400 mt-1">
              Gratis databronnen die de worker elke run controleert voor scores, logo's, H2H, xG, odds en clubhistorie.
            </div>
          </div>
          <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-300">
            {dataScout?.cadence || "worker"}
          </span>
        </div>

        {dataScout ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Vandaag", value: dataScout.collected?.todayMatches || 0 },
                { label: "Morgen", value: dataScout.collected?.tomorrowMatches || 0 },
                { label: "Live", value: dataScout.collected?.liveMatches || 0 },
                { label: "Logo's gevuld", value: dataScout.collected?.logosFilledToday || 0 },
                { label: "H2H gevuld", value: dataScout.collected?.h2hFilledToday || 0 },
                { label: "Reviews", value: dataScout.collected?.reviews || 0 },
                { label: "Teams leerdata", value: dataScout.collected?.teamsWithLearning || 0 },
                { label: "Marktprofielen", value: dataScout.collected?.marketProfiles || 0 },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2">
                  <div className="text-[9px] font-black text-slate-500 uppercase">{item.label}</div>
                  <div className="text-[16px] font-black text-white mt-1">{Number(item.value || 0).toLocaleString()}</div>
                </div>
              ))}
            </div>

            {Array.isArray(dataScout.gaps) && dataScout.gaps.length > 0 && (
              <div className="rounded-xl border border-amber-500/10 bg-amber-950/10 p-3">
                <div className="text-[10px] font-black text-amber-300 uppercase mb-2">Waar de scout nog op let</div>
                <div className="space-y-2">
                  {dataScout.gaps.slice(0, 6).map((gap: any, index: number) => (
                    <div key={`${gap.title}-${index}`} className="rounded-lg border border-white/5 bg-slate-950/30 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[10px] font-black text-white">{gap.title}</div>
                        <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-300">
                          {gap.count}x
                        </span>
                      </div>
                      <div className="text-[9px] text-slate-400 mt-1">{gap.action}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
              <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Gratis bronnen en wat ze leveren</div>
              <div className="grid md:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
                {(dataScout.sources || []).map((source: any) => (
                  <div key={source.key} className="rounded-lg border border-white/5 bg-slate-950/30 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[10px] font-black text-white">{source.name}</div>
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${
                        String(source.status || "").includes("actief")
                          ? "bg-green-900/30 text-green-300"
                          : "bg-slate-800 text-slate-400"
                      }`}>
                        {source.status}
                      </span>
                    </div>
                    <div className="text-[9px] text-slate-500 mt-1">{source.category} - {source.freeUse}</div>
                    <div className="text-[9px] text-slate-400 mt-1">{(source.data || []).join(", ")}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-cyan-500/10 bg-cyan-950/10 p-3">
              <div className="text-[10px] font-black text-cyan-300 uppercase mb-1">Scout advies</div>
              <div className="space-y-1">
                {(dataScout.recommendations || []).map((item: string) => (
                  <div key={item} className="text-[10px] text-slate-300">- {item}</div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-slate-500">
            Nog geen data-scout rapport. Na de volgende worker-run verschijnt hier welke gratis bronnen data hebben geleverd.
          </div>
        )}
      </div>
      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Bronkwaliteit van vandaag</div>
        {sourceCoverage ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  label: "Scoredekking FT/live",
                  value: `${Math.round(Number(sourceCoverage.scoreCoverage || 0) * 100)}%`,
                },
                {
                  label: "Logo-dekking",
                  value: `${Math.round(Number(sourceCoverage.logoCoverage || 0) * 100)}%`,
                },
                {
                  label: "Bookmakerdekking",
                  value: `${Math.round(Number(sourceCoverage.bookmakerCoverage || 0) * 100)}%`,
                },
                {
                  label: "Referee-dekking",
                  value: `${Math.round(Number(sourceCoverage.refereeCoverage || 0) * 100)}%`,
                },
                {
                  label: "H2H-dekking",
                  value: `${Math.round(Number(sourceCoverage.h2hCoverage || 0) * 100)}%`,
                },
                {
                  label: "Historische marktprofielen",
                  value: Number(sourceCoverage.marketProfiles || 0).toLocaleString(),
                },
                {
                  label: "Openfootball H2H",
                  value: `${Math.round(Number(sourceCoverage.openfootballH2hCoverage || 0) * 100)}%`,
                },
                {
                  label: "Understat xG",
                  value: `${Math.round(Number(sourceCoverage.understatCoverage || 0) * 100)}%`,
                },
                {
                  label: "FBref shots/splits",
                  value: `${Math.round(Number(sourceCoverage.fbrefCoverage || 0) * 100)}%`,
                },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2">
                  <div className="text-[9px] font-black text-slate-500 uppercase">{item.label}</div>
                  <div className="text-[16px] font-black text-white mt-1">{item.value}</div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-emerald-500/10 bg-emerald-950/10 p-3">
              <div className="text-[10px] font-black text-emerald-300 uppercase mb-1">Understat status</div>
              <div className="text-[10px] text-slate-300">
                <span className="font-black text-white mr-1">{sourceCoverage.understat?.status || "onbekend"}:</span>
                {sourceCoverage.understat?.note || "Nog geen status."}
              </div>
              <div className="text-[9px] text-slate-500 mt-1">
                Snapshots {Number(sourceCoverage.understat?.snapshots || sourceCoverage.understatSnapshots || 0).toLocaleString()}
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/10 bg-amber-950/10 p-3">
              <div className="text-[10px] font-black text-amber-300 uppercase mb-1">FBref status</div>
              <div className="text-[10px] text-slate-300">
                <span className="font-black text-white mr-1">{sourceCoverage.fbref?.status || "onbekend"}:</span>
                {sourceCoverage.fbref?.note || "Nog geen status."}
              </div>
              <div className="text-[9px] text-slate-500 mt-1">
                Snapshots {Number(sourceCoverage.fbref?.snapshots || sourceCoverage.fbrefSnapshots || 0).toLocaleString()}
              </div>
            </div>

            {Array.isArray(sourceCoverage.backupSources) && sourceCoverage.backupSources.length > 0 && (
              <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
                <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Actieve backupbronnen</div>
                <div className="space-y-2">
                  {sourceCoverage.backupSources.map((item: any) => (
                    <div key={item.key} className="rounded-lg border border-white/5 bg-slate-950/30 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[10px] font-black text-white">{item.name}</div>
                        <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-300">
                          {item.status}
                        </span>
                      </div>
                      <div className="text-[9px] text-slate-500 mt-1">
                        {item.role} · {item.note}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-slate-500">Bronkwaliteit wordt zichtbaar zodra de worker deze samenvatting opnieuw heeft opgebouwd.</div>
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

      <div className="glass-card rounded-2xl border border-blue-500/10 p-5 bg-blue-950/5">
        <div className="text-[10px] font-black text-blue-300 uppercase mb-3">Zelflerende modelcontrole</div>
        {modelPerformance ? (
          <div className="space-y-3">
            <div className="text-[11px] text-slate-300">{modelPerformance.summary}</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {[
                { label: "Reviews", value: modelPerformance.overall?.matches || 0 },
                { label: "Score exact", value: `${Math.round(Number(modelPerformance.overall?.exactHitRate || 0) * 100)}%` },
                { label: "Winnaar/gelijk", value: `${Math.round(Number(modelPerformance.overall?.outcomeHitRate || 0) * 100)}%` },
                { label: "BTTS", value: `${Math.round(Number(modelPerformance.overall?.bttsHitRate || 0) * 100)}%` },
                { label: "Over 2.5", value: `${Math.round(Number(modelPerformance.overall?.over25HitRate || 0) * 100)}%` },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/5 bg-slate-950/35 px-3 py-2">
                  <div className="text-[8px] font-black text-slate-500 uppercase">{item.label}</div>
                  <div className="text-[15px] font-black text-white mt-1">{item.value}</div>
                </div>
              ))}
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
                <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Confidence kalibratie</div>
                <div className="space-y-2">
                  {(modelPerformance.confidenceBuckets || []).map((bucket: any) => (
                    <div key={bucket.key} className="flex items-center justify-between gap-3 text-[10px]">
                      <span className="text-slate-300">{bucket.key}</span>
                      <span className="font-black text-white">
                        {Math.round(Number(bucket.outcomeHitRate || 0) * 100)}% uitkomst, fout {bucket.avgGoalError}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
                <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Reliability bins</div>
                <div className="space-y-2">
                  {(modelPerformance.calibrationBuckets || []).filter((bucket: any) => Number(bucket.matches || 0) > 0).map((bucket: any) => (
                    <div key={bucket.key} className="flex items-center justify-between gap-3 text-[10px]">
                      <span className="text-slate-300">{bucket.label}</span>
                      <span className="font-black text-white">
                        {Math.round(Number(bucket.observedOutcomeRate || 0) * 100)}% echt, fout {bucket.calibrationError ?? "-"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
                <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Competities met meeste aandacht</div>
                <div className="space-y-2">
                  {(modelPerformance.weakestLeagues || []).slice(0, 5).map((league: any) => (
                    <div key={league.key} className="text-[10px]">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-300">{league.key}</span>
                        <span className="font-black text-white">{Math.round(Number(league.outcomeHitRate || 0) * 100)}%</span>
                      </div>
                      <div className="text-[9px] text-slate-500">Reviews {league.matches}, foutmarge {league.avgGoalError}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-slate-500">Modelcontrole verschijnt na de volgende worker-run.</div>
        )}
      </div>

      <div className="glass-card rounded-2xl border border-amber-500/10 p-5 bg-amber-950/5">
        <div className="text-[10px] font-black text-amber-300 uppercase mb-3">Backtest en datakwaliteit</div>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
            <div className="text-[11px] font-black text-white mb-1">Backtest uit opgeslagen reviews</div>
            <div className="text-[10px] text-slate-400 mb-3">
              {backtestSummary?.summary || "Nog geen backtestsamenvatting beschikbaar."}
            </div>
            <div className="space-y-2">
              {(backtestSummary?.strategies || []).slice(0, 4).map((strategy: any) => (
                <div key={strategy.key} className="flex items-center justify-between gap-3 text-[10px]">
                  <span className="text-slate-300">{strategy.key}</span>
                  <span className="font-black text-white">
                    {Math.round(Number(strategy.outcomeHitRate || 0) * 100)}% / exact {Math.round(Number(strategy.exactHitRate || 0) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
            <div className="text-[11px] font-black text-white mb-1">Datacompleetheid</div>
            <div className="text-[10px] text-slate-400 mb-3">
              {dataCompletenessAudit?.summary || "Nog geen datacompleetheid-audit beschikbaar."}
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {[
                { label: "Gemiddeld", value: `${Math.round(Number(dataCompletenessAudit?.averageScore || 0) * 100)}%` },
                { label: "Timestamp", value: `${Math.round(Number(dataCompletenessAudit?.sourceTimestampCoverage || 0) * 100)}%` },
                { label: "Live odds", value: `${Math.round(Number(dataCompletenessAudit?.coverage?.liveOdds || 0) * 100)}%` },
                { label: "Lineups", value: `${Math.round(Number(dataCompletenessAudit?.coverage?.lineups || 0) * 100)}%` },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-white/5 bg-slate-950/30 px-2 py-2">
                  <div className="text-[8px] font-black text-slate-500 uppercase">{item.label}</div>
                  <div className="text-[13px] font-black text-white mt-1">{item.value}</div>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              {(dataCompletenessAudit?.missingReasons || []).slice(0, 4).map((item: any) => (
                <div key={item.reason} className="flex items-center justify-between gap-2 text-[9px]">
                  <span className="text-slate-400 truncate">{item.reason}</span>
                  <span className="font-black text-white">{item.count}x</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
            <div className="text-[11px] font-black text-white mb-1">Odds readiness</div>
            <div className="text-[10px] text-slate-400 mb-3">
              {oddsIntegrationReadiness?.nextAction || "Nog geen odds readiness beschikbaar."}
            </div>
            <div className="space-y-2">
              {[
                { label: "Provider", value: oddsIntegrationReadiness?.providerConfigured ? "klaar" : "mist" },
                { label: "Pred odds", value: `${Math.round(Number(oddsIntegrationReadiness?.currentCoverage?.predictions || 0) * 100)}%` },
                { label: "Snapshots", value: `${Math.round(Number(oddsIntegrationReadiness?.currentCoverage?.snapshots || 0) * 100)}%` },
                { label: "Historisch", value: `${Math.round(Number(oddsIntegrationReadiness?.currentCoverage?.historicalMarketOnly || 0) * 100)}%` },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 text-[10px]">
                  <span className="text-slate-300">{item.label}</span>
                  <span className="font-black text-white">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="text-[11px] font-black text-white">Anomaly-detectie</div>
              <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${
                Number(anomalyReport?.criticalCount || 0) > 0
                  ? "bg-red-900/30 text-red-300"
                  : "bg-green-900/30 text-green-300"
              }`}>
                {Number(anomalyReport?.criticalCount || 0)} kritisch
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mb-3">
              {anomalyReport?.summary || "Nog geen datacontrole beschikbaar."}
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {(anomalyReport?.anomalies || []).slice(0, 6).map((item: any) => (
                <div key={item.type} className="rounded-lg border border-white/5 bg-slate-950/30 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] font-black text-white">{item.type}</div>
                    <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${
                      item.severity === "high" ? "bg-red-900/30 text-red-300" : item.severity === "medium" ? "bg-amber-900/30 text-amber-300" : "bg-slate-800 text-slate-300"
                    }`}>
                      {item.severity}
                    </span>
                  </div>
                  <div className="text-[9px] text-slate-400 mt-1">{item.message}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Modelvalidatie uit reviewdata</div>
        {featureDiagnostics ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3">
              <div className="text-[11px] font-black text-white">{featureDiagnostics.summary}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                {[
                  { label: "Reviews", value: featureDiagnostics.reviews || 0 },
                  { label: "Exact hit", value: `${Math.round(Number(featureDiagnostics.exactHitRate || 0) * 100)}%` },
                  { label: "Uitkomst hit", value: `${Math.round(Number(featureDiagnostics.outcomeHitRate || 0) * 100)}%` },
                  { label: "Topkans hit", value: `${Math.round(Number(featureDiagnostics.probabilityOutcomeHitRate || 0) * 100)}%` },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-white/5 bg-slate-950/40 px-3 py-2">
                    <div className="text-[8px] font-black text-slate-500 uppercase">{item.label}</div>
                    <div className="text-[15px] font-black text-white mt-1">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
                <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Belangrijkste faalsignalen</div>
                <div className="space-y-2">
                  {(featureDiagnostics.topFailureSignals || []).slice(0, 5).map((item: any) => (
                    <div key={item.signal} className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-300">{item.signal}</span>
                      <span className="font-black text-white">{item.count}x</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
                <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Faseprestaties</div>
                <div className="space-y-2">
                  {(featureDiagnostics.phaseBreakdown || []).slice(0, 5).map((item: any) => (
                    <div key={item.phase} className="text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">{item.phase}</span>
                        <span className="font-black text-white">{item.matches} duels</span>
                      </div>
                      <div className="text-slate-500 mt-0.5">
                        Exact {Math.round(Number(item.exactHitRate || 0) * 100)}% · Uitkomst {Math.round(Number(item.outcomeHitRate || 0) * 100)}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {featureDiagnostics.topConfidence && (
              <div className="rounded-xl border border-blue-500/10 bg-blue-950/10 p-3">
                <div className="text-[10px] font-black text-blue-300 uppercase mb-2">Top 5 meest zekere tips</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { label: "Reviews", value: featureDiagnostics.topConfidence.matches || 0 },
                    { label: "Juiste score", value: `${Math.round(Number(featureDiagnostics.topConfidence.exactHitRate || 0) * 100)}%` },
                    { label: "Juiste winnaar/gelijk", value: `${Math.round(Number(featureDiagnostics.topConfidence.outcomeHitRate || 0) * 100)}%` },
                    { label: "Nr. 1 winnaar/gelijk", value: `${Math.round(Number(featureDiagnostics.topConfidence.rank1OutcomeHitRate || 0) * 100)}%` },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-white/5 bg-slate-950/30 px-3 py-2">
                      <div className="text-[8px] font-black text-slate-500 uppercase">{item.label}</div>
                      <div className="text-[15px] font-black text-white mt-1">{item.value}</div>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-slate-300 mt-3">
                  Gem. foutmarge {featureDiagnostics.topConfidence.avgGoalError} · verschil met totale uitkomst-hitrate{" "}
                  <span className="font-black text-white">
                    {Number(featureDiagnostics.topConfidence.versusOverallOutcomeDelta || 0) >= 0 ? "+" : ""}
                    {Math.round(Number(featureDiagnostics.topConfidence.versusOverallOutcomeDelta || 0) * 100)}%
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-slate-500">Nog geen modelvalidatie opgebouwd uit reviewdata.</div>
        )}
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
              name: "TheSportsDB",
              status: "gekoppeld",
              desc: "Draait nu mee als gratis fixture-backup voor dagen waarop de hoofdbron wedstrijden niet teruggeeft.",
            },
            {
              name: "Forza Football",
              status: "fallback",
              desc: "Nieuwe extra spelerslijstbron. Wordt alleen aangeroepen wanneer de eerste selectiebron niet genoeg spelers/statusinformatie geeft.",
            },
            {
              name: "football-data.org",
              status: "optioneel",
              desc: "Staat klaar als officiële squad-API fallback met gratis token en veilige team-id mapping; zonder token blijft deze bron netjes uit.",
            },
            {
              name: "Reep Football",
              status: "fallback",
              desc: "Wordt gebruikt als koppel-laag voor clubnamen, team-ID's en logo-matching zodra een REEP_TEAM_MAP beschikbaar is.",
            },
            {
              name: "OpenLigaDB",
              status: "gekoppeld",
              desc: "Extra gratis fallbackbron voor vooral Duitse competities, zodat wedstrijddagen minder snel leeg vallen.",
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
              name: "openfootball",
              status: "aanbevolen",
              desc: "Interessante open historische bron voor extra H2H/backfill, vooral wanneer live-bronnen te dun blijven.",
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

