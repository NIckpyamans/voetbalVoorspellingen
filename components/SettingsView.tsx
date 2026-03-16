import React, { useState, useEffect } from 'react';

const SettingsView: React.FC = () => {
  const [cacheCleared, setCacheCleared] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);
  const [teamCount, setTeamCount] = useState(0);
  const [lastWorker, setLastWorker] = useState<string | null>(null);

  useEffect(() => {
    // Statistieken ophalen
    const mem = localStorage.getItem('footypredict_memory');
    if (mem) setHistoryCount(JSON.parse(mem).length);
    const teams = localStorage.getItem('footypredict_team_store_v1');
    if (teams) setTeamCount(Object.keys(JSON.parse(teams)).length);
    // Worker tijd ophalen
    fetch('/api/matches?date=' + new Date().toISOString().split('T')[0])
      .then(r => r.json())
      .then(d => { if (d.lastRun) setLastWorker(new Date(d.lastRun).toLocaleString('nl-NL')); })
      .catch(() => {});
  }, []);

  const clearCache = () => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('footypredict_'));
    keys.forEach(k => localStorage.removeItem(k));
    setCacheCleared(true);
    setTimeout(() => window.location.reload(), 1000);
  };

  const clearHistory = () => {
    if (window.confirm('Alle voorspellingsgeschiedenis wissen?')) {
      localStorage.removeItem('footypredict_memory');
      setHistoryCount(0);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-black text-white uppercase tracking-tight">Instellingen</h2>
        <p className="text-slate-500 text-xs mt-0.5">App configuratie en beheer</p>
      </div>

      {/* App info */}
      <div className="glass-card rounded-2xl border border-white/5 p-5 space-y-4">
        <div className="text-[10px] font-black text-slate-400 uppercase">App informatie</div>
        {[
          { label: 'Opgeslagen voorspellingen', value: historyCount.toLocaleString(), icon: '📊' },
          { label: 'Teams in database (lokaal)', value: teamCount.toLocaleString(), icon: '⚽' },
          { label: 'Laatste worker run', value: lastWorker || 'Onbekend', icon: '🤖' },
          { label: 'Data opslag', value: 'GitHub + localStorage', icon: '💾' },
          { label: 'Voorspellingsmodel', value: 'Dixon-Coles + Elo', icon: '🧠' },
        ].map(({ label, value, icon }) => (
          <div key={label} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
            <span className="text-[11px] text-slate-400 flex items-center gap-2"><span>{icon}</span>{label}</span>
            <span className="text-[11px] font-black text-white">{value}</span>
          </div>
        ))}
      </div>

      {/* Hoe werkt het */}
      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Hoe werkt het leren?</div>
        <div className="space-y-3 text-[11px] text-slate-300 leading-relaxed">
          <div className="flex gap-3">
            <span className="text-green-400 font-black flex-shrink-0">1.</span>
            <span>De <strong className="text-white">GitHub Actions worker</strong> draait elke 30 minuten automatisch op de achtergrond — jij hoeft niets te doen.</span>
          </div>
          <div className="flex gap-3">
            <span className="text-green-400 font-black flex-shrink-0">2.</span>
            <span>De worker haalt alle uitslagen op van SofaScore en past de <strong className="text-white">Elo ratings</strong> en <strong className="text-white">aanvals/verdedigingsstats</strong> aan per team.</span>
          </div>
          <div className="flex gap-3">
            <span className="text-green-400 font-black flex-shrink-0">3.</span>
            <span>Na een paar weken heeft het systeem <strong className="text-white">duizenden wedstrijden</strong> verwerkt en zijn voorspellingen nauwkeuriger dan bij de start.</span>
          </div>
          <div className="flex gap-3">
            <span className="text-green-400 font-black flex-shrink-0">4.</span>
            <span>Je <strong className="text-white">hoeft de site niet open te hebben</strong> — alles gaat volledig automatisch op de achtergrond.</span>
          </div>
        </div>
      </div>

      {/* Cache beheer */}
      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Cache beheer</div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-black text-white">App cache wissen</div>
              <div className="text-[9px] text-slate-500">Verwijdert tijdelijke data, herlaadt wedstrijden</div>
            </div>
            <button onClick={clearCache}
              className={`px-4 py-2 rounded-lg text-[10px] font-black transition
                ${cacheCleared ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
              {cacheCleared ? '✓ Gewist' : 'Cache wissen'}
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-white/5 pt-3">
            <div>
              <div className="text-[11px] font-black text-white">Voorspellingsgeschiedenis wissen</div>
              <div className="text-[9px] text-slate-500">{historyCount} opgeslagen resultaten</div>
            </div>
            <button onClick={clearHistory}
              className="px-4 py-2 rounded-lg text-[10px] font-black bg-red-900/20 border border-red-500/20 text-red-400 hover:bg-red-900/30 transition">
              Wissen
            </button>
          </div>
        </div>
      </div>

      {/* Versie info */}
      <div className="text-center text-[9px] text-slate-700">
        FootyAI · Dixon-Coles model · SofaScore data · Claude AI analyse
      </div>
    </div>
  );
};

export default SettingsView;
