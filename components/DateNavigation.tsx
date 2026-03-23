// ============================================================================
// DATE NAVIGATION COMPONENT
// Voor navigatie tussen dagen (gisteren, vandaag, morgen)
// ============================================================================

import React from "react";

interface DateNavigationProps {
  selectedDate: string; // ISO format: "2025-03-23"
  onDateChange: (date: string) => void;
}

function isoDate(date: Date) {
  return date.toISOString().split("T")[0];
}

function formatDateLabel(dateISO: string) {
  const date = new Date(`${dateISO}T12:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (checkDate.getTime() === today.getTime()) {
    return "Vandaag";
  } else if (checkDate.getTime() === yesterday.getTime()) {
    return "Gisteren";
  } else if (checkDate.getTime() === tomorrow.getTime()) {
    return "Morgen";
  } else {
    return date.toLocaleDateString("nl-NL", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }
}

const DateNavigation: React.FC<DateNavigationProps> = ({ selectedDate, onDateChange }) => {
  const today = isoDate(new Date());
  const isToday = selectedDate === today;

  const goToPreviousDay = () => {
    const currentDate = new Date(`${selectedDate}T12:00:00`);
    currentDate.setDate(currentDate.getDate() - 1);
    onDateChange(isoDate(currentDate));
  };

  const goToNextDay = () => {
    const currentDate = new Date(`${selectedDate}T12:00:00`);
    currentDate.setDate(currentDate.getDate() + 1);
    onDateChange(isoDate(currentDate));
  };

  const goToToday = () => {
    onDateChange(today);
  };

  return (
    <div className="glass-card rounded-2xl p-4 mb-4 border border-white/5">
      <div className="flex items-center justify-between gap-4">
        {/* Previous Day Button */}
        <button
          onClick={goToPreviousDay}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-xl transition-all text-sm font-medium group"
        >
          <span className="text-lg group-hover:translate-x-[-2px] transition-transform">←</span>
          <span className="hidden sm:inline">Vorige dag</span>
        </button>

        {/* Current Date Display */}
        <div className="flex-1 flex flex-col items-center gap-1">
          <div className="text-xl sm:text-2xl font-black text-white">
            {formatDateLabel(selectedDate)}
          </div>
          <div className="text-xs text-slate-400">
            {new Date(`${selectedDate}T12:00:00`).toLocaleDateString("nl-NL", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </div>
          
          {/* Quick "Today" button */}
          {!isToday && (
            <button
              onClick={goToToday}
              className="mt-2 px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 rounded-lg text-xs font-medium transition-all"
            >
              → Vandaag
            </button>
          )}
        </div>

        {/* Next Day Button */}
        <button
          onClick={goToNextDay}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-xl transition-all text-sm font-medium group"
        >
          <span className="hidden sm:inline">Volgende dag</span>
          <span className="text-lg group-hover:translate-x-[2px] transition-transform">→</span>
        </button>
      </div>

      {/* Mobile: Swipe indicator */}
      <div className="sm:hidden mt-3 flex items-center justify-center gap-2 text-[10px] text-slate-500">
        <span>← Swipe →</span>
      </div>
    </div>
  );
};

export default DateNavigation;
