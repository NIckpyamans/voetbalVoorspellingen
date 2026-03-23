// ============================================================================
// MATCH CARD COMPONENT - VOLLEDIG AANGEPAST
// - Voorspelling blijft zichtbaar na wedstrijd
// - Verticale layout voor odds
// - AI learning systeem
// ============================================================================

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Match, Prediction } from "../types";
import { toggleFavorite, isFavorite } from "./FavoriteTeams";

interface MatchCardProps {
  match: Match;
  prediction?: Prediction;
  onFavoriteChange?: () => void;
}

interface AILearning {
  correctPredictions: string[];
  wrongPredictions: string[];
  learnings: string[];
  confidenceAccuracy: number;
}

const MatchCard: React.FC<MatchCardProps> = ({ match, prediction, onFavoriteChange }) => {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [aiLearning, setAiLearning] = useState<AILearning | null>(null);
  const [learningLoading, setLearningLoading] = useState(false);
  const analysisCache = useRef<Map<string, { text: string; timestamp: number }>>(new Map());

  const homeKey = match.homeTeamId || match.homeTeamName.toLowerCase();
  const awayKey = match.awayTeamId || match.awayTeamName.toLowerCase();
  const isHomeFav = isFavorite(homeKey);
  const isAwayFav = isFavorite(awayKey);

  const isLive = String(match.status || "").toUpperCase() === "LIVE" || !!match.minute;
  const isFinished = String(match.status || "").toUpperCase() === "FT" || 
                     String(match.status || "").toUpperCase().includes("FINISH");

  // ========================================
  // AI LEARNING SYSTEM - NIEUW!
  // ========================================
  const generateAILearning = useCallback(async () => {
    if (!prediction || !isFinished || !match.score) return;
    
    setLearningLoading(true);
    try {
      // Parse score (bijv. "2-1" naar {home: 2, away: 1})
      const [homeScore, awayScore] = match.score.split("-").map(Number);
      
      const learnings: AILearning = {
        correctPredictions: [],
        wrongPredictions: [],
        learnings: [],
        confidenceAccuracy: 0
      };

      // Check voorspelde uitslag vs werkelijk
      const predictedHomeGoals = prediction.predHomeGoals;
      const predictedAwayGoals = prediction.predAwayGoals;
      
      // Check winner
      const actualResult = homeScore > awayScore ? "home" : awayScore > homeScore ? "away" : "draw";
      const predictedResult = predictedHomeGoals > predictedAwayGoals ? "home" : 
                              predictedAwayGoals > predictedHomeGoals ? "away" : "draw";
      
      if (actualResult === predictedResult) {
        learnings.correctPredictions.push(`✅ Winnaar correct voorspeld (${actualResult})`);
      } else {
        learnings.wrongPredictions.push(`❌ Winnaar verkeerd: voorspeld ${predictedResult}, werkelijk ${actualResult}`);
        learnings.learnings.push(`${match.homeTeamName} vs ${match.awayTeamName}: Herzie vorm en statistieken`);
      }

      // Check score accuracy
      if (predictedHomeGoals === homeScore && predictedAwayGoals === awayScore) {
        learnings.correctPredictions.push(`✅ Exacte score correct! (${homeScore}-${awayScore})`);
      } else {
        const scoreDiff = Math.abs((predictedHomeGoals - homeScore)) + Math.abs((predictedAwayGoals - awayScore));
        if (scoreDiff <= 1) {
          learnings.correctPredictions.push(`🎯 Bijna exacte score (voorspeld: ${predictedHomeGoals}-${predictedAwayGoals}, werkelijk: ${homeScore}-${awayScore})`);
        } else {
          learnings.wrongPredictions.push(`📊 Score verschil: voorspeld ${predictedHomeGoals}-${predictedAwayGoals}, werkelijk ${homeScore}-${awayScore}`);
        }
      }

      // Check over/under 2.5
      const totalGoals = homeScore + awayScore;
      if (prediction.over25) {
        const predictedOver25 = prediction.over25 > 0.5;
        const actualOver25 = totalGoals > 2.5;
        if (predictedOver25 === actualOver25) {
          learnings.correctPredictions.push(`✅ Over 2.5 correct voorspeld (${totalGoals} doelpunten)`);
        } else {
          learnings.wrongPredictions.push(`❌ Over 2.5 verkeerd: ${totalGoals} doelpunten`);
          learnings.learnings.push(`Overweeg doelstelling aanpassing voor ${match.league}`);
        }
      }

      // Check BTTS
      if (prediction.btts) {
        const predictedBtts = prediction.btts > 0.5;
        const actualBtts = homeScore > 0 && awayScore > 0;
        if (predictedBtts === actualBtts) {
          learnings.correctPredictions.push(`✅ BTTS correct voorspeld`);
        } else {
          learnings.wrongPredictions.push(`❌ BTTS verkeerd voorspeld`);
        }
      }

      // Check probabilities accuracy
      const homeProb = prediction.homeProb || 0;
      const drawProb = prediction.drawProb || 0;
      const awayProb = prediction.awayProb || 0;
      
      const highestProb = Math.max(homeProb, drawProb, awayProb);
      const predictedOutcome = highestProb === homeProb ? "home" : 
                               highestProb === awayProb ? "away" : "draw";
      
      if (predictedOutcome === actualResult) {
        learnings.confidenceAccuracy = highestProb * 100;
        learnings.learnings.push(`Model had ${Math.round(highestProb * 100)}% vertrouwen en zat goed!`);
      } else {
        learnings.confidenceAccuracy = 0;
        learnings.learnings.push(`Model had ${Math.round(highestProb * 100)}% vertrouwen maar zat fout - herzie model gewichten`);
      }

      // Check xG vs actual
      if (prediction.homeXG && prediction.awayXG) {
        const xgDiff = Math.abs(prediction.homeXG - homeScore) + Math.abs(prediction.awayXG - awayScore);
        if (xgDiff < 1) {
          learnings.correctPredictions.push(`✅ xG model zeer accuraat`);
        } else if (xgDiff > 2) {
          learnings.wrongPredictions.push(`❌ xG model niet accuraat (verschil: ${xgDiff.toFixed(1)})`);
          learnings.learnings.push(`${match.homeTeamName}: Mogelijk overschatting aanvallende kracht`);
        }
      }

      setAiLearning(learnings);
    } catch (err) {
      console.error("AI Learning generation failed:", err);
    } finally {
      setLearningLoading(false);
    }
  }, [match, prediction, isFinished]);

  // Auto-generate learning when match finishes
  useEffect(() => {
    if (isFinished && prediction && !aiLearning && !learningLoading) {
      generateAILearning();
    }
  }, [isFinished, prediction, aiLearning, learningLoading, generateAILearning]);

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
    // AANGEPAST: Toon zowel werkelijke score ALS voorspelde score
    const hasActualScore = !!match.score;
    const hasPrediction = !!prediction;
    
    return (
      <div className="text-center">
        {hasActualScore && (
          <div className="text-2xl font-black text-green-400">
            {match.score}
          </div>
        )}
        
        {hasPrediction && (
          <div className={`text-lg font-bold ${hasActualScore ? 'text-slate-500 text-sm mt-1' : 'text-slate-300'}`}>
            {hasActualScore ? '(voorspeld: ' : ''}{prediction.predHomeGoals}-{prediction.predAwayGoals}{hasActualScore ? ')' : ''}
          </div>
        )}
        
        {!hasActualScore && !hasPrediction && (
          <div className="text-sm opacity-50">VS</div>
        )}
      </div>
    );
  };

  const renderOdds = () => {
    if (!prediction) return null;
    
    const homeProb = Math.round((prediction.homeProb || 0) * 100);
    const drawProb = Math.round((prediction.drawProb || 0) * 100);
    const awayProb = Math.round((prediction.awayProb || 0) * 100);

    // AANGEPAST: Verticale layout ipv horizontaal
    return (
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between bg-slate-800/50 rounded px-3 py-2">
          <div className="flex items-center gap-2">
            {match.homeLogo && (
              <img src={match.homeLogo} alt="" className="w-4 h-4 object-contain" />
            )}
            <span className="text-sm font-medium truncate max-w-[150px]">{match.homeTeamName}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xl font-black">{homeProb}%</div>
            <div className="flex gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <span key={i} className={i < Math.round(homeProb / 20) ? "text-yellow-400" : "text-slate-700"}>
                  ⭐
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between bg-slate-800/50 rounded px-3 py-2">
          <span className="text-sm font-medium text-slate-400">Gelijkspel</span>
          <div className="flex items-center gap-2">
            <div className="text-xl font-black">{drawProb}%</div>
            <div className="flex gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <span key={i} className={i < Math.round(drawProb / 20) ? "text-yellow-400" : "text-slate-700"}>
                  ⭐
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between bg-slate-800/50 rounded px-3 py-2">
          <div className="flex items-center gap-2">
            {match.awayLogo && (
              <img src={match.awayLogo} alt="" className="w-4 h-4 object-contain" />
            )}
            <span className="text-sm font-medium truncate max-w-[150px]">{match.awayTeamName}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xl font-black">{awayProb}%</div>
            <div className="flex gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <span key={i} className={i < Math.round(awayProb / 20) ? "text-yellow-400" : "text-slate-700"}>
                  ⭐
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // NIEUW: Render AI Learning
  const renderAILearning = () => {
    if (!aiLearning || !isFinished) return null;

    return (
      <div className="mt-3 p-3 bg-gradient-to-br from-purple-900/30 to-blue-900/30 rounded-lg border border-purple-500/20">
        <div className="text-xs font-bold text-purple-300 mb-2 flex items-center gap-2">
          🤖 AI LEARNING RAPPORT
        </div>

        {/* Correct predictions */}
        {aiLearning.correctPredictions.length > 0 && (
          <div className="mb-2">
            <div className="text-[10px] text-green-400 font-semibold mb-1">CORRECT:</div>
            <div className="space-y-1">
              {aiLearning.correctPredictions.map((item, i) => (
                <div key={i} className="text-xs text-green-300">{item}</div>
              ))}
            </div>
          </div>
        )}

        {/* Wrong predictions */}
        {aiLearning.wrongPredictions.length > 0 && (
          <div className="mb-2">
            <div className="text-[10px] text-red-400 font-semibold mb-1">FOUT:</div>
            <div className="space-y-1">
              {aiLearning.wrongPredictions.map((item, i) => (
                <div key={i} className="text-xs text-red-300">{item}</div>
              ))}
            </div>
          </div>
        )}

        {/* Learnings */}
        {aiLearning.learnings.length > 0 && (
          <div className="mb-2">
            <div className="text-[10px] text-yellow-400 font-semibold mb-1">LEERPUNTEN:</div>
            <div className="space-y-1">
              {aiLearning.learnings.map((item, i) => (
                <div key={i} className="text-xs text-yellow-300">💡 {item}</div>
              ))}
            </div>
          </div>
        )}

        {/* Confidence score */}
        {aiLearning.confidenceAccuracy > 0 && (
          <div className="mt-2 pt-2 border-t border-purple-500/20">
            <div className="text-xs">
              <span className="text-slate-400">Vertrouwen accuraatheid: </span>
              <span className="text-purple-300 font-bold">{Math.round(aiLearning.confidenceAccuracy)}%</span>
            </div>
          </div>
        )}
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
          <div className="flex justify-between text-xs">
            <span>{stats.possession.home}%</span>
            <span className="text-slate-500">Balbezit</span>
            <span>{stats.possession.away}%</span>
          </div>
        )}

        {stats.shots && (
          <div className="flex justify-between text-xs">
            <span>{stats.shots.home}</span>
            <span className="text-slate-500">Schoten</span>
            <span>{stats.shots.away}</span>
          </div>
        )}

        {stats.shotsOnTarget && (
          <div className="flex justify-between text-xs">
            <span>{stats.shotsOnTarget.home}</span>
            <span className="text-slate-500">Op doel</span>
            <span>{stats.shotsOnTarget.away}</span>
          </div>
        )}

        {stats.corners && (
          <div className="flex justify-between text-xs">
            <span>{stats.corners.home}</span>
            <span className="text-slate-500">Corners</span>
            <span>{stats.corners.away}</span>
          </div>
        )}

        {stats.fouls && (
          <div className="flex justify-between text-xs">
            <span>{stats.fouls.home}</span>
            <span className="text-slate-500">Overtredingen</span>
            <span>{stats.fouls.away}</span>
          </div>
        )}

        {(stats.yellowCards || stats.redCards) && (
          <div className="flex justify-between text-xs">
            <span>
              {stats.yellowCards?.home || 0} 
              {stats.redCards?.home ? ` (${stats.redCards.home} 🔴)` : ""}
            </span>
            <span className="text-slate-500">Kaarten</span>
            <span>
              {stats.yellowCards?.away || 0}
              {stats.redCards?.away ? ` (${stats.redCards.away} 🔴)` : ""}
            </span>
          </div>
        )}
      </div>
    );
  };

  const renderAdvancedStats = () => {
    if (!showAdvanced) return null;

    return (
      <div className="space-y-2 mt-2 p-3 bg-slate-900/30 rounded text-xs">
        {/* Injuries */}
        {(match.homeInjuries || match.awayInjuries) && (
          <div>
            <div className="text-slate-500 mb-1">Blessures & Schorsingen</div>
            <div className="flex justify-between gap-2">
              <span className="text-red-400">
                {match.homeInjuries || "Geen"}
              </span>
              <span className="text-red-400">
                {match.awayInjuries || "Geen"}
              </span>
            </div>
          </div>
        )}

        {/* H2H */}
        {match.h2h && match.h2h.played >= 2 && (
          <div>
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
          <div>
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
          <div className="flex justify-between">
            <span>{match.homeTeamProfile?.setPieceScore ?? "-"}</span>
            <span className="text-slate-500">Set Pieces</span>
            <span>{match.awayTeamProfile?.setPieceScore ?? "-"}</span>
          </div>
        )}

        {/* Referee */}
        {match.referee?.name && (
          <div>
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
          <div className="space-y-1">
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
          <div className="text-green-400">
            ✓ Opstellingen bevestigd
          </div>
        )}

        {/* Venue */}
        {match.venue?.name && (
          <div>
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
          <div>
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
          <div>
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

      {/* Teams - AANGEPAST: Logo's nu alleen in odds sectie */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 font-bold text-sm truncate">{match.homeTeamName}</div>
            <button
              onClick={(e) => handleFavoriteClick(homeKey, e)}
              className={`text-lg ${isHomeFav ? "text-yellow-400" : "text-slate-600 hover:text-yellow-400"}`}
            >
              ★
            </button>
          </div>

          <div className="flex items-center gap-2">
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

      {/* Odds - NU VERTICAAL */}
      {renderOdds()}

      {/* AI Learning - ALLEEN NA WEDSTRIJD */}
      {renderAILearning()}

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
