import React, { useEffect, useMemo, useRef, useState } from "react";
import { Match } from "../types";
import { FavoriteButton } from "./FavoriteTeams";
import PostMatchReview from "./PostMatchReview";
import { getLiveMinuteLabel } from "../shared/minute.js";
import { cleanSignalText } from "../shared/matchText.js";

interface MatchCardProps {
  match: Match;
  prediction?: any;
  onFavoriteChange?: () => void;
}

function useLiveMinute(match: any) {
  const [now, setNow] = useState(() => Date.now());
  const status = String(match?.status || "").toUpperCase();
  const isSettled = ["FT", "AET", "PEN", "RESULT_PENDING"].includes(status) || status.includes("FINISH");

  useEffect(() => {
    if (isSettled || (status !== "LIVE" && status !== "HT" && !match?.minuteValue)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [isSettled, status, match?.minuteValue, match?.liveUpdatedAt]);

  return useMemo(() => (isSettled ? null : getLiveMinuteLabel(match, now)), [isSettled, match, now]);
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
  const initial = (name || "?").trim().slice(0, 1).toUpperCase() || "?";
  const apiLogoUrl = /^\d+$/.test(String(teamId || "")) ? `/api/logo?id=${teamId}` : null;
  const fallbackSvg = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><defs><radialGradient id="g" cx="35%" cy="25%" r="75%"><stop offset="0%" stop-color="#334155"/><stop offset="55%" stop-color="#172033"/><stop offset="100%" stop-color="#0f172a"/></radialGradient></defs><circle cx="48" cy="48" r="45" fill="url(#g)" stroke="#334155" stroke-width="3"/><text x="48" y="58" font-family="Arial, sans-serif" font-size="38" font-weight="800" fill="#60a5fa" text-anchor="middle">${initial}</text></svg>`
  )}`;
  const sources = [
    directUrl || null,
    apiLogoUrl,
    fallbackSvg,
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
  const sourceLabel = recent?.source ? String(recent.source).replace(/-/g, " ") : "";
  return (
    <div className="bg-slate-900/60 rounded-xl p-2">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-[8px] font-black uppercase text-slate-400">{title}</div>
        {sourceLabel ? (
          <div className="shrink-0 rounded-full bg-slate-800 px-1.5 py-0.5 text-[7px] font-black text-slate-400">
            {sourceLabel}
          </div>
        ) : null}
      </div>
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

function collectAvailabilityNames(injuries: any) {
  return [
    ...(Array.isArray(injuries?.injuredPlayers) ? injuries.injuredPlayers : []),
    ...(Array.isArray(injuries?.keyPlayersMissing) ? injuries.keyPlayersMissing : []),
    ...(Array.isArray(injuries?.suspendedPlayers) ? injuries.suspendedPlayers : []),
  ]
    .map((item: any) => String(item?.name || item || "").trim())
    .filter(Boolean);
}

function TeamSquadPanel({
  title,
  profile,
  injuries,
  onClose,
}: {
  title: string;
  profile: any;
  injuries: any;
  onClose: () => void;
}) {
  const squad = profile?.squad || profile;
  const unavailableNames = collectAvailabilityNames(injuries);
  const unavailableSet = new Set(unavailableNames.map((name) => name.toLowerCase()));
  const rawPlayers = Array.isArray(squad?.players) ? squad.players : [];
  const players = rawPlayers.map((player: any) => {
    const name = String(player?.name || "").trim();
    const unavailable = unavailableSet.has(name.toLowerCase()) || /injur|bless|suspend|geschorst/i.test(String(player?.status || player?.availability || ""));
    return {
      ...player,
      name,
      availability: unavailable ? "niet beschikbaar" : player?.availability || player?.status || "beschikbaar",
      unavailable,
    };
  });
  const extraUnavailable = unavailableNames
    .filter((name) => !players.some((player: any) => player.name.toLowerCase() === name.toLowerCase()))
    .map((name) => ({ name, position: "-", nationality: "", availability: "niet beschikbaar", unavailable: true, source: "beschikbaarheidsbron" }));
  const visiblePlayers = [...players, ...extraUnavailable].slice(0, 60);
  const loaned = visiblePlayers.filter((player: any) => player.loan || /loan|verhuur|uitgeleend/i.test(String(player.availability || player.status || ""))).length;
  const unavailable = visiblePlayers.filter((player: any) => player.unavailable).length;

  return (
    <div className="mb-3 rounded-2xl border border-cyan-400/25 bg-slate-950/70 p-3 shadow-[0_0_30px_rgba(34,211,238,0.08)]">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase text-cyan-200">Selectie {title}</div>
          <div className="text-[8px] text-slate-500">
            Bron: {Array.isArray(squad?.sources) ? squad.sources.join(" + ") : squad?.source || "afgeleide teamdata"} · rating {profile?.teamStrengthRating ?? squad?.rating ?? "-"}
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full bg-slate-800 px-2 py-1 text-[8px] font-black text-slate-200">
          Sluiten
        </button>
      </div>
      <div className="mb-2 grid grid-cols-3 gap-1">
        <div className="rounded-lg bg-slate-900/70 px-2 py-1">
          <div className="text-[7px] font-black uppercase text-slate-500">Spelers</div>
          <div className="text-[12px] font-black text-white">{visiblePlayers.length || squad?.playerCount || 0}</div>
        </div>
        <div className="rounded-lg bg-red-950/25 px-2 py-1">
          <div className="text-[7px] font-black uppercase text-red-300">Niet fit</div>
          <div className="text-[12px] font-black text-white">{unavailable}</div>
        </div>
        <div className="rounded-lg bg-amber-950/25 px-2 py-1">
          <div className="text-[7px] font-black uppercase text-amber-300">Verhuurd</div>
          <div className="text-[12px] font-black text-white">{loaned}</div>
        </div>
      </div>
      {visiblePlayers.length ? (
        <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {visiblePlayers.map((player: any, index: number) => (
            <div key={`${player.name}-${index}`} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-white/5 bg-slate-900/45 px-2 py-1.5">
              <div className="min-w-0">
                <div className="truncate text-[9px] font-black text-white">{player.name}</div>
                <div className="truncate text-[7px] text-slate-500">{player.position || "-"} {player.nationality ? `· ${player.nationality}` : ""}</div>
              </div>
              <span
                className={`self-center rounded-full px-2 py-0.5 text-[7px] font-black ${
                  player.unavailable
                    ? "bg-red-900/40 text-red-200"
                    : player.loan
                      ? "bg-amber-900/40 text-amber-200"
                      : "bg-emerald-900/35 text-emerald-200"
                }`}
              >
                {player.availability || "beschikbaar"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/10 bg-slate-900/30 p-3 text-[10px] text-slate-400">
          Nog geen volledige spelerslijst gevonden. De voorspelling gebruikt voorlopig afgeleide teamsterkte uit vorm, Elo, stand en blessuredata.
        </div>
      )}
    </div>
  );
}

function buildRecentH2HForm(h2h: any, currentHomeId?: string, currentAwayId?: string) {
  const recent = (h2h?.results || []).slice(-5).reverse();
  return recent.map((result: any, index: number) => {
    let label = "D";
    if (result?.winnerId && currentHomeId && String(result.winnerId) === String(currentHomeId)) label = "W";
    else if (result?.winnerId && currentAwayId && String(result.winnerId) === String(currentAwayId)) label = "L";
    return {
      key: `${result?.eventId || index}-${index}`,
      label,
      score: result?.score || "-",
      date: result?.date || "-",
      home: result?.home || "",
      away: result?.away || "",
    };
  });
}

function getH2HSourceLabel(status?: string) {
  if (status?.startsWith("h2h-agent:")) return "H2H-agent: live, historische en backfill-bronnen gecombineerd";
  if (status === "h2h-agent-empty") return "H2H-agent vond nog geen betrouwbare onderlinge duels";
  if (status === "all-competitions") return "laatste onderlinge duels uit alle competities";
  if (status === "historical-competition") return "aangevuld uit historische competitiedata";
  if (status === "merged-historical-competition") return "live bron + historische competitiedata";
  if (status === "aggregate-backfill") return "aangevuld uit tweeluikbron";
  if (status === "curated-h2h-backfill") return "laatste onderlinge duels uit H2H-backfill";
  if (status === "merged-curated-h2h-backfill") return "tweeluik + laatste H2H-backfill";
  if (status === "loaded") return "laatste onderlinge duels in brondata";
  if (status === "fallback") return "aangevuld met vorige duel-fallback";
  return "geen recente onderlinge brondata";
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
  const learningEdge = prediction.modelEdges?.learningEdge || match.learningSummary;
  const marketCalibration = prediction.modelEdges?.marketCalibration || match.marketCalibration;
  const competitionReliability = prediction.modelEdges?.leagueReliability || match.competitionReliability;
  const phaseReliability = prediction.modelEdges?.phaseReliability || match.phaseReliability;
  const refereeProfile = prediction.modelEdges?.refereeProfile || match.refereeProfile;
  const freeSourceCoverage = (match as any).freeSourceCoverage || (match as any).sourceCoverage || prediction.freeSourceCoverage || null;
  const freeSourceEntries = Array.isArray(freeSourceCoverage?.entries) ? freeSourceCoverage.entries : [];
  const freeSourceNames = Array.isArray(freeSourceCoverage?.sources) ? freeSourceCoverage.sources.slice(0, 3).join(", ") : "";
  const bookmakerSignals = Array.isArray(marketCalibration?.bookmakerSignals) ? marketCalibration.bookmakerSignals.slice(0, 3) : [];
  const modelWarnings = Array.isArray(prediction.modelEdges?.modelWarnings) ? prediction.modelEdges.modelWarnings : [];
  const lowAgreement = agreement != null && agreement < 0.55;

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
              <div>Scheids: <span className="font-black text-white">{refereeProfile?.summary || "niet gekoppeld"}</span></div>
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
              <div>Penalty: <span className="font-black text-white">{prediction.modelEdges?.modelAgreementPenalty != null ? `${Math.round(prediction.modelEdges.modelAgreementPenalty * 100)}pp` : "-"}</span></div>
            </div>
          </div>
        </div>

        {(lowAgreement || modelWarnings.length > 0) && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-950/25 p-2 text-[8px] text-amber-100">
            <div className="font-black uppercase text-amber-300 mb-1">Model-waarschuwing</div>
            <div>
              {lowAgreement
                ? "Scoremodel en 1X2-model zitten niet dicht genoeg bij elkaar. Confidence is daarom automatisch verlaagd."
                : "Er zijn modelwaarschuwingen actief."}
            </div>
            {modelWarnings.length > 0 && (
              <div className="mt-1 text-slate-300">
                Signalen: <span className="font-black text-white">{modelWarnings.join(", ")}</span>
              </div>
            )}
          </div>
        )}

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
          <div className="rounded-xl border border-sky-500/15 bg-sky-950/20 p-2">
            <div className="text-[8px] font-black uppercase text-sky-300 mb-1">Leermodel review</div>
            <div className="space-y-1 text-[8px] text-slate-300">
              <div>Samenvatting: <span className="font-black text-white">{learningEdge?.summary || "nog geen reviewdata"}</span></div>
              <div>Hitrate thuis/uit: <span className="font-black text-white">{learningEdge?.homeOutcomeHitRate != null ? `${Math.round(learningEdge.homeOutcomeHitRate * 100)}%` : "-"} / {learningEdge?.awayOutcomeHitRate != null ? `${Math.round(learningEdge.awayOutcomeHitRate * 100)}%` : "-"}</span></div>
              <div>Bias thuis/uit: <span className="font-black text-white">{learningEdge?.homeBias ?? "-"} / {learningEdge?.awayBias ?? "-"}</span></div>
              <div>Betrouwbaarheid: <span className="font-black text-white">{learningEdge?.combinedReliability != null ? `${Math.round(learningEdge.combinedReliability * 100)}%` : "-"}</span></div>
            </div>
          </div>
          <div className="rounded-xl border border-rose-500/15 bg-rose-950/20 p-2">
            <div className="text-[8px] font-black uppercase text-rose-300 mb-1">Markt-calibratie</div>
            <div className="space-y-1 text-[8px] text-slate-300">
              <div>Bron: <span className="font-black text-white">{marketCalibration?.source || "geen"}</span></div>
              <div>Samenvatting: <span className="font-black text-white">{marketCalibration?.summary || "geen historische marktdata gekoppeld"}</span></div>
              <div>Implied PPG: <span className="font-black text-white">{marketCalibration?.homeImpliedPpg ?? "-"} / {marketCalibration?.awayImpliedPpg ?? "-"}</span></div>
              <div>Overperf diff: <span className="font-black text-white">{marketCalibration?.overperformanceDiff ?? "-"}</span></div>
              <div>Closing-sterkte: <span className="font-black text-white">{marketCalibration?.strength != null ? `${Math.round(marketCalibration.strength * 100)}%` : "-"}</span></div>
              <div>Closing-dekking: <span className="font-black text-white">{marketCalibration?.closingCoverage != null ? `${Math.round(marketCalibration.closingCoverage * 100)}%` : "-"}</span></div>
              <div>Bookmaker-consensus: <span className="font-black text-white">{marketCalibration?.bookmakerAgreement != null ? `${Math.round(marketCalibration.bookmakerAgreement * 100)}%` : "-"}</span></div>
              <div>Closing lean: <span className="font-black text-white">{marketCalibration?.closingLean || "-"}</span></div>
              <div>Bookies: <span className="font-black text-white">{bookmakerSignals.length ? bookmakerSignals.map((item) => `${item.bookmaker}:${item.lean}`).join(" / ") : "-"}</span></div>
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

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-emerald-500/15 bg-emerald-950/20 p-2">
            <div className="text-[8px] font-black uppercase text-emerald-300 mb-1">Competitiebetrouwbaarheid</div>
            <div className="space-y-1 text-[8px] text-slate-300">
              <div>Score: <span className="font-black text-white">{competitionReliability?.reliabilityScore != null ? `${Math.round(competitionReliability.reliabilityScore * 100)}%` : "-"}</span></div>
              <div>1X2 hitrate: <span className="font-black text-white">{competitionReliability?.outcomeHitRate != null ? `${Math.round(competitionReliability.outcomeHitRate * 100)}%` : "-"}</span></div>
              <div>Exact hitrate: <span className="font-black text-white">{competitionReliability?.exactHitRate != null ? `${Math.round(competitionReliability.exactHitRate * 100)}%` : "-"}</span></div>
              <div>Gem. goal error: <span className="font-black text-white">{competitionReliability?.avgGoalError ?? "-"}</span></div>
              <div>Bron: <span className="font-black text-white">{competitionReliability?.summary || "nog in opbouw"}</span></div>
            </div>
          </div>
          <div className="rounded-xl border border-amber-500/15 bg-amber-950/20 p-2">
            <div className="text-[8px] font-black uppercase text-amber-300 mb-1">Fasebetrouwbaarheid</div>
            <div className="space-y-1 text-[8px] text-slate-300">
              <div>Score: <span className="font-black text-white">{phaseReliability?.reliabilityScore != null ? `${Math.round(phaseReliability.reliabilityScore * 100)}%` : "-"}</span></div>
              <div>1X2 hitrate: <span className="font-black text-white">{phaseReliability?.outcomeHitRate != null ? `${Math.round(phaseReliability.outcomeHitRate * 100)}%` : "-"}</span></div>
              <div>Exact hitrate: <span className="font-black text-white">{phaseReliability?.exactHitRate != null ? `${Math.round(phaseReliability.exactHitRate * 100)}%` : "-"}</span></div>
              <div>Gem. goal error: <span className="font-black text-white">{phaseReliability?.avgGoalError ?? "-"}</span></div>
              <div>Bron: <span className="font-black text-white">{phaseReliability?.summary || "nog in opbouw"}</span></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-amber-500/15 bg-amber-950/20 p-2">
            <div className="text-[8px] font-black uppercase text-amber-300 mb-1">Scheidsrechter-profiel</div>
            <div className="space-y-1 text-[8px] text-slate-300">
              <div>Naam: <span className="font-black text-white">{refereeProfile?.name || "onbekend"}</span></div>
              <div>Land: <span className="font-black text-white">{refereeProfile?.country || "-"}</span></div>
              <div>Bron: <span className="font-black text-white">{refereeProfile?.source || "-"}</span></div>
              <div>Historische duels: <span className="font-black text-white">{refereeProfile?.matches ?? "-"}</span></div>
              <div>Kaartenritme: <span className="font-black text-white">{refereeProfile?.cardsTrend != null ? refereeProfile.cardsTrend.toFixed(2) : "-"}</span></div>
              <div>Penalty-kans: <span className="font-black text-white">{refereeProfile?.estimatedPenaltyRate != null ? `${Math.round(refereeProfile.estimatedPenaltyRate * 100)}%` : "-"}</span></div>
              <div>Profiel: <span className="font-black text-white">{refereeProfile?.strictness || "-"}</span></div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-500/15 bg-slate-950/20 p-2">
            <div className="text-[8px] font-black uppercase text-slate-300 mb-1">Bronkwaliteit</div>
            <div className="space-y-1 text-[8px] text-slate-300">
              <div>Closing-diepte: <span className="font-black text-white">{marketCalibration?.closingCoverage != null ? `${Math.round(marketCalibration.closingCoverage * 100)}%` : "-"}</span></div>
              <div>Marktsterkte: <span className="font-black text-white">{marketCalibration?.strength != null ? `${Math.round(marketCalibration.strength * 100)}%` : "-"}</span></div>
              <div>Competitie: <span className="font-black text-white">{competitionReliability?.reliabilityScore != null ? `${Math.round(competitionReliability.reliabilityScore * 100)}%` : "-"}</span></div>
              <div>Fase: <span className="font-black text-white">{phaseReliability?.reliabilityScore != null ? `${Math.round(phaseReliability.reliabilityScore * 100)}%` : "-"}</span></div>
              <div>Free Source Coverage: <span className="font-black text-white">{freeSourceCoverage?.percent != null ? `${freeSourceCoverage.percent}%` : "-"}</span></div>
              {freeSourceEntries.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {freeSourceEntries.slice(0, 8).map((entry: any) => (
                    <span key={entry.key || entry.label} className={`rounded px-1 py-0.5 border ${entry.available ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-slate-600/30 bg-slate-800/50 text-slate-500"}`}>
                      {entry.label || entry.key}
                    </span>
                  ))}
                </div>
              )}
              {freeSourceNames && <div>Bronnen: <span className="font-black text-white">{freeSourceNames}</span></div>}
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

function KeySignals({ match, prediction }: { match: any; prediction: any }) {
  const signals: string[] = [];
  const contextSummary = cleanSignalText(match.context?.summary);
  if (contextSummary) signals.push(contextSummary);
  if (match.aggregate?.active && match.aggregate.aggregateScore) signals.push(`totaalstand ${match.aggregate.aggregateScore}`);
  if (prediction.modelEdges?.clubEloDiff) signals.push(`ClubElo verschil ${prediction.modelEdges.clubEloDiff}`);
  if (prediction.modelEdges?.rest != null && Math.abs(prediction.modelEdges.rest) >= 1) {
    signals.push(`rustverschil ${prediction.modelEdges.rest > 0 ? "+" : ""}${prediction.modelEdges.rest}d`);
  }
  if (match.h2h?.played >= 3) signals.push(`H2H ${match.h2h.homeWins}-${match.h2h.draws}-${match.h2h.awayWins}`);
  if (match.lineupSummary?.confirmed) signals.push("opstellingen bevestigd");
  if (match.competitionReliability?.reliabilityScore != null) {
    signals.push(`competitiebetrouwbaarheid ${Math.round(match.competitionReliability.reliabilityScore * 100)}%`);
  }
  if (match.phaseReliability?.reliabilityScore != null) {
    signals.push(`fase ${Math.round(match.phaseReliability.reliabilityScore * 100)}%`);
  }
  const dataCompleteness = prediction.dataCompleteness || match.dataCompleteness || prediction.modelEdges?.dataCompleteness;
  const dataCompletenessPct = dataCompleteness?.percent ?? (dataCompleteness?.score != null ? Math.round(dataCompleteness.score * 100) : null);
  if (dataCompletenessPct != null) signals.push(`bronkwaliteit ${dataCompletenessPct}%`);
  if (match.refereeProfile?.strictness) signals.push(`scheids ${match.refereeProfile.strictness}`);

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

function ScoreMatrix({ topScores }: { topScores: any[] }) {
  if (!topScores.length) return null;

  return (
    <div className="mb-2 rounded-xl border border-blue-400/10 bg-slate-950/45 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[7px] font-black uppercase text-slate-400">Meest waarschijnlijke exacte scores</div>
        <div className="text-[7px] font-black uppercase text-blue-300">scorematrix</div>
      </div>
      <div className="flex flex-wrap gap-1">
        {topScores.map(([score, prob]: any, index: number) => (
          <div
            key={score}
            className={`rounded-lg px-2 py-1 text-[9px] font-black ${
              index === 0
                ? "bg-blue-500/20 text-white ring-1 ring-blue-300/20"
                : "bg-slate-800/85 text-slate-300"
            }`}
            title={`Kans op ${score}: ${(Number(prob || 0) * 100).toFixed(0)}%`}
          >
            {score} <span className={index === 0 ? "text-blue-200" : "text-slate-500"}>{(Number(prob || 0) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonteCarloPanel({ monteCarlo }: { monteCarlo: any }) {
  if (!monteCarlo?.active) return null;

  const pct = (value: any) => (value == null ? "-" : `${Math.round(Number(value || 0) * 100)}%`);
  const simulations = Number(monteCarlo.simulations || 10000).toLocaleString("nl-NL");

  return (
    <div className="mb-2 rounded-xl border border-cyan-300/15 bg-cyan-950/20 p-2 shadow-[0_0_24px_rgba(34,211,238,0.08)]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div>
          <div className="text-[7px] font-black uppercase text-cyan-300">Monte Carlo simulatie</div>
          <div className="text-[8px] text-slate-400">{simulations} runs, meegewogen in score en 1X2</div>
        </div>
        <div className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-[8px] font-black text-cyan-100">
          {pct(monteCarlo.weight)} gewicht
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div className="rounded-lg bg-slate-950/45 px-2 py-1">
          <div className="text-[7px] uppercase text-slate-500">Topscore</div>
          <div className="text-[10px] font-black text-white">
            {monteCarlo.topScore || "-"} <span className="text-cyan-200">{pct(monteCarlo.topScoreProb)}</span>
          </div>
        </div>
        <div className="rounded-lg bg-slate-950/45 px-2 py-1">
          <div className="text-[7px] uppercase text-slate-500">1X2 simulatie</div>
          <div className="text-[10px] font-black text-white">
            {pct(monteCarlo.homeProb)} / {pct(monteCarlo.drawProb)} / {pct(monteCarlo.awayProb)}
          </div>
        </div>
        <div className="rounded-lg bg-slate-950/45 px-2 py-1">
          <div className="text-[7px] uppercase text-slate-500">Goals</div>
          <div className="text-[10px] font-black text-white">
            BTTS {pct(monteCarlo.bttsProb)} · O2.5 {pct(monteCarlo.over25Prob)}
          </div>
        </div>
      </div>
    </div>
  );
}

function outcomeName(code?: string) {
  if (code === "H") return "Thuis";
  if (code === "A") return "Uit";
  if (code === "D") return "Gelijk";
  return "-";
}

function PredictionResultStrip({ review }: { review: any }) {
  if (!review) return null;

  const exactGood = Boolean(review.exactHit);
  const outcomeGood = Boolean(review.outcomeHit || review.probabilityOutcomeHit);
  const exactClass = exactGood
    ? "border-emerald-400/25 bg-emerald-950/35 text-emerald-200"
    : "border-rose-400/25 bg-rose-950/35 text-rose-200";
  const outcomeClass = outcomeGood
    ? "border-blue-400/25 bg-blue-950/35 text-blue-200"
    : "border-amber-400/25 bg-amber-950/35 text-amber-200";

  return (
    <div className="mb-2 rounded-xl border border-white/10 bg-slate-950/45 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div>
          <div className="text-[7px] font-black uppercase text-slate-400">AI check na afloop</div>
          <div className="text-[9px] text-slate-500">
            Voorspeld {review.predictedScore || "-"} - werkelijk {review.actualScore || "-"}
          </div>
        </div>
        <div className={`rounded-full px-2 py-0.5 text-[8px] font-black ${exactGood ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
          {exactGood ? "Exact goed" : "Exact fout"}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className={`rounded-lg border px-2 py-1.5 ${exactClass}`}>
          <div className="text-[7px] font-black uppercase opacity-70">Juiste uitslag</div>
          <div className="text-[11px] font-black">{exactGood ? "Ja" : "Nee"}</div>
        </div>
        <div className={`rounded-lg border px-2 py-1.5 ${outcomeClass}`}>
          <div className="text-[7px] font-black uppercase opacity-70">Winnaar/gelijk</div>
          <div className="text-[11px] font-black">
            {outcomeGood ? "Goed" : "Fout"} - {outcomeName(review.actualOutcome)}
          </div>
        </div>
      </div>
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
  const dataCompleteness = prediction.dataCompleteness || match.dataCompleteness || prediction.modelEdges?.dataCompleteness;
  const dataCompletenessPct = dataCompleteness?.percent ?? (dataCompleteness?.score != null ? Math.round(dataCompleteness.score * 100) : null);
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
          <span className={`rounded-full px-2 py-0.5 text-[8px] font-black ${dataCompletenessPct != null && dataCompletenessPct < 58 ? "bg-amber-500/15 text-amber-200" : "bg-emerald-500/15 text-emerald-200"}`}>
            {dataCompletenessPct != null ? `${dataCompletenessPct}% data` : "data ?"}
          </span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[8px] font-black text-slate-300">
            {activeModel}
          </span>
          <span className="text-[10px] font-black text-slate-300">{open ? "^" : "v"}</span>
        </div>
      </button>

      {open && (
      <div className="border-t border-white/6 px-3 py-3 space-y-2">
        {match.worldCup2026 || prediction.worldCup2026 ? (
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/10 p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="text-[8px] font-black uppercase text-cyan-200">
                WK 2026 data-audit
              </div>
              <div className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-[8px] font-black text-cyan-100">
                Match {match.worldCup2026?.matchNumber || prediction.worldCup2026?.matchNumber}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[8px] text-slate-300">
              <div>Landensterkte: <span className="font-black text-white">seed aanwezig</span></div>
              <div>Selectie: <span className="font-black text-amber-200">nog niet geverifieerd</span></div>
              <div>Topvorm spelers: <span className="font-black text-amber-200">provider nodig</span></div>
              <div>Oefenduels: <span className="font-black text-amber-200">worker/provider</span></div>
            </div>
          </div>
        ) : null}

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
  const dataCompleteness = prediction.dataCompleteness || match.dataCompleteness || prediction.modelEdges?.dataCompleteness;
  const qualityGate = prediction.qualityGate || match.qualityGate || prediction.modelEdges?.qualityGate;
  const sourceReliability = prediction.modelEdges?.sourceReliability || null;
  const featureImportance = prediction.featureImportance || prediction.modelEdges?.featureImportance || [];
  const leagueCalibration = prediction.modelEdges?.leagueCalibration || null;
  const dataCompletenessPct = dataCompleteness?.percent ?? (dataCompleteness?.score != null ? Math.round(dataCompleteness.score * 100) : null);

  return (
    <>
    <div className="grid grid-cols-6 gap-1.5 mb-2">
      <div className="rounded-xl border border-cyan-500/15 bg-cyan-950/20 px-2 py-1.5">
        <div className="text-[7px] uppercase font-black text-cyan-300/80">Model</div>
        <div className={`text-[10px] font-black ${agreement != null && agreement < 0.55 ? "text-amber-300" : "text-white"}`}>
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
      <div className="rounded-xl border border-yellow-500/15 bg-yellow-950/20 px-2 py-1.5">
        <div className="text-[7px] uppercase font-black text-yellow-300/80">Datagate</div>
        <div className={`text-[10px] font-black truncate ${qualityGate?.blockedHighConfidence ? "text-amber-200" : "text-white"}`}>
          {dataCompletenessPct != null ? `${dataCompletenessPct}%` : "n.v.t."}
        </div>
      </div>
      <div className="rounded-xl border border-fuchsia-500/15 bg-fuchsia-950/20 px-2 py-1.5">
        <div className="text-[7px] uppercase font-black text-fuchsia-300/80">Bronscore</div>
        <div className="text-[10px] font-black text-white">
          {sourceReliability?.score != null ? `${Math.round(Number(sourceReliability.score) * 100)}%` : "-"}
        </div>
      </div>
    </div>
    <div className="rounded-xl border border-white/10 bg-slate-950/40 px-2 py-2 mb-2">
      <div className="text-[8px] font-black uppercase text-slate-400 mb-1">Model debug</div>
      <div className="text-[9px] text-slate-300">
        Datagate: <span className="font-black text-white">{qualityGate?.summary || "n.v.t."}</span>
      </div>
      {leagueCalibration?.profile && (
        <div className="text-[9px] text-slate-400 mt-1">
          League calibratie: draw {Number(leagueCalibration.profile.drawBias || 0) >= 0 ? "+" : ""}{Number(leagueCalibration.profile.drawBias || 0).toFixed(3)} · home {Number(leagueCalibration.profile.homeBias || 0) >= 0 ? "+" : ""}{Number(leagueCalibration.profile.homeBias || 0).toFixed(3)} · conf {Number(leagueCalibration.profile.confidenceBias || 0) >= 0 ? "+" : ""}{Number(leagueCalibration.profile.confidenceBias || 0).toFixed(3)}
        </div>
      )}
      {Array.isArray(featureImportance) && featureImportance.length > 0 && (
        <div className="mt-1 text-[9px] text-slate-300">
          Top drivers: {featureImportance.slice(0, 4).map((item: any) => `${item.label || item.key} (${item.score})`).join(" · ")}
        </div>
      )}
    </div>
    </>
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

function buildLocalAiAnalysis(match: any, prediction: any) {
  const score = `${Number(prediction?.predHomeGoals || 0)}-${Number(prediction?.predAwayGoals || 0)}`;
  const confidence = Math.round(Number(prediction?.confidence || 0) * 100);
  const dataQuality = Math.round(Number(prediction?.dataCompletenessScore ?? prediction?.dataCompleteness?.score ?? match?.dataCompletenessScore ?? 0) * 100);
  const probability = [
    { label: "thuis", value: Number(prediction?.homeProb || 0) },
    { label: "gelijk", value: Number(prediction?.drawProb || 0) },
    { label: "uit", value: Number(prediction?.awayProb || 0) },
  ].sort((a, b) => b.value - a.value)[0];
  const risk = prediction?.modelEdges?.riskProfile || prediction?.riskProfile || "middel";
  const calibration = prediction?.modelEdges?.confidenceCalibration?.applied ? "gekalibreerd met reviewdata" : "basisconfidence";
  const warnings = Array.isArray(prediction?.modelEdges?.modelWarnings) && prediction.modelEdges.modelWarnings.length
    ? ` Let op: ${prediction.modelEdges.modelWarnings.slice(0, 2).join(", ")}.`
    : "";
  return `Model kiest ${score}; 1X2 neigt naar ${probability.label} (${Math.round(probability.value * 100)}%). Confidence ${confidence}%, datakwaliteit ${dataQuality}%, risico ${risk}; ${calibration}.${warnings}`;
}

const MatchCard: React.FC<MatchCardProps> = ({ match, prediction, onFavoriteChange }) => {
  const [tab, setTab] = useState<"analyse" | "h2h" | "vorm" | "markten">("analyse");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedSquadSide, setSelectedSquadSide] = useState<"home" | "away" | null>(null);
  const triedRef = useRef(false);
  const liveMinute = useLiveMinute(match as any);

  useEffect(() => {
    if (triedRef.current || !prediction) return;
    triedRef.current = true;
    setAiAnalysis(buildLocalAiAnalysis(match, prediction));
    fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match, prediction }),
    })
      .then(async (response) => {
        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !contentType.includes("json")) return null;
        return response.json();
      })
      .then((data) => {
        if (data.analysis) setAiAnalysis(data.analysis);
      })
      .catch(() => {})
      .finally(() => setAiLoading(false));
  }, [match, prediction]);

  if (!prediction) {
    return <div className="glass-card rounded-2xl p-4 border border-white/5 animate-pulse h-72" />;
  }

  const matchStatus = String(match.status || "").toUpperCase();
  const isHalfTime = matchStatus === "HT";
  const isResultPending = matchStatus === "RESULT_PENDING";
  const isFinished = matchStatus === "FT" || matchStatus === "AET" || matchStatus === "PEN" || isResultPending || matchStatus.includes("FINISH");
  const isLive = !isFinished && (matchStatus === "LIVE" || isHalfTime || !!liveMinute);
  const weather = match.weather || prediction.weather;
  const h2h = match.h2h || prediction.h2h;
  const aggregate = match.aggregate || prediction.aggregate;
  const loser = aggregateLoser(match, aggregate);
  const importantMatch = showImportance(match);
  const topScores = Object.entries(prediction.scoreMatrix || {})
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 6);
  const monteCarlo = prediction.monteCarlo || (match as any).monteCarlo;
  const confidenceBase = prediction.confidence ?? Math.max(prediction.homeProb || 0, prediction.drawProb || 0, prediction.awayProb || 0);
  const confidencePct = Math.max(0, Math.min(99, Math.round((confidenceBase || 0) * 100)));
  const review = match.review || prediction.review || null;
  const modelLabel = (prediction.ensembleMeta || match.ensembleMeta)?.active ? "Ensemble" : "Basis";
  const phaseReliability = prediction.modelEdges?.phaseReliability || match.phaseReliability;
  const modelScopeLabel =
    String(match.league || "").startsWith("Europe -") && (
      String(match.league || "").toLowerCase().includes("friendly") ||
      String(match.league || "").toLowerCase().includes("qualification") ||
      String(match.league || "").toLowerCase().includes("nations league") ||
      String(match.league || "").toLowerCase().includes("international")
    )
      ? "Interland"
      : "Club";
  const scopeScore =
    phaseReliability?.reliabilityScore != null ? `${Math.round(phaseReliability.reliabilityScore * 100)}%` : "-";
  const timingLabel = isLive
    ? isHalfTime
      ? "Rust"
      : liveMinute && liveMinute !== "LIVE"
      ? liveMinute
      : "live"
    : isFinished
      ? isResultPending
        ? "Uitslag volgt"
        : "FT"
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
          <button
            type="button"
            onClick={() => setSelectedSquadSide(selectedSquadSide === "home" ? null : "home")}
            className={`mx-auto block text-[10px] font-black underline-offset-2 hover:underline ${loser === match.homeTeamName ? "text-slate-500 line-through" : "text-white"}`}
            aria-label={`Toon selectie van ${match.homeTeamName}`}
          >
            {match.homeTeamName} {match.homePos ? `(#${match.homePos})` : ""}
          </button>
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
          <button
            type="button"
            onClick={() => setSelectedSquadSide(selectedSquadSide === "away" ? null : "away")}
            className={`mx-auto block text-[10px] font-black underline-offset-2 hover:underline ${loser === match.awayTeamName ? "text-slate-500 line-through" : "text-white"}`}
            aria-label={`Toon selectie van ${match.awayTeamName}`}
          >
            {match.awayTeamName} {match.awayPos ? `(#${match.awayPos})` : ""}
          </button>
          <div className="text-[7px] text-slate-500">ClubElo {match.awayClubElo ?? "-"}</div>
          <FormPills form={match.awayForm} />
          <div className="text-[8px] text-slate-500 mt-0.5">
            PPG {match.awayTeamProfile?.pointsPerGame ?? "-"}
          </div>
        </div>
      </div>

      {selectedSquadSide === "home" && (
        <TeamSquadPanel
          title={match.homeTeamName}
          profile={match.homeTeamProfile}
          injuries={match.homeInjuries}
          onClose={() => setSelectedSquadSide(null)}
        />
      )}
      {selectedSquadSide === "away" && (
        <TeamSquadPanel
          title={match.awayTeamName}
          profile={match.awayTeamProfile}
          injuries={match.awayInjuries}
          onClose={() => setSelectedSquadSide(null)}
        />
      )}

      <div className="grid grid-cols-4 gap-1 mb-2">
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
        <div className="rounded-lg border border-emerald-500/15 bg-emerald-950/20 px-2 py-1.5 text-center">
          <div className="text-[7px] uppercase font-black text-emerald-300/80">{modelScopeLabel}</div>
          <div className="text-[11px] font-black text-white">{scopeScore}</div>
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

      <PredictionResultStrip review={review} />

      <ScoreMatrix topScores={topScores} />
      <MonteCarloPanel monteCarlo={monteCarlo} />

      <div className="mb-2">
        <KeySignals match={match} prediction={prediction} />
      </div>

      <ExpandableMatchMeta match={match} prediction={prediction} weather={weather} h2h={h2h} />

      <button
        type="button"
        onClick={() => setDetailsOpen((value) => !value)}
        className="w-full mt-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-left hover:border-blue-400/40 transition flex items-center justify-between gap-3"
      >
        <span>
          <span className="block text-[8px] uppercase font-black text-slate-400">Analyse, H2H, vorm en markt</span>
          <span className="block text-[9px] text-slate-500">Uitklappen voor alle AI-details onder deze wedstrijd</span>
        </span>
        <span className="rounded-full bg-blue-500/15 px-2 py-1 text-[9px] font-black text-blue-200">
          {detailsOpen ? "Sluiten" : "Meer info"}
        </span>
      </button>

      {detailsOpen && (
        <div className="mt-2 space-y-2">
      <div className="grid grid-cols-4 gap-0.5 mt-2 mb-2 pt-1 border-t border-white/5">
        {[
          { key: "analyse", label: "AI" },
          { key: "h2h", label: "H2H" },
          { key: "vorm", label: "Vorm" },
          { key: "markten", label: "Markt" },
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
          {review && <PostMatchReview review={review} prediction={prediction} />}
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

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg p-2 bg-slate-900/60">
              <div className="text-[7px] font-black uppercase text-slate-400 mb-1">Laatste 5 onderling</div>
              <div className="text-[8px] text-slate-500 mb-1">
                {h2h?.targetPlayed ? `${h2h?.played || 0}/${h2h.targetPlayed} gevonden - ` : ""}
                {getH2HSourceLabel(h2h?.status)}
              </div>
              <div className="flex gap-1">
                {buildRecentH2HForm(h2h, match.homeTeamId, match.awayTeamId).length ? (
                  buildRecentH2HForm(h2h, match.homeTeamId, match.awayTeamId).map((item) => (
                    <span
                      key={item.key}
                      title={`${item.date} ${item.home} ${item.score} ${item.away}`}
                      className={`w-5 h-5 rounded-sm text-[8px] font-black flex items-center justify-center ${
                        item.label === "W"
                          ? "bg-green-500 text-white"
                          : item.label === "L"
                            ? "bg-red-500 text-white"
                            : "bg-amber-500 text-black"
                      }`}
                    >
                      {item.label}
                    </span>
                  ))
                ) : (
                  <div className="text-[9px] text-slate-500">geen recente onderlinge data</div>
                )}
              </div>
            </div>
            <div className="rounded-lg p-2 bg-slate-900/60">
              <div className="text-[7px] font-black uppercase text-slate-400 mb-1">Recente H2H balans</div>
              <div className="text-[11px] font-black text-white">
                {h2h?.weightedRecentBalance != null ? h2h.weightedRecentBalance : "-"}
              </div>
              <div className="text-[8px] text-slate-500 mt-1">
                positief = voordeel {match.homeTeamName}, negatief = voordeel {match.awayTeamName}
              </div>
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
            <RecentList title={`${match.homeTeamName} laatste 10`} recent={match.homeRecent} />
            <RecentList title={`${match.awayTeamName} laatste 10`} recent={match.awayRecent} />
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

        </div>
      )}
    </div>
  );
};

export default MatchCard;

