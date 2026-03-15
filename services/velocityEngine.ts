// services/velocityEngine.ts — geoptimaliseerd voor snelheid

import { Match } from "../types";
import { fetchMatchesAndPredictions } from "./matchService";

export interface MatchesUpdate {
  matches: Match[];
  predictions: Record<string, any>;
  lastRun: number | null;
}

class VelocityEngine {
  private interval: number | null = null;
  private subscribers: ((data: MatchesUpdate) => void)[] = [];
  private currentDate: string | null = null;
  private isRunning = false;

  subscribe(cb: (data: MatchesUpdate) => void) {
    this.subscribers.push(cb);
    return () => { this.subscribers = this.subscribers.filter(s => s !== cb); };
  }

  async startPulse(date: string) {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.currentDate = date;

    // Direct eerste fetch
    await this.fetch(date);

    // Vandaag: vernieuwen elke 90 seconden (live scores)
    // Andere dag: elke 5 minuten
    const isToday = date === new Date().toISOString().split('T')[0];
    const intervalMs = isToday ? 90_000 : 300_000;

    this.interval = window.setInterval(async () => {
      if (this.currentDate === date) await this.fetch(date);
    }, intervalMs);
  }

  private async fetch(date: string) {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const data = await fetchMatchesAndPredictions(date);
      this.subscribers.forEach(s => s(data));
    } catch (e) {
      console.error('[VelocityEngine]', e);
    } finally {
      this.isRunning = false;
    }
  }

  stopPulse() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.currentDate = null;
  }
}

export const velocityEngine = new VelocityEngine();
