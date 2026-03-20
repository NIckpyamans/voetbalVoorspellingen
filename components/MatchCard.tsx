// ============================================================================
// MATCH CARD COMPONENT - VOLLEDIG
// Toont wedstrijdkaart met ALLE beschikbare data
// ============================================================================

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Match, Prediction } from "../types";
import { toggleFavorite, isFavorite } from "./FavoriteTeams";

interface MatchCardProps {
  match: Match;
  prediction?: Prediction;
  onFavoriteChange?: () => void;
}

const MatchCard: React.FC<MatchCardProps> = ({ match, prediction, onFavoriteChange }) => {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const analysisCache = useRef<Map<string, { text: string; timestamp: number }>>(new Map());

  const homeKey = match.homeTeamId || match.homeTeamName.toLowerCase();
  const awayKey = match.awayTeamId || match.awayTeamName.toLowerCase();
  const isHomeFav = isFavorite(homeKey);
  const isAwayFav = isFavorite(awayKey);

  const isLive = String(match.status || "").toUpperCase() === "LIVE" || !!match.minute;
  const isFinished = String(match.status || "").toUpperCase() === "FT" || 
                     String(match.status || "").toUpperCase().includes("FINISH");

  // ========================================
  // ANALYSIS FETCH
  // ========================================
  const fetchAnalysis = useCallback(async () => {
    if (!prediction) return;

    const cached = analysisCache.current.get(match.id);
    const now = Date.now();
    if (cached && now - cached.timestamp < 24 * 60 * 60 * 1000) {
      setAnalysis(cached.text);
      return;
    }

    setAnalysisLoading(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ match, prediction }),
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.analysis) {
          setAnalysis(data.analysis);
          analysisCache.current.set(match.id, { 
            text: data.analysis, 
            timestamp: now 
          });
        }
      }
    } catch (err) {
      console.error("Analysis fetch failed:", err);
    } finally {
      setAnalysisLoading(false);
    }
  }, [match, prediction]);

  useEffect(() => {
    if (showAnalysis && !analysis && !analysisLoading) {
      fetchAnalysis();
    }
  }, [showAnalysis, analysis, analysisLoading, fetchAnalysis]);

  // ========================================
  // HANDLERS
  // ========================================
  const handleFavoriteClick = (teamKey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(teamKey);
    onFavoriteChange?.();
  };

  // ========================================
  // RENDER HELPERS
  // ========================================
  const renderScore = () => {
    if (match.score) {
      return (
        <div className="text-2xl font-black">
          {match.score}
        </div>
      );
    }
    
    if (prediction) {
      return (
        <div className="text-lg font-black opacity-60">
          {prediction.predHomeGoals}-{prediction.predAwayGoals}
        </div>
      );
    }
    
    return <div className="text-sm opacity-50">VS</div>;
  };

  const renderOdds = () => {
    if (!prediction) return null;
    
    const homeProb = Math.round((prediction.homeProb || 0) * 100);
    const drawProb = Math.round((prediction.drawProb || 0) * 100);
    const awayProb = Math.round((prediction.awayProb || 0) * 100);

    return (
      <div className="grid grid-cols-3 gap-1 mb-2">
        <div className="bg-slate-800/50 rounded px-2 py-1 text-center">
          <div className="text-[9px] text-slate-400">THUIS</div>
          <div className="text-sm font-black">{homeProb}%</div>
        </div>
        <div className="bg-slate-800/50 rounded px-2 py-1 text-center">
          <div className="text-[9px] text-slate-400">GELIJK</div>
          <div className="text-sm font-black">{drawProb}%</div>
        </div>
        <div className="bg-slate-800/50 rounded px-2 py-1 text-center">
          <div className="text-[9px] text-slate-400">UIT</div>
          <div className="text-sm font-black">{awayProb}%</div>
        </div>
      </div>
    );
  };

  const renderXG = () => {
    if (!prediction?.homeXG || !prediction?.awayXG) return null;
    
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
        <span>xG:</span>
        <span className="font-bold">{prediction.homeXG.toFixed(1)}</span>
        <span>-</span>
        <span className="font-bold">{prediction.awayXG.toFixed(1)}</span>
      </div>
    );
  };

  const renderBttsOverUnder = () => {
    if (!prediction) return null;
    
    return (
      <div className="flex gap-1 mb-2">
        {prediction.btts != null && (
          <div className="flex-1 bg-slate-800/50 rounded px-2 py-1 text-center">
            <div className="text-[8px] text-slate-400">BTTS</div>
            <div className="text-xs font-bold">{Math.round(prediction.btts * 100)}%</div>
          </div>
        )}
        {prediction.over25 != null && (
          <div className="flex-1 bg-slate-800/50 rounded px-2 py-1 text-center">
            <div className="text-[8px] text-slate-400">OVER 2.5</div>
            <div className="text-xs font-bold">{Math.round(prediction.over25 * 100)}%</div>
          </div>
        )}
      </div>
    );
  };

  const renderForm = () => {
    const homeForm = match.homeForm || prediction?.homeForm;
    const awayForm = match.awayForm || prediction?.awayForm;
    
    if (!homeForm && !awayForm) return null;

    const formChar = (char: string) => {
      if (char === "W") return <span className="text-green-400">●</span>;
      if (char === "D") return <span className="text-yellow-400">●</span>;
      if (char === "L") return <span className="text-red-400">●</span>;
      return <span className="text-slate-600">●</span>;
    };

    return (
      <div className="flex justify-between items-center text-xs mb-2">
        {homeForm && (
          <div className="flex gap-0.5">
            {homeForm.split("").map((char, i) => (
              <span key={i}>{formChar(char)}</span>
            ))}
          </div>
        )}
        <div className="text-slate-500">Vorm</div>
        {awayForm && (
          <div className="flex gap-0.5">
            {awayForm.split("").map((char, i) => (
              <span key={i}>{formChar(char)}</span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderPositions = () => {
    const homePos = match.homePos || prediction?.homePos;
    const awayPos = match.awayPos || prediction?.awayPos;
    
    if (!homePos && !awayPos) return null;

    return (
      <div className="flex justify-between text-xs text-slate-400 mb-2">
        {homePos && <div>#{homePos}</div>}
        <div>Positie</div>
        {awayPos && <div>#{awayPos}</div>}
      </div>
    );
  };

  const renderElo = () => {
    const homeElo = match.homeClubElo || match.homeElo;
    const awayElo = match.awayClubElo || match.awayElo;
    
    if (!homeElo && !awayElo) return null;

    return (
      <div className="flex justify-between text-xs text-slate-400 mb-2">
        {homeElo && <div>{Math.round(homeElo)}</div>}
        <div>Elo</div>
        {awayElo && <div>{Math.round(awayElo)}</div>}
      </div>
    );
  };

  const renderLiveStats = () => {
    if (!isLive || !match.liveStats) return null;

    const stats = match.liveStats;

    return (
      <div className="space-y-1 mb-2 p-2 bg-slate-900/50 rounded">
        <div className="text-[9px] text-slate-400 mb-1">LIVE STATISTIEKEN</div>
        
        {stats.possession && (
          <div>
            <div className="flex justify-between text-[10px] mb-0.5">
              <span>{stats.possession.home}%</span>
              <span className="text-slate-500">Balbezit</span>
              <span>{stats.possession.away}%</span>
            </div>
            <div className="h-1 bg-slate-800 rounded-full overflow-hidden flex">
              <div 
                className="bg-blue-500" 
                style={{ width: `${stats.possession.home}%` }}
              />
              <div 
                className="bg-red-500" 
                style={{ width: `${stats.possession.away}%` }}
              />
            </div>
          </div>
        )}

        {stats.shots && (
          <div className="flex justify-between text-[10px]">
            <span>{stats.shots.home}</span>
            <span className="text-slate-500">Schoten</span>
            <span>{stats.shots.away}</span>
          </div>
        )}

        {stats.shotsOnTarget && (
          <div className="flex justify-between text-[10px]">
            <span>{stats.shotsOnTarget.home}</span>
            <span className="text-slate-500">Op doel</span>
            <span>{stats.shotsOnTarget.away}</span>
          </div>
        )}

        {stats.xG && (
          <div className="flex justify-between text-[10px]">
            <span>{stats.xG.home.toFixed(1)}</span>
            <span className="text-slate-500">Live xG</span>
            <span>{stats.xG.away.toFixed(1)}</span>
          </div>
        )}

        {stats.corners && (
          <div className="flex justify-between text-[10px]">
            <span>{stats.corners.home}</span>
            <span className="text-slate-500">Hoekschoppen</span>
            <span>{stats.corners.away}</span>
          </div>
        )}

        {(stats.yellowCards || stats.redCards) && (
          <div className="flex justify-between text-[10px]">
            <span>
              {stats.yellowCards?.home || 0}
              {stats.redCards?.home ? ` (${stats.redCards.home}🔴)` : ""}
            </span>
            <span className="text-slate-500">Kaarten</span>
            <span>
              {stats.yellowCards?.away || 0}
              {stats.redCards?.away ? ` (${stats.redCards.away}🔴)` : ""}
            </span>
          </div>
        )}
      </div>
    );
  };

  const renderAdvancedStats = () => {
    if (!showAdvanced) return null;

    return (
      <div className="mt-3 p-3 bg-slate-900/50 rounded space-y-2">
        <div className="text-[10px] font-bold text-slate-400 mb-2">GEAVANCEERDE STATISTIEKEN</div>
        
        {/* Rest Days */}
        {(match.homeRestDays != null || match.awayRestDays != null) && (
          <div className="flex justify-between text-xs">
            <span>{match.homeRestDays ?? "?"}</span>
            <span className="text-slate-500">Rustdagen</span>
            <span>{match.awayRestDays ?? "?"}</span>
          </div>
        )}

        {/* Injuries */}
        {(match.homeInjuries || match.awayInjuries) && (
          <div className="flex justify-between text-xs">
            <span className={match.homeInjuries?.injuredCount ? "text-red-400" : ""}>
              {match.homeInjuries?.injuredCount || 0}
            </span>
            <span className="text-slate-500">Blessures</span>
            <span className={match.awayInjuries?.injuredCount ? "text-red-400" : ""}>
              {match.awayInjuries?.injuredCount || 0}
            </span>
          </div>
        )}

        {/* H2H */}
        {match.h2h && match.h2h.played >= 2 && (
          <div className="text-xs">
            <div className="text-slate-500 mb-1">Head-to-Head ({match.h2h.played}x)</div>
            <div className="flex justify-between">
              <span className="text-green-400">{match.h2h.homeWins}W</span>
              <span className="text-yellow-400">{match.h2h.draws}D</span>
              <span className="text-red-400">{match.h2h.awayWins}W</span>
            </div>
          </div>
        )}

        {/* Weather */}
        {match.weather && (
          <div className="text-xs">
            <div className="text-slate-500 mb-1">Weer</div>
            <div className="flex justify-between">
              {match.weather.temperature && <span>{match.weather.temperature}°C</span>}
              {match.weather.windSpeed && <span>Wind {match.weather.windSpeed} km/u</span>}
              {match.weather.precipitationProbability && (
                <span>{match.weather.precipitationProbability}% regen</span>
              )}
            </div>
          </div>
        )}

        {/* Team Profiles */}
        {(match.homeTeamProfile?.setPieceScore || match.awayTeamProfile?.setPieceScore) && (
          <div className="flex justify-between text-xs">
            <span>{match.homeTeamProfile?.setPieceScore ?? "-"}</span>
            <span className="text-slate-500">Set Pieces</span>
            <span>{match.awayTeamProfile?.setPieceScore ?? "-"}</span>
          </div>
        )}

        {/* Referee */}
        {match.referee?.name && (
          <div className="text-xs">
            <div className="text-slate-500">Scheidsrechter</div>
            <div>{match.referee.name}</div>
            {match.referee.avgCardsPerGame && (
              <div className="text-[10px] text-slate-400">
                ⚠️ Ø {match.referee.avgCardsPerGame.toFixed(1)} kaarten/wedstrijd
              </div>
            )}
          </div>
        )}

        {/* Model Edges */}
        {prediction?.modelEdges && (
          <div className="text-xs space-y-1">
            {prediction.modelEdges.riskProfile && (
              <div>
                Risico: <span className={
                  prediction.modelEdges.riskProfile === "high" ? "text-red-400" :
                  prediction.modelEdges.riskProfile === "medium" ? "text-yellow-400" :
                  "text-green-400"
                }>{prediction.modelEdges.riskProfile}</span>
              </div>
            )}
            {prediction.modelEdges.modelAgreement != null && (
              <div>
                Model agreement: {Math.round(prediction.modelEdges.modelAgreement * 100)}%
              </div>
            )}
            {prediction.modelEdges.tacticalMismatch?.summary && (
              <div className="text-[10px] text-blue-300">
                ⚔️ {prediction.modelEdges.tacticalMismatch.summary}
              </div>
            )}
          </div>
        )}

        {/* Lineup Confirmed */}
        {match.lineupSummary?.confirmed && (
          <div className="text-xs text-green-400">
            ✓ Opstellingen bevestigd
          </div>
        )}

        {/* Venue */}
        {match.venue?.name && (
          <div className="text-xs">
            <div className="text-slate-500">Stadion</div>
            <div>{match.venue.name}</div>
            {match.venue.capacity && (
              <div className="text-[10px] text-slate-400">
                Capaciteit: {match.venue.capacity.toLocaleString()}
              </div>
            )}
          </div>
        )}

        {/* Aggregate */}
        {match.aggregate?.active && (
          <div className="text-xs">
            <div className="text-slate-500">Tweeluik</div>
            <div>
              Eerste duel: {match.aggregate.firstLegScore || "?"}
            </div>
            <div>
              Aggregaat: {match.aggregate.aggregateScore || "?"}
            </div>
          </div>
        )}

        {/* Context */}
        {match.context?.summary && (
          <div className="text-xs">
            <div className="text-slate-500">Context</div>
            <div className="text-yellow-300">{match.context.summary}</div>
          </div>
        )}
      </div>
    );
  };

  // ========================================
  // MAIN RENDER
  // ========================================
  return (
    <div className="glass-card rounded-2xl p-4 border border-white/5 hover:border-white/10 transition-all">
      {/* League & Time */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wider">
          {match.league?.split(" - ").slice(0, 2).join(" ")}
        </div>
        <div className="text-[10px] text-slate-500">
          {isLive && match.minute ? (
            <span className="text-red-400 animate-pulse font-bold">{match.minute}</span>
          ) : match.kickoff ? (
            new Date(match.kickoff).toLocaleTimeString("nl-NL", {
              hour: "2-digit",
              minute: "2-digit",
            })
          ) : (
            match.status
          )}
        </div>
      </div>

      {/* Teams */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            {match.homeLogo && (
              <img src={match.homeLogo} alt="" className="w-6 h-6 object-contain" />
            )}
            <div className="flex-1 font-bold text-sm truncate">{match.homeTeamName}</div>
            <button
              onClick={(e) => handleFavoriteClick(homeKey, e)}
              className={`text-lg ${isHomeFav ? "text-yellow-400" : "text-slate-600 hover:text-yellow-400"}`}
            >
              ★
            </button>
          </div>

          <div className="flex items-center gap-2">
            {match.awayLogo && (
              <img src={match.awayLogo} alt="" className="w-6 h-6 object-contain" />
            )}
            <div className="flex-1 font-bold text-sm truncate">{match.awayTeamName}</div>
            <button
              onClick={(e) => handleFavoriteClick(awayKey, e)}
              className={`text-lg ${isAwayFav ? "text-yellow-400" : "text-slate-600 hover:text-yellow-400"}`}
            >
              ★
            </button>
          </div>
        </div>

        <div className="text-center">
          {renderScore()}
        </div>
      </div>

      {/* Odds */}
      {renderOdds()}

      {/* xG */}
      {renderXG()}

      {/* BTTS & Over/Under */}
      {renderBttsOverUnder()}

      {/* Form */}
      {renderForm()}

      {/* Positions */}
      {renderPositions()}

      {/* Elo */}
      {renderElo()}

      {/* Live Stats */}
      {renderLiveStats()}

      {/* Advanced Stats Toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="w-full text-xs text-slate-400 hover:text-white py-2 border-t border-white/5 mt-2"
      >
        {showAdvanced ? "▲ Verberg details" : "▼ Meer details"}
      </button>

      {/* Advanced Stats */}
      {renderAdvancedStats()}

      {/* Analysis Toggle */}
      {prediction && (
        <button
          onClick={() => setShowAnalysis(!showAnalysis)}
          className="w-full text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 rounded py-2 mt-2 transition"
        >
          {showAnalysis ? "Verberg analyse" : "Toon AI analyse"}
        </button>
      )}

      {/* Analysis Display */}
      {showAnalysis && (
        <div className="mt-2 p-3 bg-slate-900/50 rounded text-xs text-slate-300">
          {analysisLoading ? (
            <div className="animate-pulse">Analyse wordt geladen...</div>
          ) : analysis ? (
            <div>{analysis}</div>
          ) : (
            <div className="text-slate-500">Geen analyse beschikbaar</div>
          )}
        </div>
      )}
    </div>
  );
};

export default MatchCard;
