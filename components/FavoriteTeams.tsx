import React, { useEffect, useState, useMemo } from 'react';
import { Match } from '../types';

const FAVORITES_KEY = 'footypredict_favorites_v1';

export function getFavorites(): string[] {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch { return []; }
}

export function toggleFavorite(teamId: string, teamName: string): boolean {
  const favs = getFavorites();
  const key = teamId || teamName.toLowerCase();
  const idx = favs.indexOf(key);
  if (idx >= 0) { favs.splice(idx, 1); }
  else { favs.push(key); }
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  return idx < 0; // true = toegevoegd
}

export function isFavorite(teamId: string, teamName: string): boolean {
  const favs = getFavorites();
  const key = teamId || teamName.toLowerCase();
  return favs.includes(key);
}

interface FavoriteButtonProps {
  teamId: string;
  teamName: string;
  onChange?: () => void;
}

export const FavoriteButton: React.FC<FavoriteButtonProps> = ({ teamId, teamName, onChange }) => {
  const [active, setActive] = useState(() => isFavorite(teamId, teamName));

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const added = toggleFavorite(teamId, teamName);
    setActive(added);
    onChange?.();
  };

  return (
    <button onClick={toggle} title={active ? 'Verwijder uit favorieten' : 'Voeg toe aan favorieten'}
      className={`w-5 h-5 flex items-center justify-center rounded transition text-[11px]
        ${active ? 'text-yellow-400 hover:text-yellow-300' : 'text-slate-600 hover:text-yellow-400'}`}>
      {active ? '★' : '☆'}
    </button>
  );
};

interface FavoriteSectionProps {
  matches: Match[];
  predictions: Record<string, any>;
  onRefresh: number; // increment to trigger re-render
}

export const FavoriteSection: React.FC<FavoriteSectionProps> = ({ matches, predictions, onRefresh }) => {
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    setFavorites(getFavorites());
  }, [onRefresh]);

  const favMatches = useMemo(() => {
    if (favorites.length === 0) return [];
    return matches.filter(m => {
      const homeKey = m.homeTeamId || m.homeTeamName.toLowerCase();
      const awayKey = m.awayTeamId || m.awayTeamName.toLowerCase();
      return favorites.includes(homeKey) || favorites.includes(awayKey);
    });
  }, [matches, favorites]);

  if (favorites.length === 0 || favMatches.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-yellow-400 text-sm">★</span>
        <span className="text-sm font-black uppercase">Mijn favoriete teams ({favMatches.length})</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {favMatches.map(m => {
          const MatchCardImport = require('./MatchCard').default;
          return <MatchCardImport key={m.id} match={m} prediction={predictions[m.id]} />;
        })}
      </div>
    </section>
  );
};

interface FavoriteManagerProps {
  onClose: () => void;
}

export const FavoriteManager: React.FC<FavoriteManagerProps> = ({ onClose }) => {
  const [favorites, setFavorites] = useState<string[]>(getFavorites());

  const remove = (key: string) => {
    const updated = favorites.filter(f => f !== key);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
    setFavorites(updated);
  };

  return (
    <div className="bg-slate-900/95 border border-white/10 rounded-2xl p-4 shadow-2xl">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-black text-white">Favoriete teams</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none">×</button>
      </div>
      {favorites.length === 0 ? (
        <p className="text-[11px] text-slate-500">Nog geen favorieten. Klik op ☆ bij een team om het toe te voegen.</p>
      ) : (
        <div className="space-y-1.5">
          {favorites.map(key => (
            <div key={key} className="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2">
              <span className="text-[11px] text-white">{key}</span>
              <button onClick={() => remove(key)} className="text-red-400 hover:text-red-300 text-[11px]">verwijder</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
