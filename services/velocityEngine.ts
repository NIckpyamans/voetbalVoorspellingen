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

export class VelocityEngine {
  private interval: number | null = null;
  private activeIntervalMs: number | null = null;
  private subscribers: ((data: MatchesUpdate) => void)[] = [];
  private currentDate: string | null = null;
  private runningDates = new Set<string>();
  private pulseGeneration = 0;
  private lastPayload: MatchesUpdate | null = null;

  subscribe(cb: (data: MatchesUpdate) => void) {
    this.subscribers.push(cb);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== cb);
    };
  }

  async startPulse(date: string) {
    const generation = ++this.pulseGeneration;
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.quickCheckTimer !== null) {
      clearInterval(this.quickCheckTimer);
      this.quickCheckTimer = null;
    }
    this.activeIntervalMs = null;

    this.currentDate = date;
    await this.fetch(date);
    if (generation !== this.pulseGeneration) return;

    const isToday = date === todayAmsterdamKey();
    const baseIntervalMs = isToday ? 30_000 : 300_000;

    const scheduleNext = (ms: number) => {
      if (this.activeIntervalMs === ms && this.interval !== null) return;
      if (this.interval !== null) {
        clearInterval(this.interval);
      }
      this.activeIntervalMs = ms;
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
    if (this.runningDates.has(date)) return;
    this.runningDates.add(date);

    try {
      const data = await fetchMatchesAndPredictions(date);
      if (this.currentDate !== date) return;
      this.lastPayload = data;
      this.subscribers.forEach((s) => s(data));
    } catch (err) {
      console.error("[VelocityEngine]", err);
    } finally {
      this.runningDates.delete(date);
    }
  }

  stopPulse() {
    this.pulseGeneration += 1;
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.activeIntervalMs = null;
    if (this.quickCheckTimer !== null) {
      clearInterval(this.quickCheckTimer);
      this.quickCheckTimer = null;
    }
    this.currentDate = null;
    this.lastPayload = null;
  }
}

export const velocityEngine = new VelocityEngine();
