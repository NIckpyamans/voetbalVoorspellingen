// services/velocityEngine.ts
import { Match } from "../types";
import { fetchMatchesAndPredictions, MatchesUpdate } from "./matchService";

class VelocityEngine {
  private interval: number | null = null;
  private subscribers: ((data: MatchesUpdate) => void)[] = [];
  private currentDate: string | null = null;
  private running = false;

  subscribe(cb: (data: MatchesUpdate) => void) {
    this.subscribers.push(cb);
    return () => { this.subscribers = this.subscribers.filter(s => s !== cb); };
  }

  async startPulse(date: string) {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.currentDate = date;
    await this.fetch(date);

    const isToday = date === new Date().toISOString().split('T')[0];
    const ms = isToday ? 90_000 : 300_000;
    this.interval = window.setInterval(async () => {
      if (this.currentDate === date) await this.fetch(date);
    }, ms);
  }

  private async fetch(date: string) {
    if (this.running) return;
    this.running = true;
    try {
      const data = await fetchMatchesAndPredictions(date);
      this.subscribers.forEach(s => s(data));
    } catch (e) {
      console.error('[VelocityEngine]', e);
    } finally {
      this.running = false;
    }
  }

  stopPulse() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.currentDate = null;
  }
}

export const velocityEngine = new VelocityEngine();
