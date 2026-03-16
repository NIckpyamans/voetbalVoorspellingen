import React, { useEffect, useState } from 'react';

interface StandingRow {
  pos: number; team: string; teamId: string;
  p: number; w: number; d: number; l: number;
  gf: number; ga: number; pts: number;
}

interface LeagueStanding {
  label: string;
  rows: StandingRow[];
  updated: number;
}

const StandingsView: React.FC = () => {
  const [standings, setStandings] = useState<Record<string, LeagueStanding>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/standings')
      .then(r => r.json())
      .then(data => {
        setStandings(data.standings || {});
        setLoading(false);
        // Selecteer eerste beschikbare competitie
        const keys = Object.keys(data.standings || {});
        if (keys.length > 0) setSelected(keys[0]);
      })
      .catch(() => setLoading(false));
  }, []);

  const LEAGUE_ORDER = [
    '🏆 Champions League','🥈 Europa League','🥉 Conference League',
    '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League','🏴󠁧󠁢󠁥󠁮󠁧󠁿 Championship',
    '🇳🇱 Eredivisie','🇳🇱 Eerste Divisie',
    '🇩🇪 Bundesliga','🇩🇪 2. Bundesliga',
    '🇪🇸 LaLiga','🇪🇸 LaLiga2',
    '🇮🇹 Serie A','🇮🇹 Serie B',
    '🇫🇷 Ligue 1','🇫🇷 Ligue 2',
    '🇵🇹 Liga Portugal','🇵🇹 Liga Portugal 2',
    '🇧🇪 Pro League','🇧🇪 Challenger Pro League',
  ];

  const sortedKeys = Object.keys(standings).sort((a, b) => {
    const la = standings[a]?.label || '';
    const lb = standings[b]?.label || '';
    return LEAGUE_ORDER.indexOf(la) - LEAGUE_ORDER.indexOf(lb);
  });

  const currentStanding = selected ? standings[selected] : null;

  if (loading) return (
    <div className="flex flex-col gap-3">
      {[1,2,3].map(i=><div key={i} className="h-12 glass-card rounded-xl animate-pulse"/>)}
    </div>
  );

  if (sortedKeys.length === 0) return (
    <div className="text-center py-20 text-slate-500">
      <div className="text-5xl mb-3">📊</div>
      <div className="font-bold">Standen worden geladen na de volgende worker run</div>
      <div className="text-[11px] mt-2">Start de GitHub Actions worker via Acties → Football AI Worker → Run workflow</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-black text-white uppercase tracking-tight">Competitiestanden</h2>
        <p className="text-slate-500 text-xs mt-0.5">
          {currentStanding ? `Bijgewerkt: ${new Date(currentStanding.updated).toLocaleString('nl-NL')}` : ''}
        </p>
      </div>

      {/* Competitie tabs */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
        {sortedKeys.map(key => {
          const label = standings[key]?.label || key;
          const parts = label.split(' ');
          const flag = parts[0];
          const name = parts.slice(1).join(' ');
          return (
            <button key={key} onClick={() => setSelected(key)}
              className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-black transition
                ${selected === key ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
              <span>{flag}</span><span className="whitespace-nowrap">{name}</span>
            </button>
          );
        })}
      </div>

      {/* Stand tabel */}
      {currentStanding && (
        <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
          {/* Tabelkop */}
          <div className="grid grid-cols-12 gap-1 px-4 py-2 bg-slate-900/60 text-[8px] font-black text-slate-400 uppercase">
            <div className="col-span-1">#</div>
            <div className="col-span-4">Club</div>
            <div className="col-span-1 text-center">W</div>
            <div className="col-span-1 text-center">G</div>
            <div className="col-span-1 text-center">V</div>
            <div className="col-span-1 text-center">+/-</div>
            <div className="col-span-1 text-center">Dg</div>
            <div className="col-span-2 text-right font-black text-white">Pnt</div>
          </div>

          {/* Rijen */}
          {currentStanding.rows.map((row, idx) => {
            // Kleuren voor top/degradatie posities
            const isTop3    = row.pos <= 3;
            const isEuropa  = row.pos === 4 || row.pos === 5;
            const isBottom3 = row.pos >= (currentStanding.rows.length - 2);
            const goalDiff  = (row.gf || 0) - (row.ga || 0);

            return (
              <div key={row.teamId || idx}
                className={`grid grid-cols-12 gap-1 px-4 py-2.5 border-b border-white/5 last:border-0 text-sm items-center
                  hover:bg-white/3 transition
                  ${isTop3 ? 'border-l-2 border-l-blue-500' : ''}
                  ${isEuropa ? 'border-l-2 border-l-orange-500' : ''}
                  ${isBottom3 ? 'border-l-2 border-l-red-500' : ''}`}>
                <div className={`col-span-1 text-[11px] font-black
                  ${isTop3 ? 'text-blue-400' : isEuropa ? 'text-orange-400' : isBottom3 ? 'text-red-400' : 'text-slate-500'}`}>
                  {row.pos}
                </div>
                <div className="col-span-4">
                  <div className="flex items-center gap-2">
                    <img
                      src={`https://api.sofascore.app/api/v1/team/${row.teamId}/image`}
                      className="w-5 h-5 object-contain"
                      alt=""
                      onError={(e) => { (e.target as any).style.display = 'none'; }}
                    />
                    <span className="text-[11px] font-black text-white truncate">{row.team}</span>
                  </div>
                </div>
                <div className="col-span-1 text-center text-[11px] text-green-400 font-bold">{row.w}</div>
                <div className="col-span-1 text-center text-[11px] text-slate-400 font-bold">{row.d}</div>
                <div className="col-span-1 text-center text-[11px] text-red-400 font-bold">{row.l}</div>
                <div className={`col-span-1 text-center text-[11px] font-bold ${goalDiff > 0 ? 'text-green-400' : goalDiff < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                  {goalDiff > 0 ? `+${goalDiff}` : goalDiff}
                </div>
                <div className="col-span-1 text-center text-[10px] text-slate-500">{row.p}</div>
                <div className="col-span-2 text-right">
                  <span className="text-sm font-black text-white bg-slate-800 px-2 py-0.5 rounded-lg">{row.pts}</span>
                </div>
              </div>
            );
          })}

          {/* Legenda */}
          <div className="px-4 py-3 bg-slate-900/40 flex flex-wrap gap-3">
            {[
              { color: 'bg-blue-500', label: 'Champions League' },
              { color: 'bg-orange-500', label: 'Europa League' },
              { color: 'bg-red-500', label: 'Degradatie' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className={`w-2 h-3 rounded-sm ${color}`} />
                <span className="text-[8px] text-slate-500">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default StandingsView;
