import React, { useMemo, useState } from "react";
import { Match } from "../types";
import { getWorldCup2026Fixtures, getWorldCup2026Teams } from "../shared/worldCup2026.js";
import { countryFlagEmoji, countryFlagSources } from "../shared/countryFlags";

interface WorldCupViewProps {
  liveMatches: Match[];
  predictions: Record<string, any>;
}

function matchDateLabel(match: any) {
  return new Date(match.kickoff || `${match.date}T12:00:00Z`).toLocaleString("nl-NL", {
    timeZone: "Europe/Amsterdam",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function predictedScore(match: any, predictions: Record<string, any>) {
  const prediction = predictions[match.id] || match.prediction || match;
  const home = prediction?.predHomeGoals;
  const away = prediction?.predAwayGoals;
  return Number.isFinite(Number(home)) && Number.isFinite(Number(away)) ? `${home}-${away}` : "-";
}

function actualScore(match: any) {
  if (typeof match.score === "string" && /^\s*\d+\s*[-:]\s*\d+\s*$/.test(match.score)) {
    return match.score.replace(":", "-").replace(/\s+/g, "");
  }
  return Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore)
    ? `${match.homeScore}-${match.awayScore}`
    : null;
}

function CountryFlag({ name }: { name: string }) {
  const sources = countryFlagSources(name, "World - FIFA World Cup 2026");
  const [attempt, setAttempt] = useState(0);
  if (!sources.length || attempt >= sources.length) {
    return <span className="text-lg leading-none" aria-hidden="true">{countryFlagEmoji(name, "World - FIFA World Cup 2026") || "🏳️"}</span>;
  }
  return (
    <img
      src={sources[attempt]}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      className="h-4 w-6 rounded-sm border border-white/15 object-cover"
      onError={() => setAttempt((value) => value + 1)}
    />
  );
}

function WorldCupTeamLabel({ name, align }: { name: string; align: "left" | "right" }) {
  return (
    <div className={`flex items-center gap-2 text-sm font-black text-white ${align === "right" ? "justify-end text-right" : ""}`}>
      {align === "left" && <CountryFlag name={name} />}
      <span>{name}</span>
      {align === "right" && <CountryFlag name={name} />}
    </div>
  );
}

const WorldCupView: React.FC<WorldCupViewProps> = ({ liveMatches, predictions }) => {
  const [group, setGroup] = useState("alle");
  const [show, setShow] = useState<"vandaag" | "komend" | "alle">("vandaag");

  const fixtures = useMemo(() => {
    const currentById = new Map(liveMatches.map((match) => [match.id, match]));
    return getWorldCup2026Fixtures().map((fixture: any) => {
      const current = currentById.get(fixture.id) as Match | undefined;
      return current ? { ...fixture, ...current } : fixture;
    });
  }, [liveMatches]);

  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const groups = useMemo(
    () => [...new Set(fixtures.map((match: any) => match.worldCup2026?.group).filter(Boolean))].sort(),
    [fixtures]
  );

  const visibleFixtures = useMemo(() => {
    const now = Date.now();
    return fixtures.filter((match: any) => {
      if (group !== "alle" && match.worldCup2026?.group !== group) return false;
      if (show === "vandaag") return match.date === today;
      if (show === "komend") return Date.parse(match.kickoff || match.date) >= now;
      return true;
    });
  }, [fixtures, group, show, today]);

  const finished = fixtures.filter((match: any) => ["FT", "AET", "PEN"].includes(String(match.status || "").toUpperCase()));
  const live = fixtures.filter((match: any) => ["LIVE", "HT"].includes(String(match.status || "").toUpperCase()));
  const coverage = fixtures.filter((match: any) => Number(match.dataCompletenessScore || match.dataCompleteness?.score || 0) >= 0.7);
  const teamCount = getWorldCup2026Teams().length;

  return (
    <section className="space-y-4">
      <div className="glass-card rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300">Een centrale FootyAI-site</p>
            <h2 className="mt-1 text-2xl font-black text-white">WK 2026 overzicht</h2>
            <p className="mt-1 max-w-3xl text-xs text-slate-400">
              Fixtures, actuele scores, modelvoorspellingen en datadekking uit dezelfde worker en hetzelfde datacontract als het hoofddashboard.
            </p>
          </div>
          <div className="rounded-xl border border-cyan-400/20 bg-slate-950/50 px-3 py-2 text-right">
            <div className="text-[9px] font-black uppercase text-slate-500">Toernooi</div>
            <div className="text-sm font-black text-cyan-200">{fixtures.length} wedstrijden / {teamCount} landen</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          ["Vandaag", fixtures.filter((match: any) => match.date === today).length, "text-blue-300"],
          ["Live", live.length, "text-red-300"],
          ["Gespeeld", finished.length, "text-emerald-300"],
          ["Rijke data", coverage.length, "text-cyan-300"],
        ].map(([label, value, tone]) => (
          <article key={String(label)} className="glass-card rounded-xl border border-white/10 p-3">
            <div className="text-[9px] font-black uppercase text-slate-500">{label}</div>
            <div className={`text-2xl font-black ${tone}`}>{value}</div>
          </article>
        ))}
      </div>

      <div className="glass-card rounded-2xl border border-white/10 p-4">
        <div className="mb-4 flex flex-wrap gap-2">
          {(["vandaag", "komend", "alle"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setShow(value)}
              className={`rounded-lg px-3 py-1.5 text-[10px] font-black uppercase ${
                show === value ? "bg-cyan-500 text-slate-950" : "bg-slate-800 text-slate-300"
              }`}
            >
              {value}
            </button>
          ))}
          <span className="mx-1 h-7 w-px bg-white/10" />
          {["alle", ...groups].map((value) => (
            <button
              key={value}
              onClick={() => setGroup(value)}
              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase ${
                group === value ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400"
              }`}
            >
              {value === "alle" ? "Alle groepen" : `Groep ${value}`}
            </button>
          ))}
        </div>

        {visibleFixtures.length ? (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {visibleFixtures.map((match: any) => {
              const status = String(match.status || "NS").toUpperCase();
              const isLive = ["LIVE", "HT"].includes(status);
              const finalScore = actualScore(match);
              const completeness = Math.round(Number(match.dataCompletenessScore || match.dataCompleteness?.score || 0) * 100);
              return (
                <article key={match.id} className="rounded-xl border border-white/10 bg-slate-950/45 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2 text-[9px] font-black uppercase text-slate-500">
                    <span>Match {match.worldCup2026?.matchNumber || "-"} · {match.roundLabel || "WK 2026"}</span>
                    <span className={isLive ? "text-red-300" : status === "FT" ? "text-emerald-300" : "text-slate-400"}>
                      {status}
                    </span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <WorldCupTeamLabel name={match.homeTeamName} align="right" />
                    <div className="rounded-lg bg-slate-800 px-3 py-2 text-center text-sm font-black text-cyan-200">
                      {finalScore || predictedScore(match, predictions)}
                      {finalScore && <div className="text-[7px] uppercase text-emerald-300">Eindstand</div>}
                    </div>
                    <WorldCupTeamLabel name={match.awayTeamName} align="left" />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-slate-500">
                    <span>{matchDateLabel(match)}</span>
                    <span>Datadekking {completeness}%</span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm font-bold text-slate-500">
            Geen WK-wedstrijden binnen dit filter.
          </div>
        )}
      </div>
    </section>
  );
};

export default WorldCupView;
