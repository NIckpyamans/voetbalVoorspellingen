import React, { useMemo, useState } from "react";

// Coupon Builder (inspiratie: Super Score AI 2.0 "Coupon Builder") — volledig gratis:
// selecteer wedstrijden uit het dashboard, combineer ze tot een coupon met totale
// impliciete quotering, en deel deze als tekst (WhatsApp/klipvak). Geen backend nodig.
type CouponPick = {
  matchId: string;
  league: string;
  homeTeamName: string;
  awayTeamName: string;
  pick: "1" | "X" | "2";
  probability: number;
  kickoff: string | null;
};

const PICK_LABEL: Record<CouponPick["pick"], string> = { "1": "Thuiswinst", X: "Gelijkspel", "2": "Uitwinst" };

function formatKickoff(kickoff: string | null) {
  if (!kickoff) return "";
  const parsed = new Date(kickoff);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const CouponBuilder: React.FC<{ picks: CouponPick[]; onRemove: (matchId: string) => void; onClear: () => void }> = ({
  picks,
  onRemove,
  onClear,
}) => {
  const [copied, setCopied] = useState(false);

  const totalQuotation = useMemo(
    () => picks.reduce((product, pick) => product * (pick.probability > 0.01 ? 1 / pick.probability : 0), 1),
    [picks]
  );
  const combinedProbability = useMemo(() => (totalQuotation > 0 ? 1 / totalQuotation : 0), [totalQuotation]);

  const couponText = useMemo(() => {
    if (!picks.length) return "";
    const lines = picks.map((pick) => {
      const when = formatKickoff(pick.kickoff);
      return `• ${pick.homeTeamName} - ${pick.awayTeamName}${when ? ` (${when})` : ""} → ${PICK_LABEL[pick.pick]} (${Math.round(pick.probability * 100)}%)`;
    });
    return [
      "⚽ Voetbal-Ai-tactics coupon",
      ...lines,
      "",
      `Gecombineerde kans: ${Math.round(combinedProbability * 100)}% · impliciete quote: ${totalQuotation > 0 ? totalQuotation.toFixed(2) : "—"}`,
    ].join("\n");
  }, [picks, combinedProbability, totalQuotation]);

  if (!picks.length) {
    return (
      <div className="rounded-xl border border-dashed border-cyan-400/20 bg-slate-950/30 p-4 text-[10px] font-bold text-slate-400">
        Coupon leeg — voeg wedstrijden toe via "Coupon" op een wedstrijdkaart.
      </div>
    );
  }

  const share = async () => {
    const navigatorWithShare = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    try {
      if (navigatorWithShare.share) {
        await navigatorWithShare.share({ title: "Voetbal-Ai-tactics coupon", text: couponText });
        return;
      }
      await navigator.clipboard.writeText(couponText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl border border-cyan-400/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Mijn coupon ({picks.length})</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={share}
            className="rounded-lg bg-cyan-500/20 px-2.5 py-1 text-[10px] font-black text-cyan-200 transition hover:bg-cyan-500/30"
          >
            {copied ? "Gekopieerd ✓" : "Delen"}
          </button>
          <button
            onClick={onClear}
            className="rounded-lg bg-white/5 px-2.5 py-1 text-[10px] font-black text-slate-400 transition hover:bg-white/10"
          >
            Wissen
          </button>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {picks.map((pick) => (
          <div key={`${pick.matchId}-${pick.pick}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-950/40 px-2.5 py-1.5">
            <div className="min-w-0">
              <div className="truncate text-[10px] font-bold text-white">
                {pick.homeTeamName} - {pick.awayTeamName}
              </div>
              <div className="text-[8px] font-bold uppercase tracking-wide text-slate-500">
                {pick.league} · {PICK_LABEL[pick.pick]}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-black text-cyan-200">
                {Math.round(pick.probability * 100)}%
              </span>
              <button
                onClick={() => onRemove(pick.matchId)}
                aria-label="Verwijder van coupon"
                className="rounded px-1 text-[11px] font-black text-slate-500 transition hover:text-rose-300"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg bg-cyan-400/5 px-2.5 py-1.5 text-[10px] font-black">
        <span className="text-slate-400">Gecombineerde kans</span>
        <span className="text-cyan-200">{Math.round(combinedProbability * 100)}%</span>
        <span className="text-slate-400">Quote</span>
        <span className="text-white">{totalQuotation > 0 ? totalQuotation.toFixed(2) : "—"}</span>
      </div>
    </div>
  );
};

export default CouponBuilder;
export type { CouponPick };
