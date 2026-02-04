
import React, { useEffect, useState } from 'react';
import { PredictionMemory } from '../types';

const PredictionHistory: React.FC = () => {
  const [history, setHistory] = useState<PredictionMemory[]>([]);

  useEffect(() => {
    const data = localStorage.getItem('footypredict_memory');
    if (data) {
      try {
        const parsed = JSON.parse(data);
        setHistory(parsed.sort((a: any, b: any) => b.timestamp - a.timestamp));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  const clearHistory = () => {
    if (window.confirm("Weet je zeker dat je alle historie wilt wissen?")) {
      localStorage.removeItem('footypredict_memory');
      setHistory([]);
    }
  };

  const stats = {
    total: history.length,
    correct: history.filter(h => h.wasCorrect).length,
    accuracy: history.length > 0 ? (history.filter(h => h.wasCorrect).length / history.length * 100).toFixed(1) : 0,
    avgError: history.length > 0 ? (history.reduce((acc, curr) => acc + curr.errorMargin, 0) / history.length).toFixed(2) : 0
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black text-white uppercase tracking-tighter">AI Prediction Archive</h2>
          <p className="text-slate-500 font-bold text-xs uppercase tracking-widest mt-1">Deep Learning Performance Audit</p>
        </div>
        <button 
          onClick={clearHistory}
          className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-black uppercase hover:bg-red-500/20 transition-all"
        >
          Wissen
        </button>
      </div>

      {/* Stats Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-card p-6 rounded-3xl border border-white/5">
          <span className="text-[10px] font-black text-blue-400 uppercase block mb-1">Total Predictions</span>
          <span className="text-3xl font-black text-white">{stats.total}</span>
        </div>
        <div className="glass-card p-6 rounded-3xl border border-white/5">
          <span className="text-[10px] font-black text-green-400 uppercase block mb-1">Success Rate</span>
          <span className="text-3xl font-black text-white">{stats.accuracy}%</span>
        </div>
        <div className="glass-card p-6 rounded-3xl border border-white/5">
          <span className="text-[10px] font-black text-purple-400 uppercase block mb-1">Avg Score Error</span>
          <span className="text-3xl font-black text-white">{stats.avgError}</span>
        </div>
        <div className="glass-card p-6 rounded-3xl border border-white/5">
          <span className="text-[10px] font-black text-yellow-400 uppercase block mb-1">Winning Streak</span>
          <span className="text-3xl font-black text-white">N/A</span>
        </div>
      </div>

      {/* History List */}
      <div className="space-y-3">
        {history.length === 0 ? (
          <div className="glass-card p-12 rounded-3xl text-center border border-dashed border-white/10">
            <i className="fas fa-box-open text-4xl text-slate-700 mb-4"></i>
            <p className="text-slate-500 font-bold">No archived predictions found. Start tracking live matches to build your audit log.</p>
          </div>
        ) : (
          history.map((item, idx) => (
            <div key={idx} className="glass-card p-4 md:p-6 rounded-3xl border border-white/5 flex items-center justify-between group hover:border-blue-500/30 transition-all">
              <div className="flex items-center gap-6">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl ${item.wasCorrect ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                  <i className={`fas ${item.wasCorrect ? 'fa-check-circle' : 'fa-times-circle'}`}></i>
                </div>
                <div>
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">Match ID: {item.matchId}</div>
                  <div className="text-sm font-bold text-white uppercase">Result Audit</div>
                  <div className="text-[10px] text-slate-600 mt-0.5">{new Date(item.timestamp).toLocaleString()}</div>
                </div>
              </div>

              <div className="flex items-center gap-12 text-center">
                <div className="flex flex-col">
                  <span className="text-[8px] font-black text-blue-400 uppercase">AI Prediction</span>
                  <span className="text-xl font-black text-white">{item.prediction}</span>
                </div>
                <div className="text-slate-700 font-black text-xl">/</div>
                <div className="flex flex-col">
                  <span className="text-[8px] font-black text-slate-500 uppercase">Actual Score</span>
                  <span className="text-xl font-black text-white">{item.actual}</span>
                </div>
                <div className="hidden md:flex flex-col ml-8">
                  <span className="text-[8px] font-black text-slate-500 uppercase">Margin</span>
                  <span className={`text-sm font-black ${item.errorMargin === 0 ? 'text-green-400' : 'text-slate-400'}`}>
                    {item.errorMargin === 0 ? 'EXACT' : `+${item.errorMargin}`}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default PredictionHistory;
