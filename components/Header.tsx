import React from 'react';

type View = 'dashboard' | 'history' | 'standings' | 'settings';

interface HeaderProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

const Header: React.FC<HeaderProps> = ({ currentView, onViewChange }) => {
  return (
    <header className="sticky top-0 z-50 w-full glass-card border-b border-white/10 px-4 md:px-6 py-3 flex justify-between items-center backdrop-blur-xl">
      {/* Logo */}
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => onViewChange('dashboard')}>
        <div className="bg-blue-600 p-1.5 rounded-lg shadow-lg shadow-blue-600/20">
          <i className="fas fa-futbol text-white text-base"></i>
        </div>
        <h1 className="text-lg font-black tracking-tighter text-white">
          Footy<span className="text-blue-500">AI</span>
        </h1>
      </div>

      {/* Nav */}
      <div className="flex items-center gap-2">
        <nav className="hidden lg:flex gap-1 items-center">
          {([
            { key: 'dashboard',  label: 'Dashboard', icon: 'fa-home'        },
            { key: 'standings',  label: 'Standen',   icon: 'fa-table'       },
            { key: 'history',    label: 'Geschiedenis', icon: 'fa-history'  },
          ] as const).map(({ key, label, icon }) => (
            <button key={key}
              onClick={() => onViewChange(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition
                ${currentView === key
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
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition
            ${currentView === 'settings'
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
