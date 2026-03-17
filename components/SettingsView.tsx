import React, { useState, useEffect } from 'react';

const SettingsView: React.FC = () => {
  const [cacheCleared, setCacheCleared] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);
  const [teamCount, setTeamCount] = useState(0);
  const [lastWorker, setLastWorker] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<'checking'|'ok'|'missing'>('checking');

  useEffect(() => {
    try { setHistoryCount(JSON.parse(localStorage.getItem('footypredict_memory') || '[]').length); } catch {}
    try { setTeamCount(Object.keys(JSON.parse(localStorage.getItem('footypredict_team_store_v1') || '{}')).length); } catch {}

    fetch('/api/matches?date=' + new Date().toISOString().split('T')[0])
      .then(r => r.json())
      .then(d => { if (d.lastRun) setLastWorker(new Date(d.lastRun).toLocaleString('nl-NL')); })
      .catch(() => {});

    // Test Groq API status
    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        match: { homeTeamName: 'Ajax', awayTeamName: 'PSV', league: 'Eredivisie', id: 'test' },
        prediction: { homeProb: 0.45, drawProb: 0.25, awayProb: 0.30, homeXG: 1.4, awayXG: 1.1, predHomeGoals: 1, predAwayGoals: 1, over25: 0.52, btts: 0.55 }
      })
    })
      .then(r => r.json())
      .then(d => setApiStatus(d.error?.includes('GROQ_API_KEY') ? 'missing' : 'ok'))
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

      {/* Voorspellingsmodel v6 */}
      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Voorspellingsmodel (v6)</div>
        <div className="space-y-2.5">
          {[
            { name: 'Dixon-Coles + Poisson', color: 'green', desc: 'Corrigeert Poisson voor lage scores. Kernmodel voor de scorematrix en kansen.' },
            { name: 'Bayesiaans Elo', color: 'green', desc: 'Dynamische K-factor: nieuwe/onzekere teams leren sneller (K=32), gevestigde teams stabieler (K=18). Betere aanpassing bij seizoenswisseling.' },
            { name: 'Blessuremodel', color: 'green', desc: 'Geblesseerde spelers verminderen aanvalskracht. Sleutelspelers (rating ≥7.5) kosten 3% extra xG per speler.' },
            { name: 'Wedstrijdbelang', color: 'green', desc: 'Teams in top 3 of degradatiezone spelen 15% intensiever. Beïnvloedt xG berekening via matchImportance factor.' },
            { name: 'Live statistieken', color: 'blue', desc: 'Realtime schoten, balbezit en hoekschoppen zichtbaar tijdens lopende wedstrijden.' },
            { name: 'Seizoensstatistieken', color: 'green', desc: 'Gemiddeld schoten op doel per wedstrijd meegewogen in xG (30% gewicht naast vorm).' },
          ].map(({ name, color, desc }) => (
            <div key={name} className="flex gap-3 pb-2.5 border-b border-white/5 last:border-0">
              <span className={`flex-shrink-0 mt-0.5 text-[8px] font-black px-1.5 py-0.5 rounded h-fit whitespace-nowrap
                ${color==='green'?'bg-green-900/30 text-green-400':color==='blue'?'bg-blue-900/30 text-blue-400':'bg-slate-700 text-slate-400'}`}>
                actief
              </span>
              <div>
                <div className="text-[11px] font-black text-white">{name}</div>
                <div className="text-[9px] text-slate-500 mt-0.5 leading-relaxed">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Groq AI analyse */}
      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase">AI Analyse (Groq — gratis)</div>
            <div className="text-[9px] text-slate-500 mt-0.5">LLaMA 3.3 70B · automatisch per wedstrijd · 24u gecached</div>
          </div>
          <span className={`text-[10px] font-black px-2 py-1 rounded-lg flex-shrink-0
            ${apiStatus==='ok'?'bg-green-900/30 text-green-400 border border-green-500/20':
              apiStatus==='missing'?'bg-red-900/30 text-red-400 border border-red-500/20':
              'bg-slate-700 text-slate-400'}`}>
            {apiStatus==='ok'?'✓ Werkt':apiStatus==='missing'?'✗ Key ontbreekt':'Controleren...'}
          </span>
        </div>

        {apiStatus === 'missing' && (
          <div className="bg-blue-900/15 border border-blue-500/20 rounded-xl p-4 space-y-3">
            <div className="text-[10px] font-black text-blue-300 uppercase">Groq instellen — volledig gratis</div>
            <div className="space-y-2 text-[11px] text-slate-300 leading-relaxed">
              <div className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[9px] font-black flex items-center justify-center">1</span>
                <span>Ga naar <span className="font-black text-white">console.groq.com</span> en registreer met je e-mailadres. Geen creditcard nodig.</span>
              </div>
              <div className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[9px] font-black flex items-center justify-center">2</span>
                <span>Klik op <span className="font-black text-white">"API Keys"</span> in het linkermenu → <span className="font-black text-white">"Create API Key"</span> → kopieer de sleutel (begint met <span className="font-mono text-xs bg-slate-800 px-1 rounded">gsk_...</span>)</span>
              </div>
              <div className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[9px] font-black flex items-center justify-center">3</span>
                <span>Ga naar <span className="font-black text-white">vercel.com</span> → jouw project → <span className="font-black text-white">Settings → Environment Variables</span></span>
              </div>
              <div className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[9px] font-black flex items-center justify-center">4</span>
                <span>Voeg toe: Sleutel = <span className="font-mono text-xs bg-slate-800 px-1 rounded">GROQ_API_KEY</span> · Waarde = jouw sleutel → Opslaan</span>
              </div>
              <div className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[9px] font-black flex items-center justify-center">5</span>
                <span>Ga naar <span className="font-black text-white">Deployments → Redeploy</span> → klaar!</span>
              </div>
            </div>
            <div className="text-[9px] text-slate-500 pt-2 border-t border-white/5">
              Groq is volledig gratis · LLaMA 3.3 70B · 500.000 tokens/dag · geen creditcard
            </div>
          </div>
        )}

        {apiStatus === 'ok' && (
          <div className="text-[10px] text-slate-400 leading-relaxed space-y-1">
            <div>LLaMA 3.3 70B genereert automatisch een Nederlandse analyse van 3 zinnen per wedstrijd.</div>
            <div>De analyse bevat: verwachte uitkomst, opvallende statistiek en een concrete wedtip.</div>
            <div>Resultaten worden 24 uur gecached zodat je gratis limiet niet onnodig verbruikt wordt.</div>
          </div>
        )}
      </div>

      {/* Leren */}
      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Automatisch leren</div>
        <div className="space-y-3 text-[11px] text-slate-300 leading-relaxed">
          {[
            { n:'1', c:'green',  t:'Volledig automatisch', d:'GitHub Actions worker draait elke 30 minuten. Je hoeft de site nooit open te hebben.' },
            { n:'2', c:'blue',   t:'Bayesiaans Elo update', d:'Na elke uitslag worden teamsterktes aangepast. Nieuwe teams leren sneller (K=32), gevestigde teams stabieler (K=18).' },
            { n:'3', c:'purple', t:'Blessures bijhouden', d:'Elke 4 uur worden blessurelijsten vernieuwd. Geblesseerde sterspelers verlagen direct de aanvalsverwachting.' },
            { n:'4', c:'amber',  t:'Analyse opslaan', d:'AI analyses worden 24 uur gecached in de browser en accumuleren over tijd zodat het systeem steeds meer context heeft.' },
          ].map(({ n, c, t, d }) => (
            <div key={n} className="flex gap-3">
              <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black
                ${c==='green'?'bg-green-900/40 text-green-400':c==='blue'?'bg-blue-900/40 text-blue-400':c==='purple'?'bg-purple-900/40 text-purple-400':'bg-amber-900/40 text-amber-400'}`}>
                {n}
              </span>
              <div><span className="font-black text-white">{t} — </span><span className="text-slate-400">{d}</span></div>
            </div>
          ))}
        </div>
      </div>

      {/* Cache */}
      <div className="glass-card rounded-2xl border border-white/5 p-5">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-3">Cache beheer</div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-black text-white">App-cache wissen</div>
              <div className="text-[9px] text-slate-500">Verwijdert tijdelijke data, herlaadt wedstrijden</div>
            </div>
            <button onClick={clearCache}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition
                ${cacheCleared?'bg-green-600 text-white':'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
              {cacheCleared?'✓ Gewist':'Cache wissen'}
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
        FootyAI v6 · Dixon-Coles · Bayesiaans Elo · Blessuremodel · Groq LLaMA 3.3 70B
      </div>
    </div>
  );
};

export default SettingsView;
