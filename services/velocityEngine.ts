import { fetchMatchesAndPredictions, MatchesUpdate } from "./matchService";
import { todayAmsterdamKey } from "../shared/date.js";
import type { Match } from "../types";

function hasLiveMatch(matches: Match[] | undefined): boolean {
  if (!matches?.length) return false;
  return matches.some((match) => {
    const status = String(match?.status || "").toUpperCase();
    return status === "LIVE" || status === "HT" || Boolean(match?.minuteValue);
  });
}

class VelocityEngine {
  private interval: number | null = null;
  private subscribers: ((data: MatchesUpdate) => void)[] = [];
  private currentDate: string | null = null;
  private running = false;
  private lastPayload: MatchesUpdate | null = null;

  subscribe(cb: (data: MatchesUpdate) => void) {
    this.subscribers.push(cb);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== cb);
    };
  }

  async startPulse(date: string) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.currentDate = date;
    await this.fetch(date);

    const isToday = date === todayAmsterdamKey();
    const baseIntervalMs = isToday ? 30_000 : 300_000;

    const scheduleNext = (ms: number) => {
      if (this.interval) {
        clearInterval(this.interval);
      }
      this.interval = window.setInterval(async () => {
        if (this.currentDate === date) {
          await this.fetch(date);
        }
      }, ms);
    };

    scheduleNext(baseIntervalMs);

    // Live-versnelling: zodra er live wedstrijden op de dag staan, halen we de
    // data sneller op (15 s) zodat de klok en scores actueel blijven; nog actiever
    // zodra de kaart zelf live is en de bron wél al een minuut doorgeeft.
    const liveIntervalMs = 15_000;
    this.quickCheckTimer = window.setInterval(() => {
      if (this.currentDate !== date) return;
      const matches = this.lastPayload?.matches as Match[] | undefined;
      scheduleNext(hasLiveMatch(matches) ? liveIntervalMs : baseIntervalMs);
    }, 10_000);
  }

  private quickCheckTimer: number | null = null;

  private async fetch(date: string) {
    if (this.running) return;
    this.running = true;

    try {
      const data = await fetchMatchesAndPredictions(date);
      this.lastPayload = data;
      this.subscribers.forEach((s) => s(data));
    } catch (err) {
      console.error("[VelocityEngine]", err);
    } finally {
      this.running = false;
    }
  }

  stopPulse() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.quickCheckTimer) {
      clearInterval(this.quickCheckTimer);
      this.quickCheckTimer = null;
    }
    this.currentDate = null;
    this.lastPayload = null;
  }
}

export const velocityEngine = new VelocityEngine();
