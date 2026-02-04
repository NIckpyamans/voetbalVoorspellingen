
import { Match } from "../types";
import { fetchMatchesForDate } from "./matchService";

/**
 * MatchSocket: A simulated WebSocket implementation for real-time football data.
 * This mimics a full-duplex connection while managing the AI data pulse.
 */
class MatchSocket {
  public onmessage: ((data: Match[]) => void) | null = null;
  public onopen: (() => void) | null = null;
  public onerror: ((error: any) => void) | null = null;
  public onclose: (() => void) | null = null;

  private pulseInterval: number | null = null;
  private isConnected: boolean = false;

  constructor() {}

  public connect(date: string) {
    if (this.isConnected) return;

    // Simulate connection delay
    setTimeout(() => {
      this.isConnected = true;
      if (this.onopen) this.onopen();
      this.startHeartbeat(date);
    }, 500);
  }

  private async startHeartbeat(date: string) {
    const fetchAndPush = async () => {
      try {
        const controller = new AbortController();
        const rawMatches = await fetchMatchesForDate(date, controller.signal);
        if (this.onmessage) this.onmessage(rawMatches);
      } catch (err) {
        if (this.onerror) this.onerror(err);
      }
    };

    // Immediate first push
    await fetchAndPush();

    // Fast heartbeat (live scores). Keep it reasonable to avoid rate limiting.
    this.pulseInterval = window.setInterval(fetchAndPush, 15000);
  }

  public disconnect() {
    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
      this.pulseInterval = null;
    }
    this.isConnected = false;
    if (this.onclose) this.onclose();
  }

  public get readyState() {
    return this.isConnected ? 'OPEN' : 'CLOSED';
  }
}

/**
 * VelocityEngine: The orchestration layer for real-time streams.
 */
class VelocityEngine {
  private socket: MatchSocket | null = null;
  private subscribers: ((matches: Match[]) => void)[] = [];

  subscribe(callback: (matches: Match[]) => void) {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter(s => s !== callback);
    };
  }

  startPulse(date: string) {
    if (this.socket) {
      this.socket.disconnect();
    }

    this.socket = new MatchSocket();
    
    this.socket.onopen = () => {
      console.log("[Velocity Engine] Socket Connected: Live stream active.");
    };

    this.socket.onmessage = (matches) => {
      this.subscribers.forEach(sub => sub(matches));
    };

    this.socket.onerror = (err) => {
      console.error("[Velocity Engine] Socket Error:", err);
    };

    this.socket.connect(date);
  }

  stopPulse() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getConnectionStatus() {
    return this.socket?.readyState || 'CLOSED';
  }
}

export const velocityEngine = new VelocityEngine();
