import React from 'react';

type View = 'dashboard' | 'knowledge' | 'history' | 'standings' | 'modelops' | 'integrity' | 'providers' | 'settings';

interface HeaderProps {
  view?: View;
  currentView?: View;
  onViewChange: (view: View) => void;
}

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'fa-home' },
  { key: 'knowledge', label: 'Vraag FootyAI', icon: 'fa-search' },
  { key: 'standings', label: 'Standen', icon: 'fa-table' },
  { key: 'history', label: 'Geschiedenis', icon: 'fa-history' },
  { key: 'modelops', label: 'Model Ops', icon: 'fa-chart-line' },
  { key: 'integrity', label: 'Integriteit', icon: 'fa-shield-alt' },
  { key: 'providers', label: 'Providers', icon: 'fa-plug' },
] as const;

// Inline SVG-iconen vervangen Font Awesome (CDN-CSS voor 4 iconen was overkill):
// sneller, geen third-party request, strengere CSP mogelijk.
const ICON_PATHS: Record<string, string> = {
  'fa-home': 'M3 10.5L12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5',
  'fa-search': 'M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z',
  'fa-table': 'M3 5h18v14H3zM3 10h18M9 5v14M15 5v14',
  'fa-history': 'M12 8v5l3 3M3 12a9 9 0 109-9 9 9 0 00-7.5 4M3 3v4h4',
  'fa-chart-line': 'M3 17l6-6 4 4 8-8M15 7h6v6',
  'fa-shield-alt': 'M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z',
  'fa-plug': 'M9 3v5M15 3v5M7 8h10v3a5 5 0 01-10 0zM12 16v5',
  'fa-cog': 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.08a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h.08a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.08a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z',
  'fa-bullseye': 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z',
};

function NavIcon({ icon }: { icon: string }) {
  const path = ICON_PATHS[icon];
  if (!path) return null;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const Header: React.FC<HeaderProps> = ({ view, currentView, onViewChange }) => {
  const activeView = view || currentView;

  return (
    <header className="sticky top-0 z-50 w-full glass-card border-b border-white/10 px-4 md:px-6 py-3 flex justify-between items-center backdrop-blur-xl">
      {/* Logo */}
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => onViewChange('dashboard')}>
        <div className="h-9 w-9 overflow-hidden rounded-xl border border-cyan-300/30 bg-slate-950 shadow-lg shadow-cyan-500/20">
          <img src="/footyai-ball-logo.jpeg" alt="FootyAI 3D-bal logo" className="h-full w-full object-cover" />
        </div>
        <h1 className="text-lg font-black tracking-tight text-white">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-rose-400 to-cyan-300">
            Voetbal
          </span>
          <span className="text-slate-300">-</span>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-blue-400 to-rose-400">
            Ai
          </span>
          <span className="text-slate-300">-</span>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-400 via-orange-300 to-cyan-300">
            tactics
          </span>
        </h1>
      </div>

      {/* Nav */}
      <div className="flex items-center gap-2">
        <nav className="hidden lg:flex gap-1 items-center">
          {NAV_ITEMS.map(({ key, label, icon }) => (
            <button key={key}
              onClick={() => onViewChange(key)}
              aria-label={label}
              title={label}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition
                ${activeView === key
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                  : 'text-slate-500 hover:text-white hover:bg-white/5'}`}>
              <NavIcon icon={icon} />
              {label}
            </button>
          ))}
        </nav>
        <button
          onClick={() => onViewChange('knowledge')}
          aria-label="Vraag FootyAI"
          className={`lg:hidden rounded-lg border px-2.5 py-1.5 text-[10px] font-black uppercase ${
            activeView === 'knowledge' ? 'border-cyan-400/40 bg-cyan-500/20 text-cyan-200' : 'border-white/10 bg-white/5 text-slate-300'
          }`}>
          <NavIcon icon="fa-search" />
        </button>
        <select
          aria-label="Mobiele navigatie"
          value={activeView || 'dashboard'}
          onChange={(event) => onViewChange(event.target.value as View)}
          className="max-w-28 rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-[10px] font-bold text-slate-200 lg:hidden">
          {NAV_ITEMS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          <option value="settings">Instellingen</option>
        </select>

        <div className="h-5 w-px bg-white/10 mx-1 hidden lg:block" />

        {/* Instellingen knop */}
        <button
          onClick={() => onViewChange('settings')}
          aria-label="Instellingen"
          title="Instellingen"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition
            ${activeView === 'settings'
              ? 'bg-slate-600/40 text-white border border-white/20'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
          <NavIcon icon="fa-cog" />
          <span className="hidden md:inline">Instellingen</span>
        </button>
      </div>
    </header>
  );
};

export default Header;
