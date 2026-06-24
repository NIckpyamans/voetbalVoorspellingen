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
  const [dataContext, setDataContext] = useState<any | null>(null);
  const [databaseIntegration, setDatabaseIntegration] = useState<any | null>(null);
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
  const [worldCupReadiness, setWorldCupReadiness] = useState<any | null>(null);
  const [worldCupProjection, setWorldCupProjection] = useState<any | null>(null);
  const [worldCupRatings, setWorldCupRatings] = useState<any | null>(null);
  const [manualAdvice, setManualAdvice] = useState("");
  const [glassTransparency, setGlassTransparency] = useState(46);
  const [settingsWarning, setSettingsWarning] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettingsMetadata = async () => {
      try {
        const response = await fetch(`/api/matches?date=${todayAmsterdamKey()}`);
        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !contentType.includes("json")) {
          throw new Error(`Instellingen ophalen mislukt (${response.status})`);
        }
        const data = await response.json().catch(() => ({}));
        if (data.ok === false) throw new Error(data.error || `Instellingen ophalen mislukt (${response.status})`);
        return data;
      } catch {
        const fallback = await fetch(`/data/meta.json?t=${Date.now()}`, { cache: "no-store" });
        const data = await fallback.json().catch(() => ({}));
        if (!fallback.ok || !data?.workerVersion) {
          throw new Error(`Lokale metadata ophalen mislukt (${fallback.status})`);
        }
        return { ...data, sourceBranch: "lokale data-snapshot" };
      }
    };

    const applyMetadata = (data: any) => {
      if (data.lastRun) setLastWorker(new Date(data.lastRun).toLocaleString("nl-NL"));
      if (data.workerVersion) setWorkerVersion(data.workerVersion);
      if (data.sourceBranch) setSourceBranch(data.sourceBranch);
      if (data.reviewCount != null) setReviewCount(Number(data.reviewCount || 0));
      if (data.teamLearningCount != null) setTeamLearningCount(Number(data.teamLearningCount || 0));
      if (Array.isArray(data.aiAdvice)) setAiAdvice(data.aiAdvice);
      if (data.biweeklyDigest) setBiweeklyDigest(data.biweeklyDigest);
      if (data.dataContext) setDataContext(data.dataContext);
      if (data.databaseIntegration) setDatabaseIntegration(data.databaseIntegration);
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
      if (data.worldCup2026Readiness) setWorldCupReadiness(data.worldCup2026Readiness);
      if (data.worldCup2026Projection) setWorldCupProjection(data.worldCup2026Projection);
      if (data.worldCup2026Ratings) setWorldCupRatings(data.worldCup2026Ratings);
      setAnalysisEngine("template");
    };

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

    fetchSettingsMetadata()
      .then(applyMetadata)
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
  const dataScore = Number(dataCompletenessAudit?.averageScore || 0);
  const timestampCoverage = Number(dataCompletenessAudit?.sourceTimestampCoverage || 0);
  const hasAuditMatches = Number(dataCompletenessAudit?.matches || 0) > 0;
  const calibrationError = Number(modelPerformance?.calibrationSummary?.averageAbsoluteError || 0);
  const oddsProviderConfigured = !!oddsIntegrationReadiness?.providerConfigured;
  const liveOddsCoverage = Number(oddsIntegrationReadiness?.currentCoverage?.predictions || 0);
  const snapshotCoverage = Number(backtestSummary?.leakageSummary?.snapshotCoverage || modelPerformance?.metricCoverage?.snapshots || 0);
  const providerTeamIdCoverage = Number(dataCompletenessAudit?.coverage?.providerTeamIds ?? sourceCoverage?.providerTeamIdCoverage ?? 0);
  const xgCoverage = Number(dataCompletenessAudit?.coverage?.xgShots ?? Math.max(Number(sourceCoverage?.understatCoverage || 0), Number(sourceCoverage?.fbrefCoverage || 0)));
  const lineupCoverage = Number(sourceCoverage?.lineupConfirmedCoverage ?? dataCompletenessAudit?.coverage?.lineups ?? 0);
  const availabilityCoverage = Number(sourceCoverage?.availabilityCoverage ?? 0);
  const criticalAnomalies = Number(anomalyReport?.criticalCount || 0);
  const healthParts = [
    hasAuditMatches ? dataScore : 0.5,
    hasAuditMatches ? timestampCoverage : 0.5,
    calibrationError ? Math.max(0, 1 - calibrationError / 0.28) : 0.45,
    oddsProviderConfigured ? Math.max(0.55, liveOddsCoverage) : 0,
    Math.max(snapshotCoverage, 0.2),
    criticalAnomalies > 0 ? 0.2 : 1,
  ];
  const professionalScore = Math.round((healthParts.reduce((sum, value) => sum + value, 0) / healthParts.length) * 100);
  const professionalLevel =
    professionalScore >= 82
      ? "productierijp"
      : professionalScore >= 68
        ? "serieus fundament"
        : professionalScore >= 50
          ? "professionaliseren"
          : "hoog risico";
  const healthSignals = [
    {
      label: "Datacompleetheid",
      value: hasAuditMatches ? `${Math.round(dataScore * 100)}%` : "geen duels",
      tone: !hasAuditMatches || dataScore >= 0.75 ? "good" : dataScore >= 0.58 ? "warn" : "bad",
    },
    {
      label: "Source timestamps",
      value: hasAuditMatches ? `${Math.round(timestampCoverage * 100)}%` : "n.v.t.",
      tone: !hasAuditMatches || timestampCoverage >= 0.9 ? "good" : timestampCoverage >= 0.65 ? "warn" : "bad",
    },
    {
      label: "Kalibratiefout",
      value: calibrationError ? calibrationError.toFixed(3) : "onbekend",
      tone: calibrationError && calibrationError <= 0.08 ? "good" : calibrationError <= 0.14 ? "warn" : "bad",
    },
    {
      label: "Echte odds",
      value: oddsProviderConfigured ? `${Math.round(liveOddsCoverage * 100)}%` : "provider mist",
      tone: oddsProviderConfigured && liveOddsCoverage >= 0.5 ? "good" : "bad",
    },
  ];
  const improvementQueue = [
    {
      title: "Echte odds + closing odds koppelen",
      impact: "hoog",
      effort: "middel",
      status: oddsProviderConfigured ? "geborgd" : "open",
      detail: oddsProviderConfigured
        ? `Provider actief, huidige pred-odds dekking ${Math.round(liveOddsCoverage * 100)}%.`
        : "ROI, CLV en value-bets blijven niet professioneel meetbaar zonder pre-match en closing odds.",
    },
    {
      title: "Provider team-ID dekking verhogen",
      impact: "hoog",
      effort: "middel",
      status: providerTeamIdCoverage >= 0.85 ? "geborgd" : "open",
      detail: `Dekking staat op ${Math.round(providerTeamIdCoverage * 100)}%; naamfallback werkt, maar is kwetsbaarder bij clubs met aliassen.`,
    },
    {
      title: "Snapshot-backed training versnellen",
      impact: "hoog",
      effort: "laag",
      status: snapshotCoverage >= 0.6 ? "geborgd" : "open",
      detail: `Snapshotdekking in reviews staat op ${Math.round(snapshotCoverage * 100)}%; nieuwe voorspellingen moeten eerst eindigen voor lekvrije trainingsrijen.`,
    },
    {
      title: "xG, lineups en referee dieper vullen",
      impact: "middel",
      effort: "middel",
      status: xgCoverage >= 0.7 && lineupCoverage >= 0.45 && availabilityCoverage >= 0.7 ? "geborgd" : "open",
      detail: `xG/shot dekking ${Math.round(xgCoverage * 100)}%, bevestigde lineups ${Math.round(lineupCoverage * 100)}%, blessures/schorsingen ${Math.round(availabilityCoverage * 100)}%.`,
    },
    {
      title: "Database als bron van waarheid",
      impact: "hoog",
      effort: "hoog",
      status: databaseIntegration?.databaseConfigured ? "geborgd" : "open",
      detail: databaseIntegration?.databaseConfigured
        ? "Neon is de primaire bron; JSON blijft alleen export- en storingsfallback."
        : "Activeer Postgres met immutable snapshots en evaluaties als primaire waarheid.",
    },
  ];
  const coveragePlan = Array.isArray(sourceCoverage?.coverageImprovementPlan)
    ? sourceCoverage.coverageImprovementPlan
    : [
        {
          key: "provider_team_ids",
          label: "Provider team-IDs",
          coverage: providerTeamIdCoverage,
          target: 0.9,
          status: providerTeamIdCoverage >= 0.9 ? "ok" : "needs_mapping",
          action: "Vul REEP_TEAM_MAP/football-data.org team mapping aan voor wedstrijden uit naamfallback-bronnen.",
        },
        {
          key: "lineups",
          label: "Bevestigde opstellingen",
          coverage: lineupCoverage,
          target: 0.45,
          status: lineupCoverage >= 0.45 ? "ok" : "pre_match_pending",
          action: "Blijf lineups vlak voor kickoff verversen; open lineups blijven confidence-penalty.",
        },
        {
          key: "referee_history",
          label: "Historische scheidsprofielen",
          coverage: Number(sourceCoverage?.refereeCoverage || 0),
          target: 0.65,
          status: Number(sourceCoverage?.refereeCoverage || 0) >= 0.65 ? "ok" : "needs_aliases",
          action: "Breid referee aliasen en football-data.co.uk archieven per competitie uit.",
        },
        {
          key: "availability",
          label: "Blessures/schorsingen",
          coverage: availabilityCoverage,
          target: 0.75,
          status: availabilityCoverage >= 0.75 ? "ok" : "needs_source_depth",
          action: "Gebruik Sofascore spelersstatus eerst, daarna Transfermarkt/football-data.org fallback.",
        },
      ];

  return (
    <div className="max-w-5xl space-y-5">
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

      <div className="grid xl:grid-cols-[0.9fr_1.1fr] gap-4">
        <div className="glass-card rounded-2xl border border-cyan-500/10 p-5 bg-cyan-950/5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-black text-cyan-300 uppercase">Professionele systeemscore</div>
              <div className="text-[11px] text-slate-400 mt-1">Gebaseerd op data, kalibratie, odds, snapshots en datarisco's.</div>
            </div>
            <span className={`text-[9px] font-black px-2.5 py-1 rounded-full ${
              professionalScore >= 68 ? "bg-emerald-900/30 text-emerald-300" : professionalScore >= 50 ? "bg-amber-900/30 text-amber-300" : "bg-red-900/30 text-red-300"
            }`}>
              {professionalLevel}
            </span>
          </div>
          <div className="mt-5 flex items-end gap-3">
            <div className="text-5xl font-black text-white leading-none">{professionalScore}</div>
            <div className="pb-1 text-[11px] font-black text-slate-400 uppercase">/ 100</div>
          </div>
          <div className="mt-4 h-2 rounded-full bg-slate-950/70 overflow-hidden">
            <div
              className={`h-full rounded-full ${professionalScore >= 68 ? "bg-emerald-400" : professionalScore >= 50 ? "bg-amber-400" : "bg-red-400"}`}
              style={{ width: `${Math.max(4, Math.min(100, professionalScore))}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4">
            {healthSignals.map((signal) => (
              <div key={signal.label} className="rounded-xl border border-white/5 bg-slate-950/35 px-3 py-2">
                <div className="text-[8px] font-black text-slate-500 uppercase">{signal.label}</div>
                <div className={`text-[14px] font-black mt-1 ${
                  signal.tone === "good" ? "text-emerald-300" : signal.tone === "warn" ? "text-amber-300" : "text-red-300"
                }`}>
                  {signal.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card rounded-2xl border border-white/5 p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase">Wat nu beter kan</div>
              <div className="text-[11px] text-slate-500 mt-1">Prioriteiten uit de laatste professionele audit, gesorteerd op waarde voor betrouwbaarheid.</div>
            </div>
            <span className="text-[9px] font-black px-2.5 py-1 rounded-full bg-slate-900/80 text-slate-300">
              {improvementQueue.filter((item) => item.status === "open").length} open
            </span>
          </div>
          <div className="space-y-2">
            {improvementQueue.map((item) => (
              <div key={item.title} className="rounded-xl border border-white/5 bg-slate-950/30 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12px] font-black text-white">{item.title}</div>
                    <div className="text-[10px] text-slate-400 mt-1 leading-relaxed">{item.detail}</div>
                  </div>
                  <span className={`shrink-0 text-[8px] font-black px-2 py-0.5 rounded-full ${
                    item.status === "geborgd" ? "bg-emerald-900/30 text-emerald-300" : "bg-amber-900/30 text-amber-300"
                  }`}>
                    {item.status}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[8px] font-black uppercase">
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-400">impact {item.impact}</span>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-400">moeite {item.effort}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl border border-emerald-500/20 p-5 bg-emerald-950/10">
        <h3 className="text-sm font-black uppercase text-emerald-200">WK 2026 zichtbaarheid</h3>
        <p className="text-[11px] text-slate-400 mt-1">
          Status van de onderdelen die je noemde: selectie, oefenduels, topvorm, ranking en doorrekening.
        </p>
        <div className="mt-3 grid md:grid-cols-2 gap-2">
          {[
            { key: "squads", label: "Nationale selecties" },
            { key: "friendlies", label: "Recente interlands/oefenduels" },
            { key: "playerTopForm", label: "Speler-topvorm" },
            { key: "fifaRankingElo", label: "FIFA ranking/Elo" },
            { key: "groupAndKnockoutProjection", label: "Groepsstanden + knock-out" },
          ].map((item) => {
            const info = worldCupReadiness?.[item.key] || null;
            const status = String(info?.status || "onduidelijk");
            const tone =
              status.includes("seeded") || status.includes("partially")
                ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
                : status.includes("required")
                  ? "border-red-500/30 bg-red-500/10 text-red-100"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
            return (
              <div key={item.key} className={`rounded-xl border p-3 ${tone}`}>
                <div className="text-[10px] font-black uppercase">{item.label}</div>
                <div className="mt-1 text-[9px] font-black opacity-90">{status.replace(/_/g, " ")}</div>
                <div className="mt-1 text-[10px] text-slate-200">{info?.detail || "onduidelijk"}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="glass-card rounded-2xl border border-cyan-500/20 p-4 bg-cyan-950/10">
          <div className="text-[10px] font-black uppercase text-cyan-200">WK ranking refresh</div>
          <div className="mt-1 text-[11px] text-slate-400">
            {worldCupRatings?.sourceMode ? `Modus: ${worldCupRatings.sourceMode}` : "Nog geen ranking snapshot"}
          </div>
          <div className="mt-2 text-[10px] text-slate-300">
            Laatste update: {worldCupRatings?.updatedAt ? new Date(worldCupRatings.updatedAt).toLocaleString("nl-NL") : "onbekend"}
          </div>
          <div className="mt-2 text-[10px] text-slate-300">
            Teams met rating: {Object.keys(worldCupRatings?.ratings || {}).length}
          </div>
        </div>

        <div className="glass-card rounded-2xl border border-indigo-500/20 p-4 bg-indigo-950/10">
          <div className="text-[10px] font-black uppercase text-indigo-200">WK live projectie</div>
          <div className="mt-1 text-[11px] text-slate-400">
            Status: {worldCupProjection?.status || "onbekend"}
          </div>
          <div className="mt-2 text-[10px] text-slate-300">
            Groepsduels verwerkt: {worldCupProjection?.completedGroupMatches ?? 0}/{worldCupProjection?.totalGroupMatches ?? 72}
          </div>
          <div className="mt-2 text-[10px] text-slate-300">
            Round of 32 gevuld: {Array.isArray(worldCupProjection?.roundOf32) ? worldCupProjection.roundOf32.length : 0}
          </div>
        </div>
      </div>

      {coveragePlan.length > 0 && (
        <div className="glass-card rounded-2xl border border-white/5 p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase">Dekkingsplan databronnen</div>
              <div className="text-[11px] text-slate-500 mt-1">Lineups, scheidsrechters, team-ID's en beschikbaarheid met doelpercentage per bronlaag.</div>
            </div>
            <span className="text-[9px] font-black px-2.5 py-1 rounded-full bg-slate-900/80 text-slate-300">
              {coveragePlan.filter((item: any) => item.status !== "ok").length} aandacht
            </span>
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            {coveragePlan.map((item: any) => {
              const coverage = Number(item.coverage || 0);
              const target = Number(item.target || 0);
              return (
                <div key={item.key || item.label} className="rounded-xl border border-white/5 bg-slate-950/30 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] font-black text-white">{item.label || item.key}</div>
                    <div className={coverage >= target ? "text-[12px] font-black text-emerald-300" : "text-[12px] font-black text-amber-300"}>
                      {Math.round(coverage * 100)}%
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-950/80 overflow-hidden">
                    <div
                      className={coverage >= target ? "h-full bg-emerald-400" : "h-full bg-amber-400"}
                      style={{ width: `${Math.max(4, Math.min(100, coverage * 100))}%` }}
                    />
                  </div>
                  <div className="mt-2 text-[10px] text-slate-400 leading-relaxed">{item.action}</div>
                  <div className="mt-2 text-[8px] font-black uppercase text-slate-500">doel {Math.round(target * 100)}% - {item.status}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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

            {biweeklyDigest.architectureAudit ? (
              <div className="rounded-xl border border-emerald-500/10 bg-emerald-950/10 p-3">
                <div className="text-[10px] font-black text-emerald-300 uppercase mb-1">Architectuuranalyse</div>
                <div className="text-[10px] text-slate-300 mb-3">{biweeklyDigest.architectureAudit.summary}</div>
                <div className="space-y-2">
                  {(biweeklyDigest.architectureAudit.findings || []).slice(0, 5).map((item: any) => (
                    <div key={item.key} className="rounded-lg border border-white/5 bg-slate-950/30 p-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[10px] font-black text-white">{item.title}</div>
                        <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-red-900/20 text-red-200">
                          {item.priority}
                        </span>
                      </div>
                      <div className="text-[9px] text-slate-400 mt-1">Probleem: {item.problem}</div>
                      <div className="text-[9px] text-slate-500 mt-1">Oplossing: {item.solution}</div>
                      <div className="text-[8px] text-emerald-300 mt-1">Impact: {item.expectedImpact}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-blue-500/10 bg-blue-950/10 p-3">
              <div className="text-[10px] font-black text-blue-300 uppercase mb-2">Standaard uitgevoerd</div>
              <div className="space-y-2">
                {((biweeklyDigest.standardActions || biweeklyDigest.architectureAudit?.standardActions || []) as any[])
                  .slice(0, 3)
                  .map((item: any) => (
                    <div key={item.key} className="rounded-lg border border-white/5 bg-slate-950/30 p-2">
                      <div className="text-[10px] font-black text-white">{item.title}</div>
                      <div className="text-[9px] text-slate-500 mt-1">{item.output}</div>
                    </div>
                  ))}
              </div>
            </div>

            {biweeklyDigest.dataQuality ? (
              <div className="rounded-xl border border-rose-500/10 bg-rose-950/10 p-3">
                <div className="text-[10px] font-black text-rose-300 uppercase mb-2">Datakwaliteit</div>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {[
                    { label: "Pending", value: biweeklyDigest.dataQuality.totals?.pendingResultBackfills || 0 },
                    { label: "Scores missen", value: biweeklyDigest.dataQuality.totals?.missingPastScores || 0 },
                    { label: "H2H", value: `${Math.round(Number(biweeklyDigest.dataQuality.totals?.h2hCoverage || 0) * 100)}%` },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border border-white/5 bg-slate-950/30 p-2">
                      <div className="text-[8px] font-black text-slate-500 uppercase">{item.label}</div>
                      <div className="text-[12px] font-black text-white mt-1">{item.value}</div>
                    </div>
                  ))}
                </div>
                {(biweeklyDigest.dataQuality.recommendations || []).slice(0, 2).map((item: string, index: number) => (
                  <div key={`${item}-${index}`} className="text-[9px] text-slate-400 mt-1">{item}</div>
                ))}
              </div>
            ) : null}

            <div className="rounded-xl border border-amber-500/10 bg-amber-950/10 p-3">
              <div className="text-[10px] font-black text-amber-300 uppercase mb-2">Volgende aanbevelingen</div>
              <div className="space-y-2">
                {(biweeklyDigest.nextRecommendations || biweeklyDigest.architectureAudit?.nextRecommendations || [])
                  .slice(0, 5)
                  .map((item: any, index: number) => (
                    <div key={`${item.title}-${index}`} className="rounded-lg border border-white/5 bg-slate-950/30 p-2">
                      <div className="text-[10px] font-black text-white">{index + 1}. {item.title}</div>
                      <div className="text-[9px] text-slate-400 mt-1">{item.reason}</div>
                    </div>
                  ))}
              </div>
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


      <div className="glass-card rounded-2xl border border-teal-500/10 p-5 bg-teal-950/5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[10px] font-black text-teal-300 uppercase">Data Analytics contextlaag</div>
            <div className="text-[11px] text-slate-400 mt-1">
              Ordeningslaag voor datasets, KPI's, QA-regels en dashboardcontracten. Niet als opslagmotor, wel als analysehub bovenop Postgres.
            </div>
          </div>
          <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-teal-900/30 text-teal-300">
            {dataContext ? "actief" : "wacht op context"}
          </span>
        </div>

        {dataContext ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Domeinen", value: Object.keys(dataContext.domains || {}).length },
                { label: "Datasets", value: Object.values(dataContext.domains || {}).flat().length },
                { label: "KPI's", value: (dataContext.primaryKpis || []).length },
                { label: "Dashboards", value: (dataContext.defaultDashboardSections || []).length },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/5 bg-slate-950/30 px-3 py-2">
                  <div className="text-[8px] font-black text-slate-500 uppercase">{item.label}</div>
                  <div className="text-[15px] font-black text-white mt-1">{item.value}</div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-emerald-500/10 bg-emerald-950/10 p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <div className="text-[10px] font-black text-emerald-300 uppercase">Gratis bronnenstrategie</div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    Werkt zonder betaalde sport-API keys; betaalde bronnen blijven optioneel.
                  </div>
                </div>
                <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-300">
                  {dataContext.freeSourceMode?.enabled ? "free-source mode" : "niet actief"}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { label: "Gratis bronnen", value: (dataContext.freeSourceStrategy?.sources || []).length },
                  { label: "High priority", value: (dataContext.freeSourceStrategy?.sources || []).filter((source: any) => source.priority === "high").length },
                  { label: "Gevolgde clubs", value: (dataContext.followedClubContext?.clubs || []).length },
                  { label: "Club verrijkt", value: (dataContext.followedClubContext?.clubs || []).filter((club: any) => club.external?.theSportsDb?.ok).length },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-white/5 bg-slate-950/30 p-2">
                    <div className="text-[8px] font-black text-slate-500 uppercase">{item.label}</div>
                    <div className="text-[13px] font-black text-white mt-1">{item.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(dataContext.freeSourceStrategy?.sources || []).slice(0, 7).map((source: any) => (
                  <span key={source.id} className="rounded-full border border-emerald-500/10 bg-slate-950/40 px-2 py-1 text-[8px] font-black text-emerald-200">
                    {source.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase">Database/API-output</div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    {databaseIntegration?.nextAction || "Database-integratie status wordt opgehaald."}
                  </div>
                </div>
                <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${
                  databaseIntegration?.databaseConfigured ? "bg-green-900/30 text-green-300" : "bg-amber-900/30 text-amber-300"
                }`}>
                  {databaseIntegration?.databaseConfigured ? "Postgres klaar" : "JSON fallback"}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { label: "DB matches", value: databaseIntegration?.counts?.matches || 0 },
                  { label: "Snapshots", value: databaseIntegration?.counts?.prediction_snapshots || 0 },
                  { label: "Source records", value: databaseIntegration?.sourceLineageBackfill?.sourceRecords || 0 },
                  { label: "Audit rows", value: databaseIntegration?.counts?.source_audit || databaseIntegration?.sourceLineageBackfill?.appliedCounts?.source_audit || 0 },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-white/5 bg-slate-950/30 p-2">
                    <div className="text-[8px] font-black text-slate-500 uppercase">{item.label}</div>
                    <div className="text-[13px] font-black text-white mt-1">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
                <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Belangrijkste KPI's</div>
                <div className="flex flex-wrap gap-1.5">
                  {(dataContext.primaryKpis || []).slice(0, 10).map((kpi: string) => (
                    <span key={kpi} className="rounded-full border border-white/10 bg-slate-950/40 px-2 py-1 text-[9px] font-black text-slate-300">
                      {kpi}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
                <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Quality gates</div>
                <div className="space-y-2">
                  {Object.entries(dataContext.qualityGates || {}).slice(0, 5).map(([key, value]) => (
                    <div key={key} className="text-[10px]">
                      <span className="font-black text-white">{key}: </span>
                      <span className="text-slate-400">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3">
              <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Welke apps/plugins geven voordeel?</div>
              <div className="grid md:grid-cols-2 gap-2">
                {Object.entries(dataContext.appEcosystem || {}).map(([key, app]: [string, any]) => (
                  <div key={key} className="rounded-lg border border-white/5 bg-slate-950/30 p-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[10px] font-black text-white">{key}</div>
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${
                        app.priority === "high" ? "bg-green-900/30 text-green-300" : "bg-amber-900/30 text-amber-300"
                      }`}>
                        {app.priority || "medium"}
                      </span>
                    </div>
                    <div className="text-[9px] text-slate-400 mt-1">{app.role}</div>
                    <div className="text-[8px] text-slate-500 mt-1">
                      {(app.useFor || []).slice(0, 2).join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/10 bg-amber-950/10 p-3">
              <div className="text-[10px] font-black text-amber-300 uppercase mb-2">Optimale inzet</div>
              <div className="space-y-1">
                {(dataContext.recommendedNextActions || []).slice(0, 5).map((item: string, index: number) => (
                  <div key={`${item}-${index}`} className="text-[10px] text-slate-300">
                    {index + 1}. {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-slate-500">
            Data Analytics context verschijnt zodra `docs/data-context/analysis-context.json` via de API beschikbaar is.
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
            {Array.isArray(dataScout.regressionAssertions) && dataScout.regressionAssertions.length > 0 && (
              <div className="rounded-xl border border-rose-500/10 bg-rose-950/10 p-3">
                <div className="text-[10px] font-black text-rose-300 uppercase mb-2">
                  Regressie assertions {dataScout.degraded ? "(degraded)" : "(ok)"}
                </div>
                <div className="space-y-1.5">
                  {dataScout.regressionAssertions.map((item: any) => (
                    <div key={item.key} className="text-[10px] text-slate-300">
                      <span className={`font-black mr-1 ${item.passed ? "text-emerald-300" : "text-rose-300"}`}>
                        {item.passed ? "PASS" : "FAIL"}
                      </span>
                      {item.key}: {item.detail}
                    </div>
                  ))}
                </div>
                {dataScout.selfHealing && (
                  <div className="text-[10px] text-slate-400 mt-2">
                    Self-healing: attempted {Number(dataScout.selfHealing.attempted || 0)} · healed {Number(dataScout.selfHealing.healed || 0)}
                  </div>
                )}
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
            {Array.isArray(dataScout?.backtestSegmentation?.driftAlerts) && dataScout.backtestSegmentation.driftAlerts.length > 0 && (
              <div className="rounded-xl border border-amber-500/10 bg-amber-950/10 p-3">
                <div className="text-[10px] font-black text-amber-300 uppercase mb-1">Backtest drift alerts</div>
                <div className="space-y-1">
                  {dataScout.backtestSegmentation.driftAlerts.slice(0, 6).map((row: any, idx: number) => (
                    <div key={`${row.scope}-${row.key}-${idx}`} className="text-[10px] text-slate-300">
                      {row.scope} {row.key}: {Math.round(Number(row.delta || 0) * 100)}pp ({Math.round(Number(row.previous || 0) * 100)}% → {Math.round(Number(row.current || 0) * 100)}%)
                    </div>
                  ))}
                </div>
              </div>
            )}
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

