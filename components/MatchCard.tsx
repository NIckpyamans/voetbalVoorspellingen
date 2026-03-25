import React, { useEffect, useMemo, useRef, useState } from "react";
import { Match } from "../types";
import { FavoriteButton } from "./FavoriteTeams";

interface MatchCardProps {
  match: Match;
  prediction?: any;
  onFavoriteChange?: () => void;
}

function parseMinuteValue(minute?: string | number | null, minuteValue?: number | null) {
  if (typeof minuteValue === "number" && Number.isFinite(minuteValue)) return minuteValue;
  if (typeof minute === "number" && Number.isFinite(minute)) return minute;
  if (!minute) return null;
  if (String(minute).toUpperCase() === "HT") return 45;
  const plusMatch = String(minute).match(/(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) return Number(plusMatch[1]) + Number(plusMatch[2]);
  const plainMatch = String(minute).match(/(\d+)/);
  return plainMatch ? Number(plainMatch[1]) : null;
}

function useLiveMinute(match: any) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (String(match?.status || "").toUpperCase() !== "LIVE" && !match?.minute && !match?.minuteValue) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [match?.status, match?.minute, match?.minuteValue, match?.liveUpdatedAt]);

  return useMemo(() => {
    const period = String(match?.period || "").toLowerCase();
    if (period.includes("half time") || period.includes("halftime") || period.includes("break")) return "HT";
    const base = parseMinuteValue(match?.minute, match?.minuteValue);
    if (base == null) return String(match?.status || "").toUpperCase() === "LIVE" ? "LIVE" : null;
    const updatedAt = Number(match?.liveUpdatedAt || 0) || 0;
    const drift = updatedAt > 0 ? Math.max(0, Math.floor((now - updatedAt) / 60000)) : 0;
    const total = base + drift;
    return total > 90 ? `90+${total - 90}'` : `${total}'`;
  }, [match, now]);
}

function fmt(probability: number) {
  return probability > 0.01 ? (1 / probability).toFixed(2) : "-";
}

function badgeTone(tone = "slate") {
  const tones: Record<string, string> = {
    slate: "bg-slate-800/70 text-slate-200 border-slate-700/40",
    blue: "bg-blue-900/30 text-blue-300 border-blue-500/20",
    green: "bg-green-900/30 text-green-300 border-green-500/20",
    amber: "bg-amber-900/30 text-amber-300 border-amber-500/20",
    red: "bg-red-900/30 text-red-300 border-red-500/20",
    purple: "bg-purple-900/30 text-purple-300 border-purple-500/20",
  };
  return tones[tone] || tones.slate;
}

function Badge({ label, value, tone = "slate" }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`rounded-lg border px-2 py-1 ${badgeTone(tone)}`}>
      <div className="text-[7px] uppercase opacity-70">{label}</div>
      <div className="text-[9px] font-black">{value}</div>
    </div>
  );
}

function Logo({ teamId, directUrl, name }: { teamId: string; directUrl?: string; name: string }) {
  const [attempt, setAttempt] = useState(0);
  const sources = [
    teamId ? `/api/logo?id=${teamId}` : null,
    teamId ? `https://api.sofascore.app/api/v1/team/${teamId}/image` : null,
    directUrl || null,
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name[0] || "?")}&background=1e293b&color=60a5fa&size=80&bold=true&format=png`,
  ].filter(Boolean) as string[];

  return (
    <img
      src={sources[Math.min(attempt, sources.length - 1)]}
      referrerPolicy="no-referrer"
      crossOrigin="anonymous"
      className="w-12 h-12 object-contain rounded-full bg-slate-800/60 p-0.5 mx-auto mb-1"
      alt={name}
      onError={() => setAttempt((value) => Math.min(value + 1, sources.length - 1))}
    />
  );
}

function FormPills({ form }: { form?: string }) {
  if (!form) return <div className="text-[7px] text-slate-500">vorm onbekend</div>;
  return (
    <div className="flex gap-0.5 justify-center mt-1">
      {form.slice(-5).split("").map((result, index) => (
        <span
          key={`${result}-${index}`}
          className={`w-4 h-4 rounded-sm text-[8px] font-black flex items-center justify-center ${
            result === "W"
              ? "bg-green-500 text-white"
              : result === "D"
                ? "bg-amber-500 text-black"
                : "bg-red-500 text-white"
          }`}
        >
          {result}
        </span>
      ))}
    </div>
  );
}

function TeamMeta({
  profile,
  injuries,
}: {
  profile?: any;
  injuries?: any;
}) {
  const sideLabel =
    profile?.strongestSide === "home"
      ? "thuis sterk"
      : profile?.strongestSide === "away"
        ? "uit sterk"
        : "gebalanceerd";

  return (
    <div className="mt-1 space-y-0.5">
      <div className="text-[8px] text-slate-400">
        PPG {profile?.pointsPerGame ?? "-"} · {sideLabel}
      </div>
      <div className="text-[8px] text-slate-500">
        trend {profile?.attackTrend ?? "-"} · blessures {injuries?.count ?? injuries?.injuredCount ?? 0}
      </div>
    </div>
  );
}

function RecentList({ title, recent }: { title: string; recent: any }) {
  const items = recent?.recentMatches || [];
  return (
    <div className="bg-slate-900/60 rounded-xl p-2">
      <div className="text-[8px] font-black uppercase text-slate-400 mb-2">{title}</div>
      {items.length === 0 ? (
        <div className="text-[9px] text-slate-500">Nog geen recente wedstrijden.</div>
      ) : (
        <div className="space-y-1">
          {items.map((item: any, index: number) => (
            <div key={`${item.date || index}-${index}`} className="flex items-center justify-between text-[9px]">
              <div className="min-w-0">
                <div className="text-slate-300 truncate">
                  <span className="font-black text-slate-500 mr-1">{item.venue}</span>
                  {item.opponent}
                </div>
                <div className="text-[8px] text-slate-600">{item.date || "-"}</div>
              </div>
              <div className="flex items-center gap-1">
                <span className="bg-slate-800 px-1.5 py-0.5 rounded text-white font-black">{item.score || "-"}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[8px] font-black ${
                    item.result === "W"
                      ? "bg-green-900/40 text-green-300"
                      : item.result === "D"
                        ? "bg-amber-900/40 text-amber-300"
                        : "bg-red-900/40 text-red-300"
                  }`}
                >
                  {item.result || "?"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamDeepStats({
  teamName,
  recent,
  profile,
  injuries,
  tone,
}: {
  teamName: string;
  recent: any;
  profile: any;
  injuries: any;
  tone: "blue" | "red";
}) {
  const split = tone === "blue" ? recent?.splits?.home : recent?.splits?.away;
  const colorClass = tone === "blue" ? "text-blue-300 border-blue-500/15 bg-blue-950/20" : "text-red-300 border-red-500/15 bg-red-950/20";

  return (
    <div className={`rounded-xl border p-2 ${colorClass}`}>
      <div className="text-[8px] font-black uppercase mb-1">{teamName}</div>
      <div className="grid grid-cols-2 gap-1 text-[8px]">
        <div className="text-slate-300">PPG <span className="font-black text-white">{profile?.pointsPerGame ?? "-"}</span></div>
        <div className="text-slate-300">Consistentie <span className="font-black text-white">{profile?.consistency ?? "-"}</span></div>
        <div className="text-slate-300">Split goals <span className="font-black text-white">{split ? `${split.avgScored}-${split.avgConceded}` : "-"}</span></div>
        <div className="text-slate-300">Over 2.5 <span className="font-black text-white">{split?.over25Rate != null ? `${Math.round(split.over25Rate * 100)}%` : "-"}</span></div>
        <div className="text-slate-300">Clean sheet <span className="font-black text-white">{recent?.cleanSheetRate != null ? `${Math.round(recent.cleanSheetRate * 100)}%` : "-"}</span></div>
        <div className="text-slate-300">Niet gescoord <span className="font-black text-white">{recent?.failToScoreRate != null ? `${Math.round(recent.failToScoreRate * 100)}%` : "-"}</span></div>
        <div className="text-slate-300">Sterke kant <span className="font-black text-white">{profile?.strongestSide || "-"}</span></div>
        <div className="text-slate-300">Blessures <span className="font-black text-white">{injuries?.injuredCount ?? injuries?.count ?? 0}</span></div>
      </div>
    </div>
  );
}

function ExpandableInsights({ match, prediction }: { match: any; prediction: any }) {
  const [open, setOpen] = useState(false);
  const ensemble = prediction.ensembleMeta || match.ensembleMeta;
  const clubEloDiff = prediction.modelEdges?.clubEloDiff;
  const restDiff = prediction.modelEdges?.rest;
  const valueFlags = prediction.valueFlags;
  const lineupImpact = prediction.modelEdges?.lineupImpact;
  const riskProfile = prediction.modelEdges?.riskProfile || "middel";
  const agreement = ensemble?.agreement ?? prediction.modelEdges?.modelAgreement;
  const teamAiSummary = prediction.modelEdges?.teamAiSummary;
  const travelEdge = prediction.modelEdges?.travelEdge;
  const keeperEdge = prediction.modelEdges?.keeperEdge;

  const riskTone =
    riskProfile === "laag"
      ? "border-green-500/15 bg-green-950/20 text-green-300"
      : riskProfile === "hoog"
        ? "border-red-500/15 bg-red-950/20 text-red-300"
        : "border-amber-500/15 bg-amber-950/20 text-amber-300";

  const valueText =
    valueFlags?.home?.value || valueFlags?.draw?.value || valueFlags?.away?.value
      ? [
          valueFlags?.home?.value ? `1 +${valueFlags.home.edgePct}%` : null,
          valueFlags?.draw?.value ? `X +${valueFlags.draw.edgePct}%` : null,
          valueFlags?.away?.value ? `2 +${valueFlags.away.edgePct}%` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "geen marktodds gekoppeld";

  return (
    <div className="rounded-xl border border-white/8 bg-slate-950/35 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <div>
          <div className="text-[8px] uppercase font-black text-slate-400">Meer teamdata & AI-signalen</div>
          <div className="text-[9px] text-slate-500">
            thuissplit, uittrend, blessures, modelmix en risicosignalen
          </div>
        </div>
        <span className="text-[10px] font-black text-slate-300">{open ? "^" : "v"}</span>
      </button>

      {open && (
      <div className="border-t border-white/6 px-3 py-3 space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <TeamDeepStats
            teamName={match.homeTeamName}
            recent={match.homeRecent}
            profile={match.homeTeamProfile}
            injuries={match.homeInjuries}
            tone="blue"
          />
          <TeamDeepStats
            teamName={match.awayTeamName}
            recent={match.awayRecent}
            profile={match.awayTeamProfile}
            injuries={match.awayInjuries}
            tone="red"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-violet-500/15 bg-violet-950/20 p-2">
            <div className="text-[8px] font-black uppercase text-violet-300 mb-1">AI-signalen</div>
            <div className="space-y-1 text-[8px] text-slate-300">
              <div>ClubElo edge: <span className="font-black text-white">{clubEloDiff == null ? "-" : clubEloDiff > 0 ? `+${clubEloDiff}` : clubEloDiff}</span></div>
              <div>Rustverschil: <span className="font-black text-white">{restDiff == null ? "-" : `${restDiff > 0 ? "+" : ""}${restDiff}d`}</span></div>
              <div>Weerrisico: <span className="font-black text-white">{match.weather?.riskLevel || prediction.weather?.riskLevel || "low"}</span></div>
              <div>Lineups: <span className="font-black text-white">{match.lineupSummary?.confirmed ? "bevestigd" : "open"}</span></div>
              <div>Lineup impact: <span className="font-black text-white">{lineupImpact?.summary || "neutraal"}</span></div>
              <div>Continuity: <span className="font-black text-white">{lineupImpact?.homeContinuity ?? "-"} / {lineupImpact?.awayContinuity ?? "-"}</span></div>
              <div>Keeper edge: <span className="font-black text-white">{keeperEdge?.summary || "gelijk"}</span></div>
              <div>Travel edge: <span className="font-black text-white">{travelEdge?.summary || "geen"}</span></div>
              <div>Tactische mismatch: <span className="font-black text-white">{prediction.modelEdges?.tacticalMismatch?.summary || "gebalanceerd"}</span></div>
              <div>Form shift: <span className="font-black text-white">{prediction.modelEdges?.formShift?.summary || "stabiel"}</span></div>
            </div>
          </div>

          <div className="rounded-xl border border-cyan-500/15 bg-cyan-950/20 p-2">
            <div className="text-[8px] font-black uppercase text-cyan-300 mb-1">Modelmix</div>
            <div className="space-y-1 text-[8px] text-slate-300">
              <div>Model: <span className="font-black text-white">{ensemble?.active ? "ensemble" : "basis"}</span></div>
              <div>Basis: <span className="font-black text-white">{ensemble?.baseModel || "dixon-coles-poisson"}</span></div>
              <div>Extra laag: <span className="font-black text-white">{ensemble?.blendModel || "-"}</span></div>
              <div>Gewicht basis: <span className="font-black text-white">{ensemble?.blendWeightBase != null ? `${Math.round(ensemble.blendWeightBase * 100)}%` : "-"}</span></div>
              <div>Agreement: <span className="font-black text-white">{agreement != null ? `${Math.round(agreement * 100)}%` : "-"}</span></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className={`rounded-xl border p-2 ${riskTone}`}>
            <div className="text-[8px] font-black uppercase mb-1">Risicoprofiel</div>
            <div className="text-[10px] font-black">{riskProfile}</div>
            <div className="text-[8px] text-slate-200/80 mt-1">
              gebaseerd op confidence, agreement, weer, opstellingen en blessures
            </div>
          </div>

          <div className="rounded-xl border border-yellow-500/15 bg-yellow-950/20 p-2">
            <div className="text-[8px] font-black uppercase text-yellow-300 mb-1">Value-signaal</div>
            <div className="text-[9px] font-black text-white">{valueText}</div>
            <div className="text-[8px] text-slate-300 mt-1">
              eerlijke odds: {valueFlags?.derived?.home || "-"} / {valueFlags?.derived?.draw || "-"} / {valueFlags?.derived?.away || "-"}
            </div>
          </div>

          <div className="rounded-xl border border-fuchsia-500/15 bg-fuchsia-950/20 p-2">
            <div className="text-[8px] font-black uppercase text-fuchsia-300 mb-1">Opstelling-impact</div>
            <div className="space-y-1 text-[8px] text-slate-300">
              <div>Thuis: <span className="font-black text-white">{lineupImpact?.homeImpact != null ? lineupImpact.homeImpact : "-"}</span></div>
              <div>Uit: <span className="font-black text-white">{lineupImpact?.awayImpact != null ? lineupImpact.awayImpact : "-"}</span></div>
              <div>Rating diff: <span className="font-black text-white">{lineupImpact?.ratingDiff != null ? lineupImpact.ratingDiff : "-"}</span></div>
              <div>Keeper diff: <span className="font-black text-white">{lineupImpact?.keeperDiff != null ? lineupImpact.keeperDiff : "-"}</span></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-teal-500/15 bg-teal-950/20 p-2">
            <div className="text-[8px] font-black uppercase text-teal-300 mb-1">Set-piece & discipline</div>
            <div className="space-y-1 text-[8px] text-slate-300">
              <div>{match.homeTeamName}: set-piece <span className="font-black text-white">{match.homeTeamProfile?.setPieceScore ?? "-"}</span></div>
              <div>{match.awayTeamName}: set-piece <span className="font-black text-white">{match.awayTeamProfile?.setPieceScore ?? "-"}</span></div>
              <div>Hoeken: <span className="font-black text-white">{match.homeTeamProfile?.cornersTrend ?? "-"}/{match.awayTeamProfile?.cornersTrend ?? "-"}</span></div>
              <div>Kaartenritme: <span className="font-black text-white">{match.homeRecent?.yellowCardRate != null ? `${match.homeRecent.yellowCardRate}/${match.awayRecent?.yellowCardRate ?? "-"}` : "-"}</span></div>
              <div>Vermoeidheid: <span className="font-black text-white">{match.homeTeamProfile?.fatigueIndex ?? "-"}/{match.awayTeamProfile?.fatigueIndex ?? "-"}</span></div>
            </div>
          </div>
          <div className="rounded-xl border border-indigo-500/15 bg-indigo-950/20 p-2">
            <div className="text-[8px] font-black uppercase text-indigo-300 mb-1">Extra AI-richting</div>
            <div className="text-[8px] text-slate-300 leading-relaxed">
              Klaar voor corners-trend, cards-trend, set-piece kracht, reis/vermoeidheid, managerwissel en markt-vs-model zodra die databronnen gekoppeld worden.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-blue-500/15 bg-blue-950/20 p-2">
            <div className="text-[8px] font-black uppercase text-blue-300 mb-1">AI conclusie thuis</div>
            <div className="text-[8px] text-slate-300 leading-relaxed">{teamAiSummary?.home?.summary || `${match.homeTeamName}: weinig afwijkende signalen`}</div>
          </div>
          <div className="rounded-xl border border-red-500/15 bg-red-950/20 p-2">
            <div className="text-[8px] font-black uppercase text-red-300 mb-1">AI conclusie uit</div>
            <div className="text-[8px] text-slate-300 leading-relaxed">{teamAiSummary?.away?.summary || `${match.awayTeamName}: weinig afwijkende signalen`}</div>
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/15 bg-amber-950/20 p-2">
          <div className="text-[8px] font-black uppercase text-amber-300 mb-1">Extra info die we later nog kunnen toevoegen</div>
          <div className="text-[8px] text-slate-300 leading-relaxed">
            managerwissel, reisafstand, verwachte opstelling per positie, corners-trend, kaarten-trend, set-piece kracht,
            marktvergelijking met historische odds en een aparte ML-score uit CatBoost of LightGBM.
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

function KeySignals({ match, prediction }: { match: any; prediction: any }) {
  const signals: string[] = [];
  if (match.context?.summary) signals.push(match.context.summary);
  if (match.aggregate?.active && match.aggregate.aggregateScore) signals.push(`aggregate ${match.aggregate.aggregateScore}`);
  if (prediction.modelEdges?.clubEloDiff) signals.push(`ClubElo verschil ${prediction.modelEdges.clubEloDiff}`);
  if (prediction.modelEdges?.rest != null && Math.abs(prediction.modelEdges.rest) >= 1) {
    signals.push(`rustverschil ${prediction.modelEdges.rest > 0 ? "+" : ""}${prediction.modelEdges.rest}d`);
  }
  if (match.h2h?.played >= 3) signals.push(`H2H ${match.h2h.homeWins}-${match.h2h.draws}-${match.h2h.awayWins}`);
  if (match.lineupSummary?.confirmed) signals.push("opstellingen bevestigd");

  if (signals.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {signals.slice(0, 5).map((signal) => (
        <span key={signal} className="px-2 py-0.5 rounded-full text-[8px] font-black bg-slate-800 text-slate-300">
          {signal}
        </span>
      ))}
    </div>
  );
}

function ExpandableMatchMeta({
  match,
  prediction,
  weather,
  h2h,
}: {
  match: any;
  prediction: any;
  weather: any;
  h2h: any;
}) {
  const confirmedLineups = match.lineupSummary?.confirmed;
  const activeModel = (prediction.ensembleMeta || match.ensembleMeta)?.active ? "Ensemble" : "Basis";
  const agreement = (prediction.ensembleMeta || match.ensembleMeta)?.agreement ?? prediction.modelEdges?.modelAgreement;
  const risk = prediction.modelEdges?.riskProfile || "middel";
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-white/8 bg-slate-950/35 overflow-hidden mb-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <div>
          <div className="text-[8px] uppercase font-black text-slate-400">Meer wedstrijdinfo</div>
          <div className="text-[9px] text-slate-500">
            rust, weer, H2H, splitdata, modelsignalen en extra context
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[8px] font-black text-slate-300">
            {agreement != null ? `${Math.round(agreement * 100)}%` : risk}
          </span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[8px] font-black text-slate-300">
            {activeModel}
          </span>
          <span className="text-[10px] font-black text-slate-300">{open ? "^" : "v"}</span>
        </div>
      </button>

      {open && (
      <div className="border-t border-white/6 px-3 py-3 space-y-2">
        <ModelEdgeStrip match={match} prediction={prediction} />

        <div className="grid grid-cols-3 gap-1.5">
          <Badge label="Rust" value={match.homeRestDays != null && match.awayRestDays != null ? `${match.homeRestDays}d/${match.awayRestDays}d` : "?"} tone="blue" />
          <Badge label="Weer" value={weather ? `${weather.temperature ?? "?"}C` : "?"} tone={weather?.riskLevel === "high" ? "red" : weather?.riskLevel === "medium" ? "amber" : "slate"} />
          <Badge label="Lineups" value={confirmedLineups ? "Bevestigd" : "Open"} tone={confirmedLineups ? "green" : "slate"} />
          <Badge label="H2H" value={h2h?.played ? `${h2h.homeWins}-${h2h.draws}-${h2h.awayWins}` : "Leeg"} tone={h2h?.played ? "purple" : "slate"} />
          <Badge label="Context" value={match.context?.summary ? "Aan" : "Basis"} tone={match.context?.summary ? "amber" : "slate"} />
          <Badge label="Model" value={activeModel} tone="blue" />
        </div>

        <InsightGrid match={match} prediction={prediction} />
        <KeySignals match={match} prediction={prediction} />
      </div>
      )}
    </div>
  );
}

function ModelEdgeStrip({ match, prediction }: { match: any; prediction: any }) {
  const agreement = (prediction.ensembleMeta || match.ensembleMeta)?.agreement ?? prediction.modelEdges?.modelAgreement;
  const risk = prediction.modelEdges?.riskProfile || "middel";
  const travel = prediction.modelEdges?.travelEdge?.summary || "geen reisimpact";
  const keeper = prediction.modelEdges?.keeperEdge?.summary || "keepers gelijk";

  return (
    <div className="grid grid-cols-4 gap-1.5 mb-2">
      <div className="rounded-xl border border-cyan-500/15 bg-cyan-950/20 px-2 py-1.5">
        <div className="text-[7px] uppercase font-black text-cyan-300/80">Model</div>
        <div className="text-[10px] font-black text-white">
          {agreement != null ? `${Math.round(agreement * 100)}% sync` : "basis"}
        </div>
      </div>
      <div className="rounded-xl border border-amber-500/15 bg-amber-950/20 px-2 py-1.5">
        <div className="text-[7px] uppercase font-black text-amber-300/80">Risico</div>
        <div className="text-[10px] font-black text-white">{risk}</div>
      </div>
      <div className="rounded-xl border border-violet-500/15 bg-violet-950/20 px-2 py-1.5">
        <div className="text-[7px] uppercase font-black text-violet-300/80">Reis</div>
        <div className="text-[10px] font-black text-white truncate">{travel.replace("uitploeg ", "")}</div>
      </div>
      <div className="rounded-xl border border-emerald-500/15 bg-emerald-950/20 px-2 py-1.5">
        <div className="text-[7px] uppercase font-black text-emerald-300/80">Keeper</div>
        <div className="text-[10px] font-black text-white truncate">{keeper.replace("thuis", "H").replace("uit", "U")}</div>
      </div>
    </div>
  );
}

function InsightGrid({ match, prediction }: { match: any; prediction: any }) {
  const homeSplit = match.homeRecent?.splits?.home;
  const awaySplit = match.awayRecent?.splits?.away;
  const clubEloDiff = prediction.modelEdges?.clubEloDiff;
  const homeBtts = match.homeRecent?.bttsRate != null ? `${Math.round(match.homeRecent.bttsRate * 100)}%` : "-";
  const awayBtts = match.awayRecent?.bttsRate != null ? `${Math.round(match.awayRecent.bttsRate * 100)}%` : "-";
  const ensemble = prediction.ensembleMeta || match.ensembleMeta;

  return (
    <div className="grid grid-cols-2 gap-1.5 mb-2">
      <div className="rounded-xl border border-blue-500/15 bg-blue-950/20 px-2 py-1.5">
        <div className="text-[7px] uppercase font-black text-blue-300/80">Thuissplit</div>
        <div className="text-[10px] font-black text-white">
          {homeSplit ? `${homeSplit.avgScored}-${homeSplit.avgConceded}` : "-"}
        </div>
      </div>
      <div className="rounded-xl border border-red-500/15 bg-red-950/20 px-2 py-1.5">
        <div className="text-[7px] uppercase font-black text-red-300/80">Uitsplit</div>
        <div className="text-[10px] font-black text-white">
          {awaySplit ? `${awaySplit.avgScored}-${awaySplit.avgConceded}` : "-"}
        </div>
      </div>
      <div className="rounded-xl border border-violet-500/15 bg-violet-950/20 px-2 py-1.5">
        <div className="text-[7px] uppercase font-black text-violet-300/80">ClubElo edge</div>
        <div className="text-[10px] font-black text-white">
          {clubEloDiff == null ? "-" : clubEloDiff > 0 ? `+${clubEloDiff}` : `${clubEloDiff}`}
        </div>
      </div>
      <div className="rounded-xl border border-emerald-500/15 bg-emerald-950/20 px-2 py-1.5">
        <div className="text-[7px] uppercase font-black text-emerald-300/80">BTTS trend</div>
        <div className="text-[10px] font-black text-white">
          {homeBtts} / {awayBtts}
        </div>
      </div>
      <div className="rounded-xl border border-cyan-500/15 bg-cyan-950/20 px-2 py-1.5 col-span-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[7px] uppercase font-black text-cyan-300/80">Ensemble model</div>
            <div className="text-[10px] font-black text-white">
              {ensemble?.active ? `${ensemble.baseModel} + ${ensemble.blendModel}` : "Dixon-Coles basis"}
            </div>
          </div>
          <div className="text-right text-[8px] text-cyan-100/80">
            {ensemble?.blendWeightBase != null ? `${Math.round(ensemble.blendWeightBase * 100)}% basis` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function aggregateLoser(match: any, aggregate: any) {
  if (!aggregate?.active || !aggregate?.leader) return null;
  return aggregate.leader === match.homeTeamName ? match.awayTeamName : match.homeTeamName;
}

function showImportance(match: any) {
  const importance = Number(match.matchImportance || 1);
  const homePos = Number(match.homePos || 0);
  const awayPos = Number(match.awayPos || 0);
  const topOrBottom =
    (homePos > 0 && homePos <= 3) ||
    (awayPos > 0 && awayPos <= 3) ||
    (homePos >= 16 && homePos > 0) ||
    (awayPos >= 16 && awayPos > 0);
  return importance > 1.02 || topOrBottom;
}

const MatchCard: React.FC<MatchCardProps> = ({ match, prediction, onFavoriteChange }) => {
  const [tab, setTab] = useState<"analyse" | "h2h" | "vorm" | "markten" | "stats">("analyse");
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const triedRef = useRef(false);
  const liveMinute = useLiveMinute(match as any);

  useEffect(() => {
    if (triedRef.current || !prediction) return;
    triedRef.current = true;
    setAiLoading(true);
    fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match, prediction }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.analysis) setAiAnalysis(data.analysis);
      })
      .catch(() => {})
      .finally(() => setAiLoading(false));
  }, [match, prediction]);

  if (!prediction) {
    return <div className="glass-card rounded-2xl p-4 border border-white/5 animate-pulse h-72" />;
  }

  const isLive = String(match.status || "").toUpperCase() === "LIVE" || !!liveMinute;
  const isFinished = String(match.status || "").toUpperCase() === "FT";
  const weather = match.weather || prediction.weather;
  const h2h = match.h2h || prediction.h2h;
  const aggregate = match.aggregate || prediction.aggregate;
  const loser = aggregateLoser(match, aggregate);
  const importantMatch = showImportance(match);
  const topScores = Object.entries(prediction.scoreMatrix || {})
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 6);
  const confidenceBase = prediction.confidence ?? Math.max(prediction.homeProb || 0, prediction.drawProb || 0, prediction.awayProb || 0);
  const confidencePct = Math.max(0, Math.min(99, Math.round((confidenceBase || 0) * 100)));
  const modelLabel = (prediction.ensembleMeta || match.ensembleMeta)?.active ? "Ensemble" : "Basis";
  const timingLabel = isLive
    ? liveMinute && liveMinute !== "LIVE"
      ? liveMinute
      : "live"
    : isFinished
      ? "FT"
      : match.kickoff
        ? new Date(match.kickoff).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })
        : "-";

  return (
    <div className={`glass-card rounded-2xl p-3 border transition-all ${isLive ? "border-red-500/50 bg-red-950/20" : isFinished ? "border-slate-600/30 bg-slate-900/20" : "border-slate-700/30"}`}>
      <div className="flex justify-between items-center mb-2 gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[8px] font-black text-blue-400 uppercase truncate">{match.league}</div>
          <div className="text-[8px] text-slate-500">
            {match.kickoff ? new Date(match.kickoff).toLocaleString("nl-NL") : ""}
            {match.roundLabel ? ` · ${match.roundLabel}` : ""}
          </div>
          {isLive && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-900/35 border border-red-500/25 px-2 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[9px] font-black text-red-200">{liveMinute && liveMinute !== "LIVE" ? `LIVE ${liveMinute}` : "LIVE nu"}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {importantMatch && (
            <span className="bg-amber-900/30 text-amber-300 border border-amber-500/20 text-[8px] font-black px-1.5 py-0.5 rounded-full">
              Belangrijk
            </span>
          )}
          <FavoriteButton teamId={match.homeTeamId || ""} teamName={match.homeTeamName} onChange={onFavoriteChange} />
          <FavoriteButton teamId={match.awayTeamId || ""} teamName={match.awayTeamName} onChange={onFavoriteChange} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex-1 text-center">
          <Logo teamId={match.homeTeamId || ""} directUrl={match.homeLogo} name={match.homeTeamName} />
          <div className={`text-[10px] font-black ${loser === match.homeTeamName ? "text-slate-500 line-through" : "text-white"}`}>
            {match.homeTeamName} {match.homePos ? `(#${match.homePos})` : ""}
          </div>
          <div className="text-[7px] text-slate-500">ClubElo {match.homeClubElo ?? "-"}</div>
          <FormPills form={match.homeForm} />
          <div className="text-[8px] text-slate-500 mt-0.5">
            PPG {match.homeTeamProfile?.pointsPerGame ?? "-"}
          </div>
        </div>

        <div className="min-w-[104px] text-center">
          <div className="text-xl font-black text-white">{match.score || "vs"}</div>
          <div className="mt-1 bg-blue-600 px-2 py-0.5 rounded-full text-[10px] font-black text-white">
            Voorspelling {prediction.predHomeGoals}-{prediction.predAwayGoals}
          </div>
          {aggregate?.active && (
            <div className="mt-1 space-y-1">
              <div className="text-[8px] text-amber-300 bg-amber-900/20 border border-amber-500/15 rounded-full px-2 py-0.5">
                Eerste duel {aggregate.firstLegText || aggregate.firstLegScore || "?"}
              </div>
              <div className="text-[8px] text-amber-300 bg-amber-900/20 border border-amber-500/15 rounded-full px-2 py-0.5">
                Agg {aggregate.aggregateScore || "-"}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 text-center">
          <Logo teamId={match.awayTeamId || ""} directUrl={match.awayLogo} name={match.awayTeamName} />
          <div className={`text-[10px] font-black ${loser === match.awayTeamName ? "text-slate-500 line-through" : "text-white"}`}>
            {match.awayTeamName} {match.awayPos ? `(#${match.awayPos})` : ""}
          </div>
          <div className="text-[7px] text-slate-500">ClubElo {match.awayClubElo ?? "-"}</div>
          <FormPills form={match.awayForm} />
          <div className="text-[8px] text-slate-500 mt-0.5">
            PPG {match.awayTeamProfile?.pointsPerGame ?? "-"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 mb-2">
        <div className="rounded-lg border border-blue-500/15 bg-blue-950/20 px-2 py-1.5 text-center">
          <div className="text-[7px] uppercase font-black text-blue-300/80">Vertrouwen</div>
          <div className="text-[11px] font-black text-white">{confidencePct}%</div>
        </div>
        <div className="rounded-lg border border-cyan-500/15 bg-cyan-950/20 px-2 py-1.5 text-center">
          <div className="text-[7px] uppercase font-black text-cyan-300/80">Model</div>
          <div className="text-[11px] font-black text-white">{modelLabel}</div>
        </div>
        <div className="rounded-lg border border-violet-500/15 bg-violet-950/20 px-2 py-1.5 text-center">
          <div className="text-[7px] uppercase font-black text-violet-300/80">Wedstrijdtijd</div>
          <div className="text-[11px] font-black text-white">{timingLabel}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 mb-2">
        {[
          { label: "1", p: prediction.homeProb || 0, odds: fmt(prediction.homeProb || 0), c: "text-green-400" },
          { label: "X", p: prediction.drawProb || 0, odds: fmt(prediction.drawProb || 0), c: "text-slate-400" },
          { label: "2", p: prediction.awayProb || 0, odds: fmt(prediction.awayProb || 0), c: "text-red-400" },
        ].map(({ label, p, odds, c }) => (
          <div key={label} className="bg-slate-900/60 rounded-lg p-1.5 text-center">
            <div className={`text-[7px] font-black ${c}`}>{label}</div>
            <div className="text-[11px] font-black text-white">{(p * 100).toFixed(0)}%</div>
            <div className="text-[9px] text-yellow-400 font-bold">{odds}</div>
          </div>
        ))}
      </div>

      <div className="mb-2">
        <KeySignals match={match} prediction={prediction} />
      </div>

      <ExpandableMatchMeta match={match} prediction={prediction} weather={weather} h2h={h2h} />

      <div className="grid grid-cols-5 gap-0.5 mt-2 mb-2 pt-1 border-t border-white/5">
        {[
          { key: "analyse", label: "AI" },
          { key: "h2h", label: "H2H" },
          { key: "vorm", label: "Vorm" },
          { key: "markten", label: "Markt" },
          { key: "stats", label: "Stats" },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key as any)}
            className={`py-1 rounded-lg text-[8px] font-black transition ${
              tab === item.key ? "bg-blue-600 text-white" : "bg-slate-800/60 text-slate-400 hover:text-white"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "analyse" && (
        <div className="space-y-2">
          <div className="bg-gradient-to-br from-blue-950/60 to-purple-950/40 border border-blue-500/20 rounded-xl p-2.5 min-h-[64px]">
            <div className="text-[7px] font-black text-blue-400 uppercase mb-1.5">AI Analyse</div>
            {aiAnalysis ? (
              <p className="text-[9px] text-blue-100/90 leading-relaxed">{aiAnalysis}</p>
            ) : (
              <p className="text-[9px] text-slate-500">{aiLoading ? "Analyse laden..." : "Nog geen analyse."}</p>
            )}
          </div>

          {aggregate?.active && (
            <div className="bg-amber-900/20 border border-amber-500/15 rounded-xl p-2">
              <div className="text-[7px] font-black text-amber-300 uppercase mb-1">Tweeluik</div>
              <div className="text-[9px] text-amber-100/90">
                Eerste duel: {aggregate.firstLegText || aggregate.firstLegScore || "onbekend"}
              </div>
              <div className="text-[9px] text-amber-100/90">
                Aggregate: {aggregate.aggregateScore || "-"}
                {aggregate.leader ? ` · ${aggregate.leader} ligt voor` : ""}
              </div>
            </div>
          )}

          {match.context?.summary && (
            <div className="bg-slate-900/60 rounded-xl p-2">
              <div className="text-[7px] font-black text-slate-400 uppercase mb-1">Wedstrijdcontext</div>
              <div className="text-[9px] text-slate-300">{match.context.summary}</div>
            </div>
          )}
        </div>
      )}

      {tab === "h2h" && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-1 text-center">
            <div className="rounded-lg p-1.5 bg-green-900/20 border border-green-500/20 text-green-400">
              <div className="text-[7px] font-black uppercase">Thuis</div>
              <div className="text-xl font-black text-white">{h2h?.homeWins || 0}</div>
            </div>
            <div className="rounded-lg p-1.5 bg-slate-800 text-slate-400">
              <div className="text-[7px] font-black uppercase">Gelijk</div>
              <div className="text-xl font-black text-white">{h2h?.draws || 0}</div>
            </div>
            <div className="rounded-lg p-1.5 bg-red-900/20 border border-red-500/20 text-red-400">
              <div className="text-[7px] font-black uppercase">Uit</div>
              <div className="text-xl font-black text-white">{h2h?.awayWins || 0}</div>
            </div>
          </div>

          {h2h?.results?.length ? (
            <div className="bg-slate-900/60 rounded-xl p-2 space-y-1">
              {h2h.results.slice(-5).reverse().map((result: any, index: number) => (
                <div key={`${result.date || index}-${index}`} className="flex items-center justify-between text-[9px] border-b border-white/5 last:border-0 py-1">
                  <div className="min-w-0">
                    <div className="text-slate-300 truncate">{result.home}</div>
                    <div className="text-[8px] text-slate-600">{result.date || "-"}</div>
                  </div>
                  <div className="font-black text-white bg-slate-800 px-1.5 py-0.5 rounded">{result.score}</div>
                  <div className="text-slate-300 truncate text-right">{result.away}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-slate-500 text-[10px]">H2H nog niet beschikbaar</div>
          )}
        </div>
      )}

      {tab === "vorm" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <RecentList title={`${match.homeTeamName} laatste 5`} recent={match.homeRecent} />
            <RecentList title={`${match.awayTeamName} laatste 5`} recent={match.awayRecent} />
          </div>
          <ExpandableInsights match={match} prediction={prediction} />
        </div>
      )}

      {tab === "markten" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Badge label="Over 1.5" value={`${((prediction.over15 || 0) * 100).toFixed(0)}%`} tone="blue" />
            <Badge label="Over 2.5" value={`${((prediction.over25 || 0) * 100).toFixed(0)}%`} tone="blue" />
            <Badge label="Over 3.5" value={`${((prediction.over35 || 0) * 100).toFixed(0)}%`} tone="amber" />
            <Badge label="BTTS" value={`${((prediction.btts || 0) * 100).toFixed(0)}%`} tone="green" />
          </div>
        </div>
      )}

      {tab === "stats" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Badge label="xG thuis" value={(prediction.homeXG || 0).toFixed(2)} tone="blue" />
            <Badge label="xG uit" value={(prediction.awayXG || 0).toFixed(2)} tone="red" />
            <Badge label="Schoten thuis" value={match.homeSeasonStats?.avgShotsOn != null ? Number(match.homeSeasonStats.avgShotsOn).toFixed(1) : "-"} tone="blue" />
            <Badge label="Schoten uit" value={match.awaySeasonStats?.avgShotsOn != null ? Number(match.awaySeasonStats.avgShotsOn).toFixed(1) : "-"} tone="red" />
            <Badge label="Blessures thuis" value={`${match.homeInjuries?.injuredCount || 0}`} tone="amber" />
            <Badge label="Blessures uit" value={`${match.awayInjuries?.injuredCount || 0}`} tone="amber" />
            <Badge label="PPG thuis" value={match.homeTeamProfile?.pointsPerGame != null ? String(match.homeTeamProfile.pointsPerGame) : "-"} tone="blue" />
            <Badge label="PPG uit" value={match.awayTeamProfile?.pointsPerGame != null ? String(match.awayTeamProfile.pointsPerGame) : "-"} tone="red" />
            <Badge label="Clean sheet" value={match.homeRecent?.cleanSheetRate != null ? `${Math.round(match.homeRecent.cleanSheetRate * 100)}% / ${Math.round((match.awayRecent?.cleanSheetRate || 0) * 100)}%` : "-"} tone="green" />
            <Badge label="Fail to score" value={match.homeRecent?.failToScoreRate != null ? `${Math.round(match.homeRecent.failToScoreRate * 100)}% / ${Math.round((match.awayRecent?.failToScoreRate || 0) * 100)}%` : "-"} tone="amber" />
          </div>

          {topScores.length > 0 && (
            <div className="bg-slate-900/60 rounded-xl p-2">
              <div className="text-[7px] text-slate-500 uppercase mb-1.5">Score matrix</div>
              <div className="flex flex-wrap gap-1">
                {topScores.map(([score, prob]: any) => (
                  <div key={score} className="px-2 py-0.5 rounded-lg text-[9px] font-black bg-slate-800 text-slate-300">
                    {score} <span className="opacity-60">{(prob * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MatchCard;
