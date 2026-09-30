import { useEffect, useMemo, useState } from "react";
import { getLiveMinuteLabel } from "../shared/minute.js";

/**
 * Tickende klok voor live wedstrijden.
 *
 * De worker levert `minute`/`minuteValue` + `liveUpdatedAt`; deze hook telt vanaf
 * `liveUpdatedAt` de verstreken minuten zelf op (via shared/minute.js), zodat elke
 * minuut zichtbaar is zonder dat er per minuut een API-call nodig is.
 *
 * - Tick elke seconde zodra `active` waar is.
 * - Pauzeert automatisch wanneer de tab verborgen is (geen onnodige renders/BG-cycles).
 * - Geeft `null` terug als de wedstrijd niet live is.
 */
export function useLiveClock(active: boolean, match: any, intervalMs = 1000): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, intervalMs]);

  return useMemo(() => {
    if (!active) return null;
    return getLiveMinuteLabel(match, now);
  }, [active, match, now]);
}
