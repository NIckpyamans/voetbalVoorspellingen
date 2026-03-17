import React, { useState, useEffect } from 'react';

const SettingsView: React.FC = () => {
  const [cacheCleared, setCacheCleared] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);
  const [teamCount, setTeamCount] = useState(0);
  const [lastWorker, setLastWorker] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<'checking'|'ok'|'missing'>('checking');

  useEffect(() => {
    const mem = localStorage.getItem('footypredict_memory');
    if (mem) try { setHistoryCount(JSON.parse(mem).length); } catch {}
    const teams = localStorage.getItem('footypredict_team_store_v1');
    if (teams) try { setTeamCount(Object.keys(JSON.parse(teams)).length); } catch {}

    // Haal worker tijd + API status op
    fetch('/api/matches?date=' + new Date().toISOString().split('T')[0])
      .then(r => r.json())
      .then(d => {
        if (d.lastRun) setLastWorker(new Date(d.lastRun).toLocaleString('nl-NL'));
      })
      .catch(() => {});

    // Test of Claude AI werkt
    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match: { homeTeamName: 'Test', awayTeamName: 'Test', league: 'Test', id: 'test' }, prediction: { homeProb: 0.5, drawProb: 0.25, awayProb: 0.25, homeXG: 1.2, awayXG: 1.0, predHomeGoals: 1, predAwayGoals: 1, over25: 0.5, btts: 0.5 } })
    })
      .then(r => r.json())
      .then(d => setApiStatus(d.error?.includes('ANTHROPIC_API_KEY') ? 'missing' : 'ok'))
      .catch(() => setApiStatus('missing'));
  }, []);

  const clearCache = () => {
    Object.keys(localStorage).filter(k => k.startsWith('footypredict_') && !k.includes('memory')).forEach(k => localStorage.removeItem(k));
    setCacheCleared(true);
    setTimeout(() => window.location.reload(), 800);
  };

  const clearHistory = () => {
    if (window.confirm('Alle voorspellingsgeschiedenis wissen?')) {
      localStorage.removeItem('footypredict_memory');
      setHistoryCount(0);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="text-2xl font-black text-white uppercase tracking-tight">Instellingen</h2>
        <p className="text-slate-500 text-xs mt-0.5">App configuratie en beheer</p>
      </div>

      {/* App info */}
      <div className="glass-card rounded-2xl border border-white/5 p-5 space-y-3">
        <div className="text-[10px] font-black text-slate-400 uppercase">App informatie</div>
        {[
          { label: 'Opgeslagen voorspellingen', value: historyCount.toLocaleString(), icon: '📊' },
          { label: 'Teams in database (lokaal)', value: teamCount.toLocaleString(), icon: '⚽' },
          { label: 'Laatste worker run', value: lastWorker || 'Onbekend', icon: '🤖' },
          { label: 'Data opslag', value: 'GitHub + localStorage', icon: '💾' },
        ].map(({ label, value, icon }) => (
          <div key={label} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
            <span className="text-[11px] text-slate-400 flex items-center gap-2"><span>{icon}</span>{label}</span>
            <span className="text-[11px] font-black text-white">{value}</span>
          </div>
        ))}
      </div>

      {/* Voorspellingsmodel — nu v6 met Bayesiaans */}
      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Voorspellingsmodel (v6)</div>
        <div className="space-y-3">
          {[
            {
              name: 'Dixon-Coles + Poisson',
              status: 'actief',
              color: 'green',
              desc: 'Corrigeert Poisson voor lage scores (0-0, 1-0). Kernmodel voor scorematrix.'
            },
            {
              name: 'Bayesiaans Elo',
              status: 'actief',
              color: 'green',
              desc: 'Dynamische K-factor: hoge onzekerheid bij weinig wedstrijden (K=32), stabiele teams K=18. Leert sneller bij nieuwe teams of seizoenswisseling.'
            },
            {
              name: 'Blessuremodel',
              status: 'actief',
              color: 'green',
              desc: 'Geblesseerde spelers verminderen aanvalskracht. Sleutelspelers (rating ≥7.5) geven extra straf van 3% per speler.'
            },
            {
              name: 'Wedstrijdbelang',
              status: 'actief',
              color: 'green',
              desc: 'Teams in top 3 of degradatiezone spelen met 15% hogere intensiteit. Beïnvloedt xG berekening.'
            },
            {
              name: 'Live statistieken',
              status: 'actief bij live',
              color: 'blue',
              desc: 'Realtime schoten, balbezit en hoekschoppen worden getoond tijdens lopende wedstrijden.'
            },
            {
              name: 'Seizoensstatistieken',
              status: 'actief',
              color: 'green',
              desc: 'Gemiddeld schoten op doel per wedstrijd meegewogen in xG berekening (30% gewicht).'
            },
          ].map(({ name, status, color, desc }) => (
            <div key={name} className="flex gap-3 pb-3 border-b border-white/5 last:border-0">
              <span className={`flex-shrink-0 mt-0.5 text-[9px] font-black px-1.5 py-0.5 rounded h-fit
                ${color==='green'?'bg-green-900/30 text-green-400':color==='blue'?'bg-blue-900/30 text-blue-400':'bg-slate-700 text-slate-400'}`}>
                {status}
              </span>
              <div>
                <div className="text-[11px] font-black text-white">{name}</div>
                <div className="text-[9px] text-slate-500 mt-0.5 leading-relaxed">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Claude AI status */}
      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Claude AI analyse</div>

        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[11px] font-black text-white">Status</div>
            <div className="text-[9px] text-slate-500 mt-0.5">Automatische analyse per wedstrijd</div>
          </div>
          <span className={`text-[10px] font-black px-2 py-1 rounded-lg
            ${apiStatus==='ok'?'bg-green-900/30 text-green-400':apiStatus==='missing'?'bg-red-900/30 text-red-400':'bg-slate-700 text-slate-400'}`}>
            {apiStatus==='ok'?'✓ Werkt':apiStatus==='missing'?'✗ API key ontbreekt':'Controleren...'}
          </span>
        </div>

        {apiStatus === 'missing' && (
          <div className="bg-amber-900/20 border border-amber-500/20 rounded-xl p-4 space-y-3">
            <div className="text-[10px] font-black text-amber-400 uppercase">Instellen: ANTHROPIC_API_KEY</div>
            <div className="text-[10px] text-amber-300/80 leading-relaxed space-y-1.5">
              <div>1. Ga naar <span className="font-black text-white">console.anthropic.com</span> → API Keys → maak een nieuwe key aan</div>
              <div>2. Ga naar <span className="font-black text-white">vercel.com</span> → jouw project → <span className="font-black">Settings → Environment Variables</span></div>
              <div>3. Voeg toe: <span className="font-mono text-xs bg-slate-800 px-1.5 py-0.5 rounded">ANTHROPIC_API_KEY</span> = jouw API key</div>
              <div>4. Klik <span className="font-black text-white">Save</span> → ga naar <span className="font-black text-white">Deployments → Redeploy</span></div>
            </div>
            <div className="text-[9px] text-slate-500 pt-1 border-t border-white/5">
              Claude Sonnet 4.6 kost ~€0.001 per analyse. Bij 100 wedstrijden per dag ≈ €3/maand.
            </div>
          </div>
        )}

        {apiStatus === 'ok' && (
          <div className="text-[10px] text-slate-400 leading-relaxed">
            Claude Sonnet 4.6 genereert automatisch een 3-zinnige Nederlandse analyse bij elke wedstrijd.
            De analyse bevat: verwachte uitkomst, opvallende statistiek en een concrete wedtip.
            Resultaat wordt 24 uur gecached zodat je niet telkens betaalt.
          </div>
        )}
      </div>

      {/* Hoe werkt het leren */}
      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Hoe werkt het leren?</div>
        <div className="space-y-3 text-[11px] text-slate-300 leading-relaxed">
          {[
            { n:'1', c:'green', t:'Volledig automatisch', d:'De GitHub Actions worker draait elke 30 minuten op de achtergrond. Je hoeft de site nooit te openen.' },
            { n:'2', c:'blue',  t:'Bayesiaans Elo updaten', d:'Na elke uitslag past het model de teamsterktes aan. Nieuwe teams leren sneller (K=32), gevestigde teams stabieler (K=18).' },
            { n:'3', c:'purple',t:'Blessures verwerken', d:'Elke 4 uur worden blessurelijsten vernieuwd. Geblesseerde sterspelers verlagen direct de aanvalskrachtverwachting.' },
            { n:'4', c:'amber', t:'Verbetering over tijd', d:'Na enkele weken zijn er genoeg wedstrijden verwerkt voor goede Elo-schattingen. Na een volledig seizoen zijn de voorspellingen het nauwkeurigst.' },
          ].map(({ n, c, t, d }) => (
            <div key={n} className="flex gap-3">
              <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black
                ${c==='green'?'bg-green-900/40 text-green-400':c==='blue'?'bg-blue-900/40 text-blue-400':c==='purple'?'bg-purple-900/40 text-purple-400':'bg-amber-900/40 text-amber-400'}`}>
                {n}
              </span>
              <div>
                <span className="font-black text-white">{t} — </span>
                <span className="text-slate-400">{d}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cache beheer */}
      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Cache beheer</div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-black text-white">App-cache wissen</div>
              <div className="text-[9px] text-slate-500">Tijdelijke gegevens verwijderen, herlaadt wedstrijden</div>
            </div>
            <button onClick={clearCache}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition
                ${cacheCleared?'bg-green-600 text-white':'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
              {cacheCleared ? '✓ Gewist' : 'Cache wissen'}
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-white/5 pt-3">
            <div>
              <div className="text-[11px] font-black text-white">Voorspellingsgeschiedenis wissen</div>
              <div className="text-[9px] text-slate-500">{historyCount.toLocaleString()} opgeslagen resultaten</div>
            </div>
            <button onClick={clearHistory}
              className="px-4 py-1.5 rounded-lg text-[10px] font-black bg-red-900/20 border border-red-500/20 text-red-400 hover:bg-red-900/30 transition">
              Wissen
            </button>
          </div>
        </div>
      </div>

      <div className="text-center text-[9px] text-slate-700">
        FootyAI v6 · Dixon-Coles · Bayesiaans Elo · Blessuremodel · Claude Sonnet 4.6
      </div>
    </div>
  );
};

export default SettingsView;
