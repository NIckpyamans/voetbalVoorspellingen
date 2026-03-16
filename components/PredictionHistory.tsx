import React, { useEffect, useState, useMemo } from 'react';

interface HistoryItem {
  matchId: string;
  prediction: string;
  actual: string;
  wasCorrect: boolean;
  errorMargin: number;
  timestamp: number;
  homeTeam?: string;
  awayTeam?: string;
  league?: string;
}

const PredictionHistory: React.FC = () => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [filter, setFilter] = useState<'alle' | 'correct' | 'fout'>('alle');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    // Laad uit localStorage (footypredict_memory) + server history
    const local = localStorage.getItem('footypredict_memory');
    if (local) {
      try {
        const parsed = JSON.parse(local);
        setHistory(parsed.sort((a: HistoryItem, b: HistoryItem) => b.timestamp - a.timestamp));
      } catch {}
    }
  }, []);

  const clearHistory = () => {
    if (window.confirm('Weet je zeker dat je alle geschiedenis wilt wissen?')) {
      localStorage.removeItem('footypredict_memory');
      setHistory([]);
    }
  };

  // Statistieken
  const stats = useMemo(() => {
    const correct = history.filter(h => h.wasCorrect).length;
    const total = history.length;
    const errors = history.map(h => h.errorMargin);
    const avgError = total > 0 ? (errors.reduce((a, b) => a + b, 0) / total).toFixed(2) : '0';
    const accuracy = total > 0 ? ((correct / total) * 100).toFixed(1) : '0';

    // Winnende reeks
    let streak = 0, maxStreak = 0;
    for (const h of [...history].reverse()) {
      if (h.wasCorrect) { streak++; maxStreak = Math.max(maxStreak, streak); }
      else streak = 0;
    }

    // Per competitie stats
    const byLeague: Record<string, { correct: number; total: number }> = {};
    for (const h of history) {
      const l = h.league || 'Onbekend';
      if (!byLeague[l]) byLeague[l] = { correct: 0, total: 0 };
      byLeague[l].total++;
      if (h.wasCorrect) byLeague[l].correct++;
    }
    const topLeague = Object.entries(byLeague)
      .sort((a, b) => (b[1].correct / b[1].total) - (a[1].correct / a[1].total))[0];

    // Groepeer per dag
    const byDay: Record<string, number> = {};
    for (const h of history) {
      const day = new Date(h.timestamp).toISOString().split('T')[0];
      byDay[day] = (byDay[day] || 0) + 1;
    }

    return { correct, total, accuracy, avgError, maxStreak, topLeague, byLeague, byDay };
  }, [history]);

  // Gefilterd + gezocht
  const filtered = useMemo(() => {
    return history.filter(h => {
      if (filter === 'correct' && !h.wasCorrect) return false;
      if (filter === 'fout' && h.wasCorrect) return false;
      if (search) {
        const s = search.toLowerCase();
        const matchName = `${h.homeTeam || ''} ${h.awayTeam || ''} ${h.matchId}`.toLowerCase();
        if (!matchName.includes(s)) return false;
      }
      return true;
    });
  }, [history, filter, search]);

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  // Groepeer op datum voor weergave
  const groupedByDate = useMemo(() => {
    const groups: Record<string, HistoryItem[]> = {};
    for (const item of paginated) {
      const day = new Date(item.timestamp).toLocaleDateString('nl-NL', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
      if (!groups[day]) groups[day] = [];
      groups[day].push(item);
    }
    return groups;
  }, [paginated]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h2 className="text-2xl font-black text-white uppercase tracking-tight">Voorspellingsgeschiedenis</h2>
          <p className="text-slate-500 text-xs mt-0.5">{stats.total.toLocaleString()} voorspellingen opgeslagen</p>
        </div>
        <button onClick={clearHistory}
          className="px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-black uppercase hover:bg-red-500/20 transition">
          Alles wissen
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Totaal', value: stats.total.toLocaleString(), color: 'text-blue-400', icon: 'fa-list' },
          { label: 'Nauwkeurigheid', value: `${stats.accuracy}%`, color: 'text-green-400', icon: 'fa-bullseye' },
          { label: 'Gem. foutmarge', value: stats.avgError, color: 'text-purple-400', icon: 'fa-chart-line' },
          { label: 'Beste reeks', value: `${stats.maxStreak}`, color: 'text-yellow-400', icon: 'fa-fire' },
        ].map(({ label, value, color, icon }) => (
          <div key={label} className="glass-card p-4 rounded-2xl border border-white/5">
            <div className={`text-[9px] font-black ${color} uppercase flex items-center gap-1 mb-1`}>
              <i className={`fas ${icon} text-[8px]`} /> {label}
            </div>
            <div className="text-2xl font-black text-white">{value}</div>
          </div>
        ))}
      </div>

      {/* Per competitie stats */}
      {Object.keys(stats.byLeague).length > 0 && (
        <div className="glass-card p-4 rounded-2xl border border-white/5">
          <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Nauwkeurigheid per competitie</div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(stats.byLeague)
              .sort((a, b) => b[1].total - a[1].total)
              .slice(0, 8)
              .map(([league, { correct, total }]) => {
                const pct = Math.round((correct / total) * 100);
                return (
                  <div key={league} className="bg-slate-900/60 rounded-xl p-2">
                    <div className="text-[8px] text-slate-400 truncate mb-1">{league}</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct > 15 ? 'bg-green-500' : pct > 8 ? 'bg-yellow-500' : 'bg-red-500'}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[9px] font-black text-white">{pct}%</span>
                    </div>
                    <div className="text-[7px] text-slate-600 mt-0.5">{correct}/{total} correct</div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Filter + zoek */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex gap-1">
          {([
            { key: 'alle', label: `Alle (${history.length})` },
            { key: 'correct', label: `✓ Correct (${stats.correct})` },
            { key: 'fout', label: `✗ Fout (${stats.total - stats.correct})` },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => { setFilter(key); setPage(0); }}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition
                ${filter === key ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          placeholder="Zoek op teamnaam..."
          className="flex-1 bg-slate-900/60 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 outline-none focus:border-blue-500/40"
        />
      </div>

      {/* Resultaten */}
      {filtered.length === 0 ? (
        <div className="glass-card p-12 rounded-2xl text-center border border-dashed border-white/10">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-slate-500 font-bold">Geen resultaten gevonden</p>
        </div>
      ) : (
        <>
          {/* Gesorteerd per dag */}
          <div className="space-y-6">
            {Object.entries(groupedByDate).map(([day, items]) => (
              <div key={day}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-[10px] font-black text-slate-400 uppercase">{day}</span>
                  <div className="flex-1 h-px bg-white/5" />
                  <span className="text-[9px] text-slate-600">{items.length} wedstrijden</span>
                </div>
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx}
                      className={`glass-card p-3 rounded-xl border flex items-center justify-between
                        ${item.wasCorrect ? 'border-green-500/20 bg-green-900/5' : 'border-white/5'}`}>
                      {/* Links: status + naam */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0
                          ${item.wasCorrect ? 'bg-green-500/15 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                          <i className={`fas text-[10px] ${item.wasCorrect ? 'fa-check' : 'fa-times'}`} />
                        </div>
                        <div className="min-w-0">
                          {item.homeTeam && item.awayTeam ? (
                            <div className="text-[11px] font-black text-white truncate">
                              {item.homeTeam} vs {item.awayTeam}
                            </div>
                          ) : (
                            <div className="text-[10px] text-slate-500">ID: {item.matchId?.slice(-8)}</div>
                          )}
                          {item.league && (
                            <div className="text-[8px] text-slate-600 truncate">{item.league}</div>
                          )}
                          <div className="text-[8px] text-slate-700">
                            {new Date(item.timestamp).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>

                      {/* Rechts: scores */}
                      <div className="flex items-center gap-4 flex-shrink-0 text-center">
                        <div>
                          <div className="text-[7px] text-blue-400 font-black uppercase">AI tip</div>
                          <div className="text-base font-black text-white">{item.prediction}</div>
                        </div>
                        <div className="text-slate-700 font-black">/</div>
                        <div>
                          <div className="text-[7px] text-slate-500 font-black uppercase">Uitslag</div>
                          <div className="text-base font-black text-white">{item.actual}</div>
                        </div>
                        <div className="hidden sm:block">
                          <div className="text-[7px] text-slate-500 font-black uppercase">Marge</div>
                          <div className={`text-sm font-black ${item.errorMargin === 0 ? 'text-green-400' : 'text-slate-400'}`}>
                            {item.errorMargin === 0 ? 'PRECIES' : `+${item.errorMargin}`}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Paginering */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-[10px] font-black disabled:opacity-30 hover:bg-slate-700 transition">
                ‹ Vorige
              </button>
              <span className="text-[10px] text-slate-500">
                Pagina {page + 1} van {totalPages} ({filtered.length} totaal)
              </span>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page === totalPages - 1}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-[10px] font-black disabled:opacity-30 hover:bg-slate-700 transition">
                Volgende ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PredictionHistory;
