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

/** Formaterer en VARIGHET (ikke en nedtelling/klokke) som "15 min og 20
 * sekunder", eller bare "1 min"/"45 sekunder" når den andre delen er 0 —
 * brukt der appen viser hvor LANGT et punkt er (neste-hint, programoversikt,
 * visningsskjermens kommende-punkter), til forskjell fra `fmt()` sitt
 * mm:ss-format som brukes til faktiske nedtellinger/klokker. */
export function fmtDuration(secondsInput: number): string {
  const s = Math.max(0, Math.round(secondsInput));
  const min = Math.floor(s / 60);
  const sec = s % 60;
  const secLabel = `${sec} sekund${sec === 1 ? "" : "er"}`;
  if (min === 0) return secLabel;
  if (sec === 0) return `${min} min`;
  return `${min} min og ${secLabel}`;
}

export function fmtClock(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString("no-NO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
