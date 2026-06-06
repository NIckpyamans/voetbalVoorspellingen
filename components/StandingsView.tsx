import React, { useEffect, useMemo, useState } from "react";

interface StandingRow {
  pos: number;
  team: string;
  teamId: string;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
}

interface StandingMetaZone {
  key: string;
  label: string;
  color: string;
  from: number;
  to: number;
}

interface LeagueStanding {
  label: string;
  rows: StandingRow[];
  updated: number;
  source?: string;
  sources?: Array<{
    source: string;
    rows?: number;
    totalPlayed?: number;
    liveApplied?: number;
  }>;
  liveOverlay?: {
    applied?: number;
    liveApplied?: number;
    updated?: number;
  };
  lastResultDate?: string | null;
  meta?: {
    format?: string;
    zones?: StandingMetaZone[];
    notes?: string[];
  };
}

interface KnockoutItem {
  league: string;
  roundLabel?: string | null;
  stakes?: string | null;
  matchId: string;
  kickoff?: string | null;
  homeTeamName: string;
  awayTeamName: string;
  aggregate?: any;
  score?: string | null;
  status?: string;
}

interface CupSheet {
  league: string;
  rounds: Record<string, KnockoutItem[]>;
}

interface DatabaseSeasonTeam {
  clubId: string;
  clubName: string;
  entryReason: string;
  previousLevel?: number | null;
  previousStandingPosition?: number | null;
  previousStandingPoints?: number | null;
  previousStandingSource?: string | null;
  currentLevel?: number | null;
  status?: string;
}

interface DatabaseSeasonTransition {
  key: string;
  competitionId: string;
  competitionName?: string;
  countryName?: string;
  level?: number | null;
  seasonId: string;
  yearLabel?: string;
  teams: DatabaseSeasonTeam[];
  promoted: DatabaseSeasonTeam[];
  relegated: DatabaseSeasonTeam[];
  retained: DatabaseSeasonTeam[];
  newOrPromoted: DatabaseSeasonTeam[];
}

interface DatabaseSeasonOverview {
  databaseConfigured?: boolean;
  zeroStandings?: Array<{
    competitionId: string;
    competitionName?: string;
    countryName?: string;
    level?: number | null;
    seasonId: string;
    yearLabel?: string;
    rows: StandingRow[];
  }>;
  transitions?: DatabaseSeasonTransition[];
  error?: string;
}

interface CompetitionCoverageMetric {
  count: number;
  pct: number;
}

interface CompetitionCoverage {
  label: string;
  competitionId?: string;
  competitionName?: string;
  countryName?: string;
  matches: number;
  weather: CompetitionCoverageMetric;
  h2h: CompetitionCoverageMetric;
  xg: CompetitionCoverageMetric;
  oddsHistory: CompetitionCoverageMetric;
  seasonReset: CompetitionCoverageMetric;
  missing?: Record<string, Array<{
    matchId: string;
    date?: string;
    homeTeam: string;
    awayTeam: string;
  }>>;
}

function zoneClasses(color?: string) {
  if (color === "blue") return "border-l-blue-500 text-blue-400";
  if (color === "amber") return "border-l-amber-500 text-amber-400";
  if (color === "red") return "border-l-red-500 text-red-400";
  return "border-l-slate-600 text-slate-400";
}

function scoreLoser(item: KnockoutItem) {
  const aggregate = item.aggregate;
  if (!aggregate?.active || !aggregate.aggregateScore) return null;
  if (!aggregate.leader) return null;
  return aggregate.leader === item.homeTeamName ? item.awayTeamName : item.homeTeamName;
}

function roundWeight(round: string) {
  const text = String(round || "").toLowerCase();
  if (text.includes("final")) return 90;
  if (text.includes("semi")) return 80;
  if (text.includes("quarter")) return 70;
  if (text.includes("acht")) return 60;
  if (text.includes("round of 16")) return 60;
  if (text.includes("laatste 16")) return 60;
  if (text.includes("play-off")) return 50;
  if (text.includes("32")) return 40;
  return 10;
}

function buildRouteHint(items: KnockoutItem[], index: number) {
  if (items.length < 2) return null;
  const pairStart = Math.floor(index / 2) * 2;
  const siblingIndex = index % 2 === 0 ? pairStart + 1 : pairStart;
  const sibling = items[siblingIndex];
  if (!sibling || sibling.matchId === items[index].matchId) return null;
  return `Bij winst tegen winnaar van ${sibling.homeTeamName} vs ${sibling.awayTeamName}`;
}

function nextRoundLabel(rounds: string[], currentIndex: number) {
  if (currentIndex >= rounds.length - 1) return null;
  return rounds[currentIndex + 1];
}

const HIDDEN_STANDINGS_KEY = "footyai-hidden-standings";
const FAVORITE_STANDING_KEY = "footyai-favorite-standing";
const DEFAULT_FAVORITE_STANDING_LABEL = "Netherlands - Eredivisie";

function readHiddenStandings() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HIDDEN_STANDINGS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function readFavoriteStanding() {
  if (typeof window === "undefined") return DEFAULT_FAVORITE_STANDING_LABEL;
  try {
    return window.localStorage.getItem(FAVORITE_STANDING_KEY) || DEFAULT_FAVORITE_STANDING_LABEL;
  } catch {
    return DEFAULT_FAVORITE_STANDING_LABEL;
  }
}

function sourceLabel(source?: string) {
  const value = String(source || "").toLowerCase();
  if (value.includes("live-match-overlay")) return "Live berekend";
  if (value.includes("football-data")) return "football-data.co.uk";
  if (value.includes("openfootball")) return "openfootball";
  if (value.includes("openligadb")) return "OpenLigaDB";
  if (value.includes("sofascore")) return "Sofascore";
  return source || "cache";
}

function normalizeLeagueLabel(value?: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function reasonLabel(reason?: string) {
  if (reason === "promoted") return "Gepromoveerd";
  if (reason === "relegated") return "Gedegradeerd";
  if (reason === "new_or_promoted") return "Nieuw/promotie";
  return "Behoud";
}

function coverageTone(pct?: number) {
  const value = Number(pct || 0);
  if (value >= 75) return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  if (value >= 35) return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  if (value > 0) return "border-sky-500/20 bg-sky-500/10 text-sky-200";
  return "border-slate-700 bg-slate-800/70 text-slate-400";
}

const StandingsView: React.FC = () => {
  const [standings, setStandings] = useState<Record<string, LeagueStanding>>({});
  const [cupSheets, setCupSheets] = useState<Record<string, CupSheet>>({});
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"league" | "cup">("league");
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [selectedCup, setSelectedCup] = useState<string | null>(null);
  const [hiddenLeagueLabels, setHiddenLeagueLabels] = useState<string[]>(readHiddenStandings);
  const [showLeagueManager, setShowLeagueManager] = useState(true);
  const [favoriteStandingLabel, setFavoriteStandingLabel] = useState<string>(readFavoriteStanding);
  const [databaseSeasonOverview, setDatabaseSeasonOverview] = useState<DatabaseSeasonOverview | null>(null);
  const [databaseCoverageByCompetition, setDatabaseCoverageByCompetition] = useState<CompetitionCoverage[]>([]);
  const [selectedCoverageKey, setSelectedCoverageKey] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(HIDDEN_STANDINGS_KEY, JSON.stringify(hiddenLeagueLabels));
    } catch {
      // Local storage is optional; filters still work for the current session.
    }
  }, [hiddenLeagueLabels]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FAVORITE_STANDING_KEY, favoriteStandingLabel);
      window.dispatchEvent(new Event("footyai-favorite-standing-change"));
    } catch {
      // Local storage is optional; favorite selection still works in session.
    }
  }, [favoriteStandingLabel]);

  useEffect(() => {
    fetch(`/api/standings?t=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        const nextStandings = data.standings || {};
        const nextCupSheets = data.cupSheets || {};
        setStandings(nextStandings);
        setCupSheets(nextCupSheets);
        setDatabaseSeasonOverview(data.databaseSeasonOverview || null);
        setDatabaseCoverageByCompetition(Array.isArray(data.databaseCoverageByCompetition) ? data.databaseCoverageByCompetition : []);

        const standingKeys = Object.keys(nextStandings);
        const cupKeys = Object.keys(nextCupSheets);
        const preferredLeague =
          standingKeys.find((key) => String(nextStandings[key]?.label || key) === readFavoriteStanding()) ||
          standingKeys.find((key) => String(nextStandings[key]?.label || key) === DEFAULT_FAVORITE_STANDING_LABEL) ||
          standingKeys.find((key) => String(nextStandings[key]?.label || key).toLowerCase().includes("eredivisie")) ||
          standingKeys[0];
        if (preferredLeague) setSelectedLeague(preferredLeague);
        if (cupKeys.length > 0) setSelectedCup(cupKeys[0]);
        if (standingKeys.length === 0 && cupKeys.length > 0) setMode("cup");
      })
      .finally(() => setLoading(false));
  }, []);

  const sortedLeagueKeys = useMemo(() => {
    const byLabel = new Map<string, string>();
    for (const key of Object.keys(standings)) {
      const label = String(standings[key]?.label || key);
      const currentKey = byLabel.get(label);
      const currentRows = currentKey ? standings[currentKey]?.rows?.length || 0 : 0;
      const nextRows = standings[key]?.rows?.length || 0;
      const prefersLabelKey = key.startsWith("label:") && !String(currentKey || "").startsWith("label:");
      if (!currentKey || prefersLabelKey || nextRows > currentRows) byLabel.set(label, key);
    }
    return [...byLabel.values()].sort((a, b) =>
      String(standings[a]?.label || "").localeCompare(String(standings[b]?.label || ""))
    );
  }, [standings]);

  const visibleLeagueKeys = useMemo(() => {
    const hidden = new Set(hiddenLeagueLabels);
    return sortedLeagueKeys.filter((key) => !hidden.has(String(standings[key]?.label || key)));
  }, [hiddenLeagueLabels, sortedLeagueKeys, standings]);

  const hiddenLeagueKeys = useMemo(() => {
    const hidden = new Set(hiddenLeagueLabels);
    return sortedLeagueKeys.filter((key) => hidden.has(String(standings[key]?.label || key)));
  }, [hiddenLeagueLabels, sortedLeagueKeys, standings]);

  const sortedCupKeys = useMemo(() => {
    return Object.keys(cupSheets).sort((a, b) => a.localeCompare(b));
  }, [cupSheets]);

  useEffect(() => {
    const selectable = visibleLeagueKeys.length > 0 ? visibleLeagueKeys : sortedLeagueKeys;
    if (selectable.length > 0 && (!selectedLeague || !selectable.includes(selectedLeague))) {
      setSelectedLeague(selectable[0]);
    }
  }, [selectedLeague, sortedLeagueKeys, visibleLeagueKeys]);

  useEffect(() => {
    setSelectedCoverageKey(null);
  }, [selectedLeague]);

  const currentStanding = selectedLeague ? standings[selectedLeague] : null;
  const currentCup = selectedCup ? cupSheets[selectedCup] : null;
  const currentSeasonTransition = useMemo(() => {
    if (!currentStanding || !databaseSeasonOverview?.transitions?.length) return null;
    const target = normalizeLeagueLabel(currentStanding.label);
    return (
      databaseSeasonOverview.transitions.find((item) => {
        const labels = [
          item.competitionName,
          item.countryName && item.competitionName ? `${item.countryName} ${item.competitionName}` : null,
          item.countryName && item.competitionName ? `${item.countryName} - ${item.competitionName}` : null,
        ].map((label) => normalizeLeagueLabel(label || ""));
        return labels.some((label) => label && (target.includes(label) || label.includes(target)));
      }) || null
    );
  }, [currentStanding, databaseSeasonOverview]);
  const currentZeroStanding = useMemo(() => {
    if (!currentStanding || !databaseSeasonOverview?.zeroStandings?.length) return null;
    const target = normalizeLeagueLabel(currentStanding.label);
    return (
      databaseSeasonOverview.zeroStandings.find((item) => {
        const labels = [
          item.competitionName,
          item.countryName && item.competitionName ? `${item.countryName} ${item.competitionName}` : null,
          item.countryName && item.competitionName ? `${item.countryName} - ${item.competitionName}` : null,
        ].map((label) => normalizeLeagueLabel(label || ""));
        return labels.some((label) => label && (target.includes(label) || label.includes(target)));
      }) || null
    );
  }, [currentStanding, databaseSeasonOverview]);
  const currentCoverage = useMemo(() => {
    if (!currentStanding || !databaseCoverageByCompetition.length) return null;
    const target = normalizeLeagueLabel(currentStanding.label);
    return (
      databaseCoverageByCompetition.find((item) => {
        const labels = [
          item.label,
          item.competitionName,
          item.countryName && item.competitionName ? `${item.countryName} ${item.competitionName}` : null,
          item.countryName && item.competitionName ? `${item.countryName} - ${item.competitionName}` : null,
        ].map((label) => normalizeLeagueLabel(label || ""));
        return labels.some((label) => label && (target.includes(label) || label.includes(target)));
      }) || null
    );
  }, [currentStanding, databaseCoverageByCompetition]);
  const currentSources =
    currentStanding?.sources?.length
      ? currentStanding.sources
      : currentStanding
        ? [{ source: currentStanding.source || "cache", rows: currentStanding.rows.length }]
        : [];
  const selectedCoverageMissing = currentCoverage && selectedCoverageKey
    ? currentCoverage.missing?.[selectedCoverageKey] || []
    : [];

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((index) => (
          <div key={index} className="h-12 glass-card rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (sortedLeagueKeys.length === 0 && sortedCupKeys.length === 0) {
    return (
      <div className="text-center py-20 text-slate-500">
        <div className="text-5xl mb-3">Standen</div>
        <div className="font-bold">Standen en bekerschema verschijnen na de volgende worker run.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-black text-white uppercase tracking-tight">Standen & bekerschema</h2>
        <p className="text-slate-500 text-xs mt-1">
          Competities en bekerwedstrijden staan nu apart, per toernooi en ronde.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setMode("league")}
          className={`px-4 py-2 rounded-xl text-xs font-black ${
            mode === "league" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"
          }`}
        >
          Standen
        </button>
        <button
          onClick={() => setMode("cup")}
          className={`px-4 py-2 rounded-xl text-xs font-black ${
            mode === "cup" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"
          }`}
        >
          Bekerschema
        </button>
      </div>

      {mode === "league" && sortedLeagueKeys.length > 0 && (
        <>
          <div className="rounded-2xl border border-white/5 bg-slate-950/40 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-black uppercase text-slate-300">Competities kiezen</div>
                <div className="text-[10px] text-slate-500">
                  Zet competities aan of uit. Klik op ★ om de favoriete competitie rechts op het dashboard te tonen.
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowLeagueManager((value) => !value)}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-[10px] font-black text-slate-200 hover:bg-slate-700"
                >
                  {showLeagueManager ? "Verberg beheer" : "Beheer competities"}
                </button>
                <button
                  onClick={() => setHiddenLeagueLabels([])}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-[10px] font-black text-white hover:bg-blue-500"
                >
                  Alles aan
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px]">
              <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/10 p-2">
                <div className="font-black text-emerald-200">Zichtbaar</div>
                <div className="text-lg font-black text-white">{visibleLeagueKeys.length}</div>
              </div>
              <div className="rounded-xl border border-slate-500/15 bg-slate-500/10 p-2">
                <div className="font-black text-slate-300">Verborgen</div>
                <div className="text-lg font-black text-white">{hiddenLeagueKeys.length}</div>
              </div>
              <div className="rounded-xl border border-yellow-500/15 bg-yellow-500/10 p-2">
                <div className="font-black text-yellow-200">Dashboard favoriet</div>
                <div className="truncate text-sm font-black text-white">{favoriteStandingLabel}</div>
              </div>
            </div>

            {showLeagueManager && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { title: "Zichtbaar", keys: visibleLeagueKeys, empty: "Geen zichtbare competities." },
                  { title: "Verborgen", keys: hiddenLeagueKeys, empty: "Nog niets verborgen." },
                ].map((column) => (
                  <div key={column.title} className="rounded-xl border border-white/5 bg-slate-900/55 p-2">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[10px] font-black uppercase text-white">{column.title}</div>
                      <div className="rounded-full bg-slate-800 px-2 py-0.5 text-[9px] font-black text-slate-400">
                        {column.keys.length}
                      </div>
                    </div>
                    <div className="max-h-56 overflow-y-auto pr-1 space-y-1.5">
                      {column.keys.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-[10px] font-bold text-slate-500">
                          {column.empty}
                        </div>
                      ) : (
                        column.keys.map((key) => {
                          const label = String(standings[key]?.label || key);
                          const hidden = hiddenLeagueLabels.includes(label);
                          const favorite = favoriteStandingLabel === label;
                          return (
                            <div key={key} className="flex items-center gap-1 rounded-lg bg-slate-950/50 p-1">
                              <button
                                onClick={() =>
                                  setHiddenLeagueLabels((current) =>
                                    current.includes(label)
                                      ? current.filter((item) => item !== label)
                                      : [...current, label]
                                  )
                                }
                                className={`flex-1 rounded-md px-2.5 py-1.5 text-left text-[9px] font-black transition ${
                                  hidden
                                    ? "bg-slate-800 text-slate-500 line-through"
                                    : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20"
                                }`}
                              >
                                {hidden ? "Verborgen" : "Zichtbaar"} - {label}
                              </button>
                              <button
                                title="Maak favoriet op dashboard"
                                onClick={() => {
                                  setFavoriteStandingLabel(label);
                                  if (hidden) {
                                    setHiddenLeagueLabels((current) => current.filter((item) => item !== label));
                                  }
                                }}
                                className={`h-7 w-8 rounded-md text-[11px] font-black ${
                                  favorite
                                    ? "bg-yellow-400 text-slate-950"
                                    : "bg-slate-800 text-slate-400 hover:bg-yellow-400/20 hover:text-yellow-200"
                                }`}
                              >
                                ★
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-2">
            {(visibleLeagueKeys.length ? visibleLeagueKeys : sortedLeagueKeys).map((key) => {
              const label = standings[key]?.label || key;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedLeague(key)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-black transition ${
                    selectedLeague === key ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {currentStanding && (
            <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 bg-slate-950/40 px-4 py-3">
                <div>
                  <div className="text-sm font-black uppercase text-white">{currentStanding.label}</div>
                  <div className="text-[10px] text-slate-500">
                    Laatste resultaat: {currentStanding.lastResultDate || "onbekend"}
                    {currentStanding.liveOverlay?.applied ? ` · overlay ${currentStanding.liveOverlay.applied} wedstrijd(en)` : ""}
                    {currentStanding.liveOverlay?.liveApplied ? ` · live ${currentStanding.liveOverlay.liveApplied}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setFavoriteStandingLabel(currentStanding.label)}
                    className={`rounded-full px-2 py-1 text-[9px] font-black border ${
                      favoriteStandingLabel === currentStanding.label
                        ? "bg-yellow-400 text-slate-950 border-yellow-300"
                        : "bg-yellow-500/10 text-yellow-200 border-yellow-500/20 hover:bg-yellow-500/20"
                    }`}
                  >
                    ★ dashboard favoriet
                  </button>
                  {currentSources.map((source, index) => (
                    <span key={index} className="rounded-full bg-blue-500/10 px-2 py-1 text-[9px] font-black text-blue-200 border border-blue-500/20">
                      {sourceLabel(source.source)}
                      {source.liveApplied ? ` · live ${source.liveApplied}` : source.totalPlayed ? ` · ${source.totalPlayed}` : ""}
                    </span>
                  ))}
                </div>
              </div>
              {currentCoverage && (
                <div className="border-b border-white/5 bg-slate-950/35 px-4 py-3">
                  <div className="mb-2 text-[9px] font-black uppercase text-slate-400">
                    Database coverage per competitie · {currentCoverage.matches} wedstrijden
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { key: "weather", label: "Weer", metric: currentCoverage.weather },
                      { key: "h2h", label: "H2H", metric: currentCoverage.h2h },
                      { key: "xg", label: "xG/stats", metric: currentCoverage.xg },
                      { key: "oddsHistory", label: "Odds history", metric: currentCoverage.oddsHistory },
                      { key: "seasonReset", label: "Season reset", metric: currentCoverage.seasonReset },
                    ].map(({ key, label, metric }) => (
                      <button
                        key={key}
                        onClick={() => setSelectedCoverageKey((current) => current === key ? null : key)}
                        className={`rounded-full border px-2 py-1 text-[9px] font-black transition hover:-translate-y-0.5 ${coverageTone(metric.pct)} ${
                          selectedCoverageKey === key ? "ring-2 ring-white/30" : ""
                        }`}
                      >
                        {label} {metric.pct}%
                      </button>
                    ))}
                  </div>
                  {selectedCoverageKey && (
                    <div className="mt-3 rounded-xl border border-white/5 bg-slate-950/70 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-[10px] font-black uppercase text-white">
                          Ontbrekende data · {selectedCoverageKey}
                        </div>
                        <button
                          onClick={() => setSelectedCoverageKey(null)}
                          className="rounded-md bg-slate-800 px-2 py-1 text-[9px] font-black text-slate-300"
                        >
                          Sluiten
                        </button>
                      </div>
                      {selectedCoverageMissing.length ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                          {selectedCoverageMissing.map((match) => (
                            <div key={`${selectedCoverageKey}-${match.matchId}`} className="rounded-lg bg-slate-900/80 px-2.5 py-2 text-[9px]">
                              <div className="font-black text-slate-200">{match.homeTeam} - {match.awayTeam}</div>
                              <div className="text-slate-500">{match.date || "datum onbekend"}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[10px] font-bold text-emerald-300">
                          Geen ontbrekende wedstrijden in de begrensde databasecontrole.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {(currentSeasonTransition || currentZeroStanding || databaseSeasonOverview?.error) && (
                <div className="border-b border-white/5 bg-slate-950/55 px-4 py-3">
                  {databaseSeasonOverview?.error ? (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] font-bold text-amber-200">
                      Database seizoenanalyse tijdelijk niet beschikbaar: {databaseSeasonOverview.error}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                      <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/10 p-3">
                        <div className="text-[9px] font-black uppercase text-cyan-200">Seizoenreset database</div>
                        <div className="mt-1 text-xl font-black text-white">
                          {currentZeroStanding?.rows?.length || currentSeasonTransition?.teams?.length || 0}
                        </div>
                        <div className="text-[10px] text-cyan-100/80">
                          teams starten op nul in {currentZeroStanding?.yearLabel || currentSeasonTransition?.yearLabel || "huidig seizoen"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/10 p-3">
                        <div className="text-[9px] font-black uppercase text-emerald-200">Promotie zichtbaar</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(currentSeasonTransition?.promoted?.length
                            ? currentSeasonTransition.promoted
                            : currentSeasonTransition?.newOrPromoted || []
                          ).slice(0, 8).map((team) => (
                            <span key={team.clubId} className="rounded-full bg-emerald-400/15 px-2 py-1 text-[9px] font-black text-emerald-100">
                              {team.clubName}
                            </span>
                          ))}
                          {!currentSeasonTransition?.promoted?.length && !currentSeasonTransition?.newOrPromoted?.length && (
                            <span className="text-[10px] font-bold text-emerald-100/70">Geen promoties gemarkeerd.</span>
                          )}
                        </div>
                      </div>
                      <div className="rounded-xl border border-red-500/15 bg-red-500/10 p-3">
                        <div className="text-[9px] font-black uppercase text-red-200">Degradatie zichtbaar</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(currentSeasonTransition?.relegated || []).slice(0, 8).map((team) => (
                            <span key={team.clubId} className="rounded-full bg-red-400/15 px-2 py-1 text-[9px] font-black text-red-100">
                              {team.clubName}
                            </span>
                          ))}
                          {!currentSeasonTransition?.relegated?.length && (
                            <span className="text-[10px] font-bold text-red-100/70">Geen degradaties gemarkeerd.</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-12 gap-1 px-4 py-2 bg-slate-900/60 text-[8px] font-black text-slate-400 uppercase">
                <div className="col-span-1">#</div>
                <div className="col-span-4">Club</div>
                <div className="col-span-1 text-center">W</div>
                <div className="col-span-1 text-center">G</div>
                <div className="col-span-1 text-center">V</div>
                <div className="col-span-1 text-center">+/-</div>
                <div className="col-span-1 text-center">Dg</div>
                <div className="col-span-2 text-right text-white">Pnt</div>
              </div>

              <div className="max-h-[68vh] overflow-y-auto">
                {currentStanding.rows.map((row, index) => {
                  const goalDiff = (row.gf || 0) - (row.ga || 0);
                  const zone =
                    currentStanding.meta?.zones?.find(
                      (item) => row.pos >= item.from && row.pos <= item.to
                    ) || null;

                  return (
                    <div
                      key={row.teamId || `${row.team}-${index}`}
                      className={`grid grid-cols-12 gap-1 px-4 py-2.5 border-b border-white/5 last:border-0 text-sm items-center hover:bg-white/3 transition border-l-2 ${zoneClasses(zone?.color)}`}
                    >
                      <div className="col-span-1 text-[11px] font-black">{row.pos}</div>
                      <div className="col-span-4">
                        <div className="flex items-center gap-2">
                          {row.teamId && (
                            <img
                              src={`https://api.sofascore.app/api/v1/team/${row.teamId}/image`}
                              className="w-5 h-5 object-contain"
                              alt=""
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          )}
                          <span className="text-[11px] font-black text-white truncate">{row.team}</span>
                        </div>
                        {currentSeasonTransition?.teams?.find((team) => team.clubName === row.team)?.entryReason && (
                          <div className="mt-0.5 text-[8px] font-black uppercase text-slate-500">
                            {reasonLabel(currentSeasonTransition.teams.find((team) => team.clubName === row.team)?.entryReason)}
                            {currentSeasonTransition.teams.find((team) => team.clubName === row.team)?.previousStandingPosition
                              ? ` · vorig seizoen #${currentSeasonTransition.teams.find((team) => team.clubName === row.team)?.previousStandingPosition}`
                              : ""}
                          </div>
                        )}
                      </div>
                      <div className="col-span-1 text-center text-[11px] text-green-400 font-bold">{row.w}</div>
                      <div className="col-span-1 text-center text-[11px] text-slate-400 font-bold">{row.d}</div>
                      <div className="col-span-1 text-center text-[11px] text-red-400 font-bold">{row.l}</div>
                      <div className={`col-span-1 text-center text-[11px] font-bold ${goalDiff > 0 ? "text-green-400" : goalDiff < 0 ? "text-red-400" : "text-slate-500"}`}>
                        {goalDiff > 0 ? `+${goalDiff}` : goalDiff}
                      </div>
                      <div className="col-span-1 text-center text-[10px] text-slate-500">{row.p}</div>
                      <div className="col-span-2 text-right">
                        <span className="text-sm font-black text-white bg-slate-800 px-2 py-0.5 rounded-lg">{row.pts}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="px-4 py-3 bg-slate-900/40 space-y-2">
                <div className="flex flex-wrap gap-3">
                  {(currentStanding.meta?.zones || []).map((zone) => (
                    <div key={zone.key} className="flex items-center gap-1.5">
                      <div className={`w-2 h-3 rounded-sm ${zone.color === "blue" ? "bg-blue-500" : zone.color === "amber" ? "bg-amber-500" : zone.color === "red" ? "bg-red-500" : "bg-slate-500"}`} />
                      <span className="text-[8px] text-slate-400">
                        {zone.label} ({zone.from}-{zone.to})
                      </span>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-slate-500">
                  Broncontrole: deze tabel wordt na elke worker-run opnieuw opgebouwd en daarna aangevuld met
                  live/FT-wedstrijden uit de opgeslagen dagdata.
                </div>
                {(currentStanding.meta?.notes || []).map((note, index) => (
                  <div key={index} className="text-[10px] text-slate-500">
                    {note}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {mode === "cup" && sortedCupKeys.length > 0 && (
        <>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
            {sortedCupKeys.map((key) => (
              <button
                key={key}
                onClick={() => setSelectedCup(key)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-black transition ${
                  selectedCup === key ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {key}
              </button>
            ))}
          </div>

          {currentCup && (
            <div className="glass-card rounded-2xl border border-white/5 p-4">
              <div className="text-sm font-black uppercase text-white mb-3">{currentCup.league}</div>
              <div className="overflow-x-auto scrollbar-hide pb-2">
                <div className="flex gap-4 min-w-max">
                  {(Object.entries(currentCup.rounds) as Array<[string, KnockoutItem[]]>)
                    .map(([round, items]) => [round, items.filter((item) => item.league === selectedCup)] as const)
                    .filter(([, items]) => items.length > 0)
                    .sort((a, b) => roundWeight(a[0]) - roundWeight(b[0]))
                    .map(([round], _, arr) => round)
                    .map((round, roundIndex, roundLabels) => {
                      const items = (currentCup.rounds[round] || [])
                        .filter((item) => item.league === selectedCup)
                        .sort((a, b) => String(a.kickoff || "").localeCompare(String(b.kickoff || "")));
                      const nextRound = nextRoundLabel(roundLabels, roundIndex);

                      return (
                        <section key={round} className="w-[320px] flex-shrink-0">
                          <div className="text-sm font-black uppercase text-white mb-3">{round}</div>
                          <div className="space-y-3">
                            {items.map((item, index) => {
                              const loser = scoreLoser(item);
                              const routeHint = buildRouteHint(items, index);
                              return (
                                <div key={item.matchId} className="rounded-xl border border-white/5 bg-slate-900/50 p-3">
                                  <div className="text-[11px] text-slate-400">
                                    {item.stakes || "Knock-out"}
                                  </div>
                                  <div className="mt-2 space-y-1">
                                    <div className={`text-sm font-black ${loser === item.homeTeamName ? "text-slate-500 line-through" : "text-white"}`}>
                                      {item.homeTeamName}
                                    </div>
                                    <div className={`text-sm font-black ${loser === item.awayTeamName ? "text-slate-500 line-through" : "text-white"}`}>
                                      {item.awayTeamName}
                                    </div>
                                  </div>
                                  <div className="text-[11px] text-slate-300 mt-2">
                                    Duel: {item.score || "Nog niet gestart"}
                                  </div>
                                  {item.aggregate?.active && (
                                    <>
                                      <div className="text-[11px] text-amber-300 mt-1">
                                        Eerste duel: {item.aggregate.firstLegText || item.aggregate.firstLegScore || "onbekend"}
                                      </div>
                                      <div className="text-[11px] text-amber-300">
                                        Aggregate: {item.aggregate.aggregateScore || "-"}
                                        {item.aggregate.leader ? ` · ${item.aggregate.leader} door` : ""}
                                      </div>
                                    </>
                                  )}
                                  {routeHint && nextRound && (
                                    <div className="text-[11px] text-slate-500 mt-2">
                                      Naar {nextRound}: {routeHint}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default StandingsView;
