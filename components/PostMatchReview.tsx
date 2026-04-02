import React from "react";

const signalLabels: Record<string, string> = {
  clubelo_misread: "ClubElo-signaal zat fout",
  open_lineups: "Opstellingen waren nog open",
  weather_risk: "Weer had meer impact",
  rest_gap: "Rustverschil woog verkeerd",
  h2h_signal: "H2H-signaal was misleidend",
  market_misread: "Marktprofiel zat aan de andere kant",
  low_model_agreement: "Modelen zaten onderling te ver uit elkaar",
};

function outcomeLabel(code?: string) {
  if (code === "H") return "Thuis";
  if (code === "A") return "Uit";
  if (code === "D") return "Gelijk";
  return "-";
}

const PostMatchReview: React.FC<{ review: any; prediction?: any }> = ({ review, prediction }) => {
  if (!review) return null;
  const model = prediction?.ensembleMeta?.active
    ? `${prediction.ensembleMeta.baseModel} + ${prediction.ensembleMeta.blendModel}`
    : prediction?.model || "basis";

  const scoreOutcomeGood = review.outcomeHit || review.exactHit;
  const chanceOutcomeGood = review.probabilityOutcomeHit ?? review.outcomeHit ?? false;

  return (
    <div className="bg-gradient-to-br from-emerald-950/40 to-slate-950/60 border border-emerald-500/20 rounded-xl p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[7px] font-black text-emerald-400 uppercase">Modelreview</div>
          <div className="text-[9px] text-slate-300">voorspelde score, topkans en echte uitslag</div>
        </div>
        <div className={`text-[8px] font-black px-2 py-0.5 rounded-full ${scoreOutcomeGood ? "bg-green-900/40 text-green-300" : "bg-red-900/40 text-red-300"}`}>
          {scoreOutcomeGood ? "Score-uitkomst goed" : "Score-uitkomst fout"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[9px]">
        <div className="rounded-lg bg-slate-900/60 p-2">
          <div className="text-[7px] uppercase text-slate-500 font-black">Voorspeld</div>
          <div className="text-white font-black">{review.predictedScore}</div>
          <div className="text-slate-400">{outcomeLabel(review.predictedOutcome)}</div>
        </div>
        <div className="rounded-lg bg-slate-900/60 p-2">
          <div className="text-[7px] uppercase text-slate-500 font-black">Werkelijk</div>
          <div className="text-white font-black">{review.actualScore}</div>
          <div className="text-slate-400">{outcomeLabel(review.actualOutcome)}</div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 text-center">
        <div className="rounded-lg bg-slate-900/60 p-1.5">
          <div className="text-[7px] uppercase text-slate-500 font-black">Confidence</div>
          <div className="text-[10px] font-black text-white">{Math.round((review.confidence || 0) * 100)}%</div>
        </div>
        <div className="rounded-lg bg-slate-900/60 p-1.5">
          <div className="text-[7px] uppercase text-slate-500 font-black">Exact</div>
          <div className="text-[10px] font-black text-white">{review.exactHit ? "Ja" : "Nee"}</div>
        </div>
        <div className="rounded-lg bg-slate-900/60 p-1.5">
          <div className="text-[7px] uppercase text-slate-500 font-black">Goal error</div>
          <div className="text-[10px] font-black text-white">{review.totalGoalError}</div>
        </div>
        <div className="rounded-lg bg-slate-900/60 p-1.5">
          <div className="text-[7px] uppercase text-slate-500 font-black">Model</div>
          <div className="text-[10px] font-black text-white truncate">{model}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[8px]">
        <div className={`rounded-lg p-2 border ${scoreOutcomeGood ? "border-green-500/20 bg-green-950/20 text-green-300" : "border-red-500/20 bg-red-950/20 text-red-300"}`}>
          <div className="text-[7px] uppercase opacity-70 font-black">Voorspelde score-uitkomst</div>
          <div className="font-black">{scoreOutcomeGood ? "goed" : "fout"}</div>
          <div className="text-slate-300">score {review.predictedScore} tegen {review.actualScore}</div>
        </div>
        <div className={`rounded-lg p-2 border ${chanceOutcomeGood ? "border-blue-500/20 bg-blue-950/20 text-blue-300" : "border-amber-500/20 bg-amber-950/20 text-amber-300"}`}>
          <div className="text-[7px] uppercase opacity-70 font-black">Topkans 1X2</div>
          <div className="font-black">{chanceOutcomeGood ? "goed" : "naast scorekaart"}</div>
          <div className="text-slate-300">
            {outcomeLabel(review.probabilityOutcome || review.predictedOutcome)}
            {review.probabilityOutcome && review.probabilityOutcome !== review.predictedOutcome ? " was topkans" : " was score-uitkomst"}
          </div>
        </div>
      </div>

      <div className="rounded-lg bg-slate-900/60 p-2 text-[8px] text-slate-300">
        <div className="text-[7px] uppercase text-slate-500 font-black mb-1">Leersignalen</div>
        {review.failureSignals?.length ? (
          <div className="flex flex-wrap gap-1">
            {review.failureSignals.map((signal: string) => (
              <span key={signal} className="px-1.5 py-0.5 rounded bg-amber-900/30 border border-amber-500/20 text-amber-300">
                {signalLabels[signal] || signal}
              </span>
            ))}
          </div>
        ) : (
          <div>Geen dominant faalsignaal; model zat redelijk in lijn met de uitslag.</div>
        )}
      </div>
    </div>
  );
};

export default PostMatchReview;
