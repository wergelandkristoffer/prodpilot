"use client";

import { useEffect, useRef, useState } from "react";
import { calcRemaining, TimerLike } from "@/lib/timer";

/**
 * Regner ut sekunder igjen lokalt (ingen server-roundtrip), oppdatert via
 * requestAnimationFrame mens timeren kjører. Alle tre visninger (kontroll,
 * display, fjernkontroll) bruker denne til å tegne den samme "sannheten"
 * som ligger i `startedAt` + `pausedRem` på sesjonen.
 */
export function useLiveRemaining(timer: TimerLike): number {
  const [rem, setRem] = useState(() => calcRemaining(timer));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setRem(calcRemaining(timer));
    if (!timer.running) return;

    const loop = () => {
      setRem(calcRemaining(timer));
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer.running, timer.started_at, timer.paused_rem]);

  return rem;
}
