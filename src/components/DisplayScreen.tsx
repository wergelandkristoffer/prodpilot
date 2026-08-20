"use client";

import { useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AgendaItemRow, SessionRow } from "@/lib/types";
import { fmt, fmtClock } from "@/lib/timer";
import { useLiveRemaining } from "@/hooks/useLiveRemaining";
import SupabaseSetupNotice from "@/components/SupabaseSetupNotice";

const BG_THEMES: Record<SessionRow["bg"], string> = {
  dark: "bg-[#050505]",
  yellow: "bg-[#3a1f00]",
  red: "bg-[#3a0505]",
  green: "bg-[#04250f]",
};

export default function DisplayScreen({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionRow | null>(null);
  const [agenda, setAgenda] = useState<AgendaItemRow[]>([]);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: s } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", sessionId)
        .maybeSingle();
      if (cancelled) return;
      if (!s) {
        setNotFound(true);
        return;
      }
      setSession(s as SessionRow);
      const { data: items } = await supabase
        .from("agenda_items")
        .select("*")
        .eq("session_id", sessionId)
        .order("position");
      if (!cancelled && items) {
        setAgenda((items as AgendaItemRow[]).filter((it) => !!it && !!it.id));
      }
    }
    load();

    const channel = supabase
      .channel(`display-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` },
        (payload) => {
          if (payload.eventType !== "DELETE") setSession(payload.new as SessionRow);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agenda_items", filter: `session_id=eq.${sessionId}` },
        async () => {
          const { data } = await supabase
            .from("agenda_items")
            .select("*")
            .eq("session_id", sessionId)
            .order("position");
          if (data) setAgenda((data as AgendaItemRow[]).filter((it) => !!it && !!it.id));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const rem = useLiveRemaining(
    session ?? { running: false, started_at: null, paused_rem: 0 }
  );

  // Ren "tikker" som tvinger statusen til å regnes ut på nytt hvert sekund
  // uansett — også mens man står i PAUSE. Uten denne fryser status idet
  // du trykker pause (fordi rem, som liveStatus ellers er avhengig av,
  // slutter å oppdatere seg selv når timeren ikke går), selv om avviket
  // mot planen fortsetter å vokse for hvert sekund du står i pause.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const rawActiveIdx = session?.active_idx ?? -1;
  const activeIdx = rawActiveIdx >= 0 && rawActiveIdx < agenda.length ? rawActiveIdx : -1;

  const scheduledTimes = useMemo(() => {
    if (!session) return agenda.map(() => null as number | null);
    const base = session.program_scheduled_ms || session.program_start_ms;
    if (!base) return agenda.map(() => null as number | null);
    let offsetMs = 0;
    return agenda.map((item) => {
      if (item.is_section) return null;
      const start = base + offsetMs;
      offsetMs += item.duration_secs * 1000;
      return start;
    });
  }, [agenda, session]);

  const upcoming = useMemo(() => {
    const out: { item: AgendaItemRow; clock: string; plannedMs: number | null }[] = [];
    for (let i = activeIdx + 1; i < agenda.length && out.length < 3; i++) {
      if (!agenda[i].is_section)
        out.push({ item: agenda[i], clock: fmtClock(scheduledTimes[i]), plannedMs: scheduledTimes[i] });
    }
    return out;
  }, [agenda, activeIdx, scheduledTimes]);

  // Samme formel som kontrollpanelet (se kommentar der): fast klokke-anker
  // (planlagt starttid, ellers auto-satt starttid), ekte sanntids-tikking,
  // ingen kunstig hopping.
  const liveStatus = useMemo(() => {
    if (!session) return 0;
    if (activeIdx < 0 || agenda[activeIdx]?.is_section) return 0;
    const anchorMs = session.program_scheduled_ms || session.program_start_ms;
    if (!anchorMs) return rem < 0 ? Math.abs(rem) : 0;
    const scheduledItemStartMs = anchorMs + session.scheduled_offset_secs * 1000;
    const secondsPast = (Date.now() - scheduledItemStartMs) / 1000;
    const currentElapsed = session.total_secs - Math.max(0, rem);
    return secondsPast - currentElapsed;
  }, [session, activeIdx, agenda, rem, nowTick]);

  if (!isSupabaseConfigured) {
    return <SupabaseSetupNotice />;
  }
  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-[#555] text-sm">
        Fant ingen slik visning.
      </div>
    );
  }
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-[#555] text-sm">
        Kobler til…
      </div>
    );
  }

  const isOvertime = rem < 0;
  // Math.abs (ikke Math.max(0, rem)) — sistnevnte klemte tallet fast på 0
  // gjennom HELE overtiden, så det så ut som klokka hadde stoppet i stedet
  // for å telle oppover.
  const absRem = Math.abs(rem);
  const hasActive = activeIdx >= 0 && !agenda[activeIdx]?.is_section;
  const absStatus = Math.abs(liveStatus);

  return (
    <div
      className={`min-h-screen w-full overflow-x-hidden ${BG_THEMES[session.bg]} text-white flex flex-col items-center justify-center gap-8 px-6 sm:px-10 relative transition-colors duration-500 ${
        session.message ? "pt-12 pb-40" : "py-12"
      }`}
    >
      {session.logo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={session.logo_url}
          alt="Logo"
          className="absolute top-8 left-1/2 -translate-x-1/2 max-h-16 max-w-[220px] object-contain"
        />
      )}

      {session.active_section && (
        <div className="text-lg md:text-2xl uppercase tracking-[0.25em] text-white/40">
          {session.active_section}
        </div>
      )}

      <div className="text-3xl md:text-5xl font-semibold text-center">
        {hasActive ? session.active_label : "Venter på start…"}
      </div>

      <div
        className={`font-bold tabular-nums leading-none text-[18vw] md:text-[220px] ${
          isOvertime ? "text-[#f87171]" : absRem <= 60 && hasActive ? "text-[#fde68a]" : "text-white"
        }`}
        // `active_color` skal KUN style tallet mens vi er innenfor tiden —
        // den inline-fargen overstyrte tidligere alltid overtid-rødt, siden
        // en active_color alltid er satt mens punktet fortsatt er aktivt.
        style={{ color: hasActive && !isOvertime ? session.active_color : undefined }}
      >
        {hasActive ? (isOvertime ? "+" : "") + fmt(absRem) : "--:--"}
      </div>

      {hasActive && (
        <div
          className={`text-lg md:text-2xl font-semibold px-6 py-2 rounded-full border ${
            absStatus < 2
              ? "border-white/20 text-white/50"
              : liveStatus > 0
              ? "border-[#fca5a5]/50 text-[#fca5a5] bg-[#2a0a0a]/60"
              : "border-[#4ade80]/50 text-[#4ade80] bg-[#0a1f0a]/60"
          }`}
        >
          {absStatus < 2 ? "0:00" : (liveStatus > 0 ? "+" : "-") + fmt(absStatus)}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="flex flex-col items-center gap-3 mt-4 w-full">
          <span className="text-[10px] uppercase tracking-widest text-white/40">
            Neste på programmet
          </span>

          {/* MOBIL: vertikal liste (samme mønster som "Programoversikt" i
              fjernkontrollen) i stedet for tre kolonner som overlapper
              hverandre på smale skjermer. */}
          <div className="flex md:hidden flex-col gap-2 w-full max-w-sm px-2">
            {upcoming.map(({ item, clock, plannedMs }, i) => {
              const driftSecs = hasActive ? liveStatus : 0;
              const newMs = plannedMs != null ? plannedMs + driftSecs * 1000 : null;
              const newClock = newMs != null ? fmtClock(newMs) : "";
              const showNewClock = !!clock && !!newClock && newClock !== clock;
              const isLate = driftSecs > 0;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 opacity-80"
                >
                  <span className="text-[10px] text-white/40 font-mono w-3 flex-shrink-0 text-center">
                    {i + 1}
                  </span>
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: item.color }}
                  />
                  <span className="text-sm font-medium truncate flex-1 min-w-0">{item.name}</span>
                  <span className="flex flex-col items-end gap-0.5 flex-shrink-0">
                    {clock && (
                      <span className="text-[10px] text-white/40 font-mono">Kl. {clock}</span>
                    )}
                    {showNewClock && (
                      <span
                        className={`text-[10px] font-mono rounded px-1 ${
                          isLate ? "text-[#f87171]" : "text-[#4ade80]"
                        }`}
                      >
                        <span className="font-normal opacity-80">Ny tid </span>
                        <span className="font-bold">{newClock}</span>
                      </span>
                    )}
                    <span className="text-[9px] text-white/30 font-mono">{fmt(item.duration_secs)}</span>
                  </span>
                </div>
              );
            })}
          </div>

          {/* DESKTOP: CSS Grid med tre LIKE brede kolonner (ikke flex) — slik
              havner midtre punkt alltid midt på skjermen, uansett hvor lang
              tekst nabo-punktene har. Ubrukte kolonner (færre enn 3 kommende
              punkter) står bare tomme. Tid/Ny tid står nå OVER navnet, og
              varigheten UNDER — i stedet for at alt lå under navnet. */}
          <div className="hidden md:grid grid-cols-3 gap-4 md:gap-8 w-full max-w-4xl">
            {[0, 1, 2].map((i) => {
              const entry = upcoming[i];
              if (!entry) return <div key={i} />;
              const { item, clock, plannedMs } = entry;
              // "Ny tid" justerer det opprinnelig planlagte tidspunktet med
              // nøyaktig samme avvik som Status-pillen viser akkurat nå —
              // altså hvor punktet faktisk ser ut til å starte hvis avviket
              // holder seg. "Kl." er alltid den opprinnelige planen, uendret.
              const driftSecs = hasActive ? liveStatus : 0;
              const newMs = plannedMs != null ? plannedMs + driftSecs * 1000 : null;
              const newClock = newMs != null ? fmtClock(newMs) : "";
              const showNewClock = !!clock && !!newClock && newClock !== clock;
              // Rødt når "Ny tid" er SENERE enn planen (forsinket), grønt
              // når vi er på eller foran planen.
              const isLate = driftSecs > 0;
              return (
                <div key={item.id} className="flex flex-col items-center gap-1 opacity-70">
                  <span className="text-[10px] text-white/40 font-mono">{i + 1}</span>
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: item.color }}
                  />
                  {clock && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs md:text-sm text-white/40 font-mono">Kl. {clock}</span>
                      {showNewClock && (
                        <span
                          className={`text-[10px] md:text-xs font-mono rounded px-1.5 py-0.5 border ${
                            isLate
                              ? "text-[#f87171] bg-[#2a0a0a] border-[#4a1515]"
                              : "text-[#4ade80] bg-[#0a1f0a] border-[#1a4a2a]"
                          }`}
                        >
                          <span className="font-normal opacity-80">Ny tid </span>
                          <span className="font-bold">{newClock}</span>
                        </span>
                      )}
                    </div>
                  )}
                  <span className="text-base md:text-xl font-medium text-center max-w-[220px] truncate">
                    {item.name}
                  </span>
                  <span className="text-[10px] md:text-xs text-white/40 font-mono">
                    {fmt(item.duration_secs)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {session.message && (
        <div className="fixed bottom-14 left-1/2 -translate-x-1/2 bg-[#fde68a] text-[#3a2a00] font-semibold text-lg md:text-2xl px-8 py-5 rounded-full shadow-2xl max-w-[80vw] text-center">
          {session.message}
        </div>
      )}
    </div>
  );
}
