import { Match } from "../types";
import { fetchMatchesForDate } from "./matchService";

class MatchSocket {
  public onmessage: ((data: Match[]) => void) | null = null;
  public onopen: (() => void) | null = null;
  public onerror: ((error: any) => void) | null = null;
  public onclose: (() => void) | null = null;
  private pulseInterval: number | null = null;
  private isConnected: boolean = false;

  public connect(date: string) {
    if (this.isConnected) return;
    setTimeout(() => {
      this.isConnected = true;
      if (this.onopen) this.onopen();
      this.startHeartbeat(date);
    }, 300);
  }

  private async startHeartbeat(date: string) {
    const fetchAndPush = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
        const rawMatches = await fetchMatchesForDate(date, controller.signal);
        clearTimeout(timeout);
        if (this.onmessage) this.onmessage(rawMatches);
      } catch (err: any) {
        if (err?.name !== 'AbortError' && this.onerror) this.onerror(err);
      }
    };

    await fetchAndPush();

    // Live: elke 30 seconden vernieuwen
    const isToday = date === new Date().toISOString().split('T')[0];
    const interval = isToday ? 30000 : 120000; // vandaag: 30s, andere dag: 2min
    this.pulseInterval = window.setInterval(fetchAndPush, interval);
  }

  public disconnect() {
    if (this.pulseInterval) { clearInterval(this.pulseInterval); this.pulseInterval = null; }
    this.isConnected = false;
    if (this.onclose) this.onclose();
  }

  public get readyState() { return this.isConnected ? 'OPEN' : 'CLOSED'; }
}

class VelocityEngine {
  private socket: MatchSocket | null = null;
  private subscribers: ((matches: Match[]) => void)[] = [];

  subscribe(callback: (matches: Match[]) => void) {
    this.subscribers.push(callback);
    return () => { this.subscribers = this.subscribers.filter(s => s !== callback); };
  }

  startPulse(date: string) {
    if (this.socket) this.socket.disconnect();
    this.socket = new MatchSocket();
    this.socket.onopen = () => console.log("[VelocityEngine] verbonden");
    this.socket.onmessage = (matches) => this.subscribers.forEach(sub => sub(matches));
    this.socket.onerror = (err) => console.error("[VelocityEngine] fout:", err);
    this.socket.connect(date);
  }

  stopPulse() {
    if (this.socket) { this.socket.disconnect(); this.socket = null; }
  }

  getConnectionStatus() { return this.socket?.readyState || 'CLOSED'; }
}

export const velocityEngine = new VelocityEngine();
