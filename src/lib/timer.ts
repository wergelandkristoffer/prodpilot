export function pad(n: number): string {
  return String(Math.abs(Math.floor(n))).padStart(2, "0");
}

/** Formats a duration in seconds as m:ss or h:mm:ss */
export function fmt(secondsInput: number): string {
  const s = Math.floor(Math.abs(secondsInput));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export interface TimerLike {
  running: boolean;
  started_at: string | null;
  paused_rem: number;
}

/** Seconds remaining right now, computed locally from startedAt + pausedRem (no server round-trip). */
export function calcRemaining(t: TimerLike): number {
  if (!t.running || !t.started_at) return t.paused_rem;
  const startedAtMs = new Date(t.started_at).getTime();
  return t.paused_rem - (Date.now() - startedAtMs) / 1000;
}

export function fmtClock(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString("no-NO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
