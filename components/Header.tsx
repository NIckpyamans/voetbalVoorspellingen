import React from 'react';

type View = 'dashboard' | 'history' | 'standings' | 'modelops' | 'settings';

interface HeaderProps {
  view?: View;
  currentView?: View;
  onViewChange: (view: View) => void;
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
          {([
            { key: 'dashboard',  label: 'Dashboard', icon: 'fa-home'        },
            { key: 'standings',  label: 'Standen',   icon: 'fa-table'       },
            { key: 'history',    label: 'Geschiedenis', icon: 'fa-history'  },
            { key: 'modelops',   label: 'Model Ops', icon: 'fa-chart-line'  },
          ] as const).map(({ key, label, icon }) => (
            <button key={key}
              onClick={() => onViewChange(key)}
              aria-label={label}
              title={label}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition
                ${activeView === key
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                  : 'text-slate-500 hover:text-white hover:bg-white/5'}`}>
              <i className={`fas ${icon} text-[9px]`}></i>
              {label}
            </button>
          ))}
        </nav>

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
          <i className="fas fa-cog text-[9px]"></i>
          <span className="hidden md:inline">Instellingen</span>
        </button>
      </div>
    </header>
  );
};

export default Header;
