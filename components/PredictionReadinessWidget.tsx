import React, { useMemo } from "react";
import { Match, Prediction } from "../types";

type Props = {
  matches: Match[];
  predictions: Record<string, Prediction>;
};

const ratio = (matches: Match[], predicate: (match: Match, prediction: Prediction | undefined) => boolean, predictions: Record<string, Prediction>) => {
  if (!matches.length) return 0;
  return matches.filter((match) => predicate(match, predictions[match.id])).length / matches.length;
};

const PredictionReadinessWidget: React.FC<Props> = ({ matches, predictions }) => {
  const metrics = useMemo(() => {
    const rows = [
      {
        key: "h2h",
        label: "H2H",
        value: ratio(matches, (match) => Number(match.h2h?.played || 0) >= 2, predictions),
        target: 0.75,
      },
      {
        key: "form",
        label: "Vorm",
        value: ratio(matches, (match) => Number((match.homeRecent as any)?.gamesPlayed || 0) >= 5 && Number((match.awayRecent as any)?.gamesPlayed || 0) >= 5, predictions),
        target: 0.8,
      },
      {
        key: "xg",
        label: "xG/shots",
        value: ratio(matches, (match) => match.homeSeasonStats?.xG != null || match.awaySeasonStats?.xG != null || match.homeSeasonStats?.shotsOnTarget != null || match.awaySeasonStats?.shotsOnTarget != null, predictions),
        target: 0.65,
      },
      {
        key: "lineups",
        label: "Lineups",
        value: ratio(matches, (match) => Boolean(match.lineupSummary?.confirmed), predictions),
        target: 0.45,
      },
      {
        key: "odds",
        label: "Echte odds",
        value: ratio(matches, (match, prediction) => Boolean((match as any).oddsAtPrediction || (prediction as any)?.oddsAtPrediction), predictions),
        target: 0.6,
      },
      {
        key: "gate",
        label: "Model-ready",
        value: ratio(matches, (match, prediction) => {
          const gate = (prediction as any)?.qualityGate || (match as any).qualityGate;
          const completeness = Number((prediction as any)?.dataCompletenessScore ?? match.dataCompletenessScore ?? 0);
          return !gate?.blockedHighConfidence && completeness >= 0.58;
        }, predictions),
        target: 0.7,
      },
    ];
    return rows.map((row) => ({ ...row, percent: Math.round(row.value * 100) }));
  }, [matches, predictions]);

  const readiness = Math.round(metrics.reduce((sum, metric) => sum + metric.value, 0) / Math.max(metrics.length, 1) * 100);
  const weakest = [...metrics].sort((a, b) => a.value / a.target - b.value / b.target)[0];
  const tone = readiness >= 70 ? "emerald" : readiness >= 50 ? "amber" : "rose";
  const toneClasses = {
    emerald: { shell: "border-emerald-500/20 bg-emerald-500/5", label: "text-emerald-300", badge: "bg-emerald-500/15 text-emerald-200" },
    amber: { shell: "border-amber-500/20 bg-amber-500/5", label: "text-amber-300", badge: "bg-amber-500/15 text-amber-200" },
    rose: { shell: "border-rose-500/20 bg-rose-500/5", label: "text-rose-300", badge: "bg-rose-500/15 text-rose-200" },
  }[tone];

  return (
    <section className={`mb-4 rounded-2xl border p-4 ${toneClasses.shell}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={`text-[9px] font-black uppercase tracking-[0.2em] ${toneClasses.label}`}>Prediction readiness</div>
          <h2 className="mt-1 text-lg font-black text-white">Datagate voor deze speeldag</h2>
          <p className="mt-1 text-[10px] text-slate-400">
            {matches.length ? `Zwakste onderdeel: ${weakest.label} (${weakest.percent}%).` : "Nog geen wedstrijden om te beoordelen."}
          </p>
        </div>
        <div className={`rounded-full px-4 py-2 text-xl font-black ${toneClasses.badge}`}>{readiness}%</div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map((metric) => {
          const ready = metric.value >= metric.target;
          return (
            <div key={metric.key} className="rounded-xl border border-white/5 bg-slate-950/45 p-3">
              <div className="text-[8px] font-black uppercase text-slate-500">{metric.label}</div>
              <div className={`mt-1 text-lg font-black ${ready ? "text-emerald-300" : "text-amber-300"}`}>{metric.percent}%</div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800">
                <div className={ready ? "h-full bg-emerald-400" : "h-full bg-amber-400"} style={{ width: `${metric.percent}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default PredictionReadinessWidget;
