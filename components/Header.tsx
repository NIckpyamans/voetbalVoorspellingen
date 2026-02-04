
import React from 'react';

interface HeaderProps {
  currentView: 'dashboard' | 'history';
  onViewChange: (view: 'dashboard' | 'history') => void;
}

const Header: React.FC<HeaderProps> = ({ currentView, onViewChange }) => {
  return (
    <header className="sticky top-0 z-50 w-full glass-card border-b border-white/10 px-4 md:px-6 py-3 md:py-4 flex justify-between items-center backdrop-blur-xl">
      <div className="flex items-center gap-2 md:gap-3 cursor-pointer" onClick={() => onViewChange('dashboard')}>
        <div className="bg-blue-600 p-1.5 md:p-2 rounded-lg shadow-lg shadow-blue-600/20">
          <i className="fas fa-futbol text-white text-base md:text-xl"></i>
        </div>
        <h1 className="text-lg md:text-2xl font-black tracking-tighter text-white">
          Footy<span className="text-blue-500">AI</span>
        </h1>
      </div>
      
      <div className="flex items-center gap-3">
        <nav className="hidden lg:flex gap-6 items-center font-bold text-[10px] uppercase tracking-widest text-slate-500">
          <button 
            onClick={() => onViewChange('dashboard')}
            className={`hover:text-white transition-colors ${currentView === 'dashboard' ? 'text-white' : ''}`}
          >
            Dashboard
          </button>
          <button 
            className="hover:text-white transition-colors"
            disabled
          >
            Analyse
          </button>
          <button 
            onClick={() => onViewChange('history')}
            className={`hover:text-white transition-colors ${currentView === 'history' ? 'text-white' : ''}`}
          >
            Historie
          </button>
        </nav>
        
        <div className="h-6 w-px bg-white/10 mx-1 hidden md:block"></div>
        
        <button className="bg-blue-600 hover:bg-blue-500 text-white px-3 md:px-5 py-1.5 md:py-2 rounded-xl text-[10px] md:text-xs font-black transition-all shadow-lg shadow-blue-600/20 uppercase">
          Master Pro
        </button>
        
        <button className="lg:hidden text-slate-400 hover:text-white transition-colors p-2">
          <i className="fas fa-bars text-lg"></i>
        </button>
      </div>
    </header>
  );
};

export default Header;
