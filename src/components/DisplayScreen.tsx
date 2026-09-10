"use client";

import { useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AgendaItemRow, SessionRow } from "@/lib/types";
import { fmt, fmtClock, fmtDuration } from "@/lib/timer";
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

  // Henter ALLE gjenværende punkter (ikke bare de 3 første) — listen viser
  // uansett kun ca. 3 rader om gangen (fast makshøyde, se rendering under),
  // men man skal kunne bla videre nedover for å se resten.
  const upcoming = useMemo(() => {
    const out: { item: AgendaItemRow; clock: string; plannedMs: number | null }[] = [];
    for (let i = activeIdx + 1; i < agenda.length; i++) {
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
      <div className="min-h-screen flex items-center justify-center bg-black text-[#8a8a8a] text-sm">
        Fant ingen slik visning.
      </div>
    );
  }
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-[#8a8a8a] text-sm">
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
    // `h-dvh` + en egen, IKKE fast-posisjonert meldingsrad nederst i stedet
    // for `min-h-screen` + `position: fixed` — meldingen fikk tidligere sin
    // plass reservert med padding, men en fast-posisjonert boks tar ikke
    // hensyn til det faktiske innholdets høyde (særlig den nye mobil-listen
    // for kommende punkter), så den kunne fortsatt havne OPPÅ innhold i
    // stedet for under det. Nå er meldingen en ordentlig, plasskrevende rad
    // i selve layouten, som alltid får sin egen plass — hovedinnholdet over
    // scroller internt (`overflow-y-auto`) hvis det ikke er nok plass igjen.
    <div
      className={`h-dvh w-full overflow-hidden ${BG_THEMES[session.bg]} text-white flex flex-col relative transition-colors duration-500`}
    >
      {session.logo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={session.logo_url}
          alt="Logo"
          className="absolute top-8 left-1/2 -translate-x-1/2 max-h-16 max-w-[220px] object-contain"
        />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-8 px-6 sm:px-10 py-12">
      {session.active_section && (
        <div className="text-lg md:text-2xl uppercase tracking-[0.25em] text-white/40">
          {session.active_section}
        </div>
      )}

      <div className="text-3xl md:text-5xl font-semibold text-center">
        {hasActive ? session.active_label : "Venter på start…"}
      </div>

      {/* Farges ALDRI etter punktets/bolkens egen farge lenger — kun hvit
          (normalt) og rødt (overtid), som resten av tidtakerne i appen. */}
      <div
        className={`font-bold tabular-nums leading-none text-[18vw] md:text-[220px] ${
          isOvertime ? "text-[#f87171]" : "text-white"
        }`}
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

          {/* Én og samme stablede, vertikale liste på alle skjermstørrelser
              nå — samme mønster som "Programoversikt" i fjernkontrollen/
              kontrollpanelet, i stedet for den tidligere tre-kolonners
              rutenett-varianten på desktop. Boksen har en FAST makshøyde
              tilsvarende ca. 3 rader (`h-16`/`gap-2.5` under, matchet i
              maks-høyden) — flere enn 3 kommende punkter blir dermed
              tilgjengelige ved å bla NEDOVER inni boksen selv
              (`overflow-y-auto`), i stedet for at alt vises på én gang.
              Ren visning — ingen klikk her, kun på selve kontrollpanelet. */}
          <div
            className="flex flex-col gap-2.5 w-full max-w-sm md:max-w-lg px-2 overflow-y-auto"
            style={{ maxHeight: "calc(3 * 4rem + 2 * 0.625rem)" }}
          >
            {upcoming.map(({ item, clock, plannedMs }, i) => {
              const driftSecs = hasActive ? liveStatus : 0;
              const newMs = plannedMs != null ? plannedMs + driftSecs * 1000 : null;
              const newClock = newMs != null ? fmtClock(newMs) : "";
              const showNewClock = !!clock && !!newClock && newClock !== clock;
              const isLate = driftSecs > 0;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 h-16 flex-shrink-0 opacity-80"
                >
                  <span className="text-xs md:text-sm text-white/40 font-mono w-4 flex-shrink-0 text-center">
                    {i + 1}
                  </span>
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: item.color }}
                  />
                  <span className="text-sm md:text-lg font-medium truncate flex-1 min-w-0">{item.name}</span>
                  <span className="flex flex-col items-end gap-0.5 flex-shrink-0">
                    {clock && (
                      <span className="text-[10px] md:text-xs text-white/40 font-mono">Kl. {clock}</span>
                    )}
                    {showNewClock && (
                      <span
                        className={`text-[10px] md:text-xs font-mono rounded px-1 ${
                          isLate ? "text-[#f87171]" : "text-[#4ade80]"
                        }`}
                      >
                        <span className="font-normal opacity-80">Ny tid </span>
                        <span className="font-bold">{newClock}</span>
                      </span>
                    )}
                    <span className="text-[9px] md:text-[10px] text-white/30 font-mono">
                      {fmtDuration(item.duration_secs)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>

      {/* Meldingen er nå en egen rad i selve layouten (ikke lenger
          `position: fixed`) — den får dermed alltid sin egen plass i stedet
          for å kunne havne oppå innholdet over. Gjort tydelig større/mer
          lesbar (mer luft, større skrift) enn før — den var fortsatt litt
          lav/beskjeden til å bli sett fra avstand. */}
      {session.message && (
        <div className="flex-shrink-0 flex items-center justify-center px-6 pb-8 pt-3 sm:px-10">
          <div className="bg-[#fde68a] text-[#3a2a00] font-semibold text-xl md:text-4xl px-8 md:px-12 py-4 md:py-7 rounded-full shadow-2xl max-w-[90vw] text-center">
            {session.message}
          </div>
        </div>
      )}
    </div>
  );
}
