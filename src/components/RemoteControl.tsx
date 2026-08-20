"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AgendaItemRow, SessionRow } from "@/lib/types";
import { fmt, fmtClock, fmtDuration, calcRemaining } from "@/lib/timer";
import { useLiveRemaining } from "@/hooks/useLiveRemaining";
import SupabaseSetupNotice from "@/components/SupabaseSetupNotice";

function PauseIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className="inline-block"
      aria-hidden="true"
    >
      <rect x="5" y="3" width="5" height="18" rx="1.5" />
      <rect x="14" y="3" width="5" height="18" rx="1.5" />
    </svg>
  );
}

function PlayIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className="inline-block"
      aria-hidden="true"
    >
      <path d="M6 3.5c0-1.05 1.15-1.7 2.05-1.15l12.4 7.5c.87.52.87 1.78 0 2.3l-12.4 7.5C7.15 20.2 6 19.55 6 18.5V3.5Z" />
    </svg>
  );
}

/** Enkel hengelås — brukes til å låse/åpne opp for at man kan trykke på
 * punktene i programoversikten, slik at man ikke hopper til feil punkt ved et
 * uhell. Bevisst SVG (ikke emoji), som resten av ikonsettet i appen. */
function LockIcon({ locked, size = 12 }: { locked: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="9" rx="2" />
      {locked ? (
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      ) : (
        <path d="M8 11V7a4 4 0 0 1 7.5-2" />
      )}
    </svg>
  );
}

export default function RemoteControl({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionRow | null>(null);
  const [agenda, setAgenda] = useState<AgendaItemRow[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [msgInput, setMsgInput] = useState("");
  const [msgPopupOpen, setMsgPopupOpen] = useState(false);
  // Låst som standard — hindrer at man hopper til feil punkt i programmet
  // ved et uhellstrykk. Må aktivt låses opp for å kunne trykke seg til et punkt.
  const [itemsLocked, setItemsLocked] = useState(true);

  const fetchAgenda = useCallback(async () => {
    const { data } = await supabase
      .from("agenda_items")
      .select("*")
      .eq("session_id", sessionId)
      .order("position");
    if (data) {
      setAgenda(
        (data as AgendaItemRow[]).filter((it) => !!it && !!it.id)
      );
    }
  }, [sessionId]);

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
      setMsgInput((s as SessionRow).message || "");
      await fetchAgenda();
    }
    load();

    const channel = supabase
      .channel(`remote-${sessionId}`)
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
        () => fetchAgenda()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [sessionId, fetchAgenda]);

  const rem = useLiveRemaining(
    session ?? { running: false, started_at: null, paused_rem: 0 }
  );
  const rawActiveIdx = session?.active_idx ?? -1;
  const activeIdx = rawActiveIdx >= 0 && rawActiveIdx < agenda.length ? rawActiveIdx : -1;

  // Ren "tikker" som tvinger statusen til å regnes ut på nytt hvert sekund
  // uansett — også mens man står i PAUSE (se kommentar ved liveStatus).
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const patchSession = useCallback(
    async (patch: Partial<SessionRow>) => {
      setSession((prev) => (prev ? { ...prev, ...patch } : prev));
      const { error } = await supabase.from("sessions").update(patch).eq("id", sessionId);
      if (error) console.error(error);
    },
    [sessionId]
  );

  const findNextIdx = useCallback(() => {
    for (let i = activeIdx + 1; i < agenda.length; i++) if (!agenda[i].is_section) return i;
    return -1;
  }, [agenda, activeIdx]);
  const nextIdx = findNextIdx();

  const loadItem = useCallback(
    (i: number) => {
      if (!session) return;
      const item = agenda[i];
      if (!item || item.is_section) return;
      let accumulated = session.accumulated;
      if (session.active_idx >= 0 && agenda[session.active_idx] && !agenda[session.active_idx].is_section) {
        accumulated -= calcRemaining(session);
      }
      let offset = 0;
      for (let j = 0; j < i; j++) if (!agenda[j].is_section) offset += agenda[j].duration_secs;
      let section = "";
      for (let j = i - 1; j >= 0; j--) {
        if (agenda[j].is_section) {
          section = agenda[j].name;
          break;
        }
      }
      const patch: Partial<SessionRow> = {
        accumulated,
        scheduled_offset_secs: offset,
        active_idx: i,
        active_label: item.name,
        active_note: item.note,
        active_color: item.color,
        active_section: section,
        total_secs: item.duration_secs,
        paused_rem: item.duration_secs,
        started_at: new Date().toISOString(),
        running: true,
      };
      // Samme klokke-forankring som i kontrollpanelet — se kommentar der.
      if (!session.program_start_ms && !session.program_scheduled_ms) {
        patch.program_start_ms = Date.now() - offset * 1000;
      }
      patchSession(patch);
    },
    [agenda, session, patchSession]
  );

  const startTimer = useCallback(() => {
    if (!session || session.running) return;
    if (session.active_idx < 0 && agenda.length > 0) {
      const fi = agenda.findIndex((a) => !a.is_section);
      if (fi >= 0) {
        loadItem(fi);
        return;
      }
    }
    const nowMs = Date.now();
    const patch: Partial<SessionRow> = { started_at: new Date(nowMs).toISOString(), running: true };
    if (!session.program_start_ms) patch.program_start_ms = nowMs - session.scheduled_offset_secs * 1000;
    patchSession(patch);
  }, [session, agenda, loadItem, patchSession]);

  const pauseTimer = useCallback(() => {
    if (!session || !session.running) return;
    patchSession({ paused_rem: calcRemaining(session), started_at: null, running: false });
  }, [session, patchSession]);

  const nextItem = useCallback(() => {
    if (nextIdx >= 0) loadItem(nextIdx);
  }, [nextIdx, loadItem]);

  const sendMsg = useCallback(() => patchSession({ message: msgInput.trim() }), [msgInput, patchSession]);
  const clearMsg = useCallback(() => {
    setMsgInput("");
    patchSession({ message: "" });
  }, [patchSession]);

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

  // Planlagt klokkeslett per punkt (samme klokke-anker som kontrollpanelet
  // og visningsskjermen) — brukes til "Kl."/"Ny tid" i programoversikten.
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

  const totalProgramSecs = useMemo(
    () => agenda.reduce((sum, it) => sum + (it.is_section ? 0 : it.duration_secs), 0),
    [agenda]
  );

  if (!isSupabaseConfigured) {
    return <SupabaseSetupNotice />;
  }
  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080808] text-[#555] text-sm px-6 text-center">
        Fant ingen slik visning. Sjekk lenken fra kontrollpanelet.
      </div>
    );
  }
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080808] text-[#555] text-sm">
        Kobler til…
      </div>
    );
  }

  const isOvertime = rem < 0;
  // Math.abs (ikke Math.max(0, rem)) — se samme fiks i DisplayScreen.tsx.
  const absRem = Math.abs(rem);
  const hasActive = activeIdx >= 0 && !agenda[activeIdx]?.is_section;
  const absStatus = Math.abs(liveStatus);

  const programAnchorMs = session.program_scheduled_ms || session.program_start_ms;
  const plannedEndMs =
    programAnchorMs && totalProgramSecs > 0 ? programAnchorMs + totalProgramSecs * 1000 : null;
  // Rundet til hele sekunder før multiplikasjon — samme flyttall-støy-fiks
  // som i kontrollpanelet, forebyggende (samme mønster kunne gitt samme
  // "vipping" her også).
  const estimatedEndMs = plannedEndMs != null ? plannedEndMs + Math.round(liveStatus) * 1000 : null;

  return (
    <div className="h-dvh w-full overflow-hidden bg-[#080808] text-[#d8d8d8] p-4 flex flex-col gap-3 max-w-md mx-auto">
      <div className="flex items-center justify-between flex-shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/prodpilot-logo.png" alt="ProdPilot" className="h-5 w-auto" />
        <span className="text-[10px] font-semibold rounded-full border border-[#1a3a6a] bg-[#080f20] text-[#93c5fd] px-2.5 py-0.5">
          Fjernkontroll
        </span>
      </div>

      <div className="rounded-2xl border border-[#1e1e1e] bg-[#0e0e0e] p-5 flex flex-col items-center gap-2 text-center flex-shrink-0">
        {session.active_section && (
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#555]">{session.active_section}</div>
        )}
        <div className="text-lg font-semibold text-white">{hasActive ? session.active_label : "Ingen aktiv"}</div>
        {/* Farges ALDRI etter punktets/bolkens egen farge lenger — kun hvit
            (normalt) og rødt (overtid), som resten av tidtakerne i appen. */}
        <div
          className={`text-6xl font-bold tabular-nums ${
            isOvertime ? "text-[#f87171]" : hasActive ? "text-white" : "text-[#333]"
          }`}
        >
          {hasActive ? (isOvertime ? "+" : "") + fmt(absRem) : "--:--"}
        </div>
        {hasActive && (
          <span
            className={`text-xs font-semibold px-3 py-1 rounded-full border ${
              absStatus < 2
                ? "border-[#2a2a2a] text-[#555]"
                : liveStatus > 0
                ? "border-[#4a1515] text-[#f87171] bg-[#1a0808]"
                : "border-[#1a4a2a] text-[#4ade80] bg-[#0a1f0a]"
            }`}
          >
            {absStatus < 2 ? "0:00" : (liveStatus > 0 ? "+" : "-") + fmt(absStatus)}
          </span>
        )}
      </div>

      {/* Start/Pause er nå kun ikoner, helt til venstre — Neste er større og
          tar resten av plassen, siden det er den man trykker på oftest. */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          className="rounded-xl border border-[#1a4a2a] bg-[#0d2e1a] text-[#4ade80] disabled:opacity-25 w-14 h-14 flex-shrink-0 flex items-center justify-center"
          onClick={startTimer}
          disabled={session.running}
          aria-label="Start"
        >
          <PlayIcon size={20} />
        </button>
        <button
          className="rounded-xl border border-[#1e3a70] bg-[#0d1f40] text-[#93c5fd] disabled:opacity-25 w-14 h-14 flex-shrink-0 flex items-center justify-center"
          onClick={pauseTimer}
          disabled={!session.running}
          aria-label="Pause"
        >
          <PauseIcon size={18} />
        </button>
        <button
          className="flex-1 rounded-xl border border-[#2563eb] bg-[#0d1f40] text-[#93c5fd] font-bold py-4 text-base disabled:opacity-25"
          onClick={nextItem}
          disabled={nextIdx < 0}
        >
          NESTE →
        </button>
      </div>

      {/* Melding til visningsskjerm er nå en pop-up (i stedet for et stort,
          alltid synlig felt) — sparer mye plass på en liten skjerm. Når en
          melding er aktiv, vises en liten grønn indikator man kan trykke på
          for å fjerne den direkte, uten å åpne pop-upen. */}
      {/* Emoji fjernet fra knappen (utløste zoom på iOS via meldings-pop-upen
          under). Begge knappene har nå eksplisitt lik høyde i stedet for å
          stole på at padding gir samme resultat for begge. */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Tydeligere som en KNAPP nå — samme fylte blå stil som Neste/
            Start-knappene (i stedet for en kant som nesten smeltet inn i
            bakgrunnen), og med et handlingsrettet navn ("Send melding til
            skjerm" i stedet for det mer nøytrale "Melding til
            visningsskjerm"). */}
        <button
          className="flex-1 h-12 rounded-xl border border-[#1e3a70] bg-[#0d1f40] text-[#93c5fd] font-bold text-xs px-4 text-left flex items-center gap-2"
          onClick={() => setMsgPopupOpen(true)}
        >
          Send melding til skjerm
          {session.message && (
            <span className="ml-auto text-[#4ade80] text-[10px] italic font-normal truncate max-w-[120px]">
              {session.message}
            </span>
          )}
        </button>
        {session.message && (
          <button
            className="flex-shrink-0 h-12 w-12 rounded-xl border border-[#1a4a1a] bg-[#0d1f0d] text-[#4ade80] text-sm flex items-center justify-center"
            onClick={clearMsg}
            title="Fjern meldingen"
          >
            ✕
          </button>
        )}
      </div>

      {msgPopupOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setMsgPopupOpen(false)}
        >
          <div
            className="rounded-2xl border border-[#1e1e1e] bg-[#0e0e0e] p-4 flex flex-col gap-2 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-[9px] font-bold text-[#555] uppercase tracking-wider">
                Melding til visningsskjerm
              </div>
              <button
                className="text-[#555] hover:text-white text-lg leading-none"
                onClick={() => setMsgPopupOpen(false)}
              >
                ×
              </button>
            </div>
            {/* text-base (16px) er bevisst — Safari på iPhone zoomer automatisk
                inn på et felt som får fokus hvis skriftstørrelsen er under
                16px. Det var trolig det brukeren opplevde som "zoomer inn for
                å fylle ut knappen" idet pop-upen åpnet seg og feltet fikk fokus. */}
            <textarea
              autoFocus
              className="bg-[#080808] border border-[#2a2a2a] rounded-md text-[#d8d8d8] text-base p-2.5"
              rows={3}
              placeholder="Skriv en melding…"
              value={msgInput}
              onChange={(e) => setMsgInput(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                className="rounded-md border border-[#1e3a70] bg-[#0d1f40] text-[#93c5fd] text-xs py-2"
                onClick={() => {
                  sendMsg();
                  setMsgPopupOpen(false);
                }}
              >
                Send
              </button>
              <button
                className="rounded-md border border-[#2a2a2a] bg-[#141414] text-xs py-2"
                onClick={() => {
                  clearMsg();
                  setMsgPopupOpen(false);
                }}
              >
                Fjern
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[#1e1e1e] bg-[#0e0e0e] p-4 flex flex-col gap-1 flex-1 min-h-0">
        <div className="flex items-center justify-between mb-1 flex-shrink-0">
          {/* Lysnet fra #555 til #888 — for mørk/lav kontrast mot
              bakgrunnen til at teksten var lett å lese. */}
          <div className="text-[9px] font-bold text-[#888] uppercase tracking-wider">Programoversikt</div>
          {/* Lås/lås opp — hindrer at man hopper til feil punkt ved et
              uhellstrykk. Låst er standard. */}
          <button
            onClick={() => setItemsLocked((v) => !v)}
            className={`flex items-center gap-1 text-[9px] font-semibold px-2 py-1 rounded-full border ${
              itemsLocked
                ? "border-[#2a2a2a] text-[#666] bg-[#141414]"
                : "border-[#4a1515] text-[#f87171] bg-[#1a0808]"
            }`}
          >
            <LockIcon locked={itemsLocked} size={10} />
            {itemsLocked ? "Låst" : "Ulåst"}
          </button>
        </div>
        {/* Planlagt sluttidspunkt + justert anslag — utenfor scroll-området
            under, slik at den blir stående selv om man blar i punktene. */}
        {plannedEndMs != null && (
          <div className="flex items-center justify-between text-[10px] text-[#888] pb-2 mb-1 border-b border-[#1e1e1e] flex-shrink-0">
            <span>Planlagt slutt: {fmtClock(plannedEndMs)}</span>
            <span
              className={
                absStatus < 2 ? "text-[#888]" : liveStatus > 0 ? "text-[#f87171]" : "text-[#4ade80]"
              }
            >
              Ny tid: {fmtClock(estimatedEndMs)}
            </span>
          </div>
        )}
        <div className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
          {agenda.length === 0 && <div className="text-xs text-[#444]">Ingen punkter enda.</div>}
          {agenda.map((item, i) => {
            if (item.is_section) {
              return (
                <div key={item.id} className="text-[10px] font-semibold text-[#666] uppercase tracking-wide pt-2">
                  {item.name}
                </div>
              );
            }
            const plannedMs = scheduledTimes[i];
            const drift = hasActive ? liveStatus : 0;
            const newMs = plannedMs != null ? plannedMs + drift * 1000 : null;
            const plannedClock = fmtClock(plannedMs);
            const newClock = newMs != null ? fmtClock(newMs) : "";
            const showNewClock = !!plannedClock && !!newClock && newClock !== plannedClock;
            return (
              <button
                key={item.id}
                onClick={() => loadItem(i)}
                disabled={itemsLocked}
                className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs disabled:cursor-default ${
                  i === activeIdx
                    ? "bg-[#080f18] border border-[#2563eb] text-white"
                    : activeIdx >= 0 && i < activeIdx
                    ? "opacity-35"
                    : "border border-transparent"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
                <span className="flex-1 truncate">{item.name}</span>
                <span className="flex flex-col items-end gap-0.5 flex-shrink-0">
                  <span className="text-[10px] text-[#444] font-mono">{fmtDuration(item.duration_secs)}</span>
                  {plannedClock && (
                    <span className="text-[9px] font-mono text-[#555]">
                      Kl. {plannedClock}
                      {showNewClock && (
                        <span className={drift > 0 ? "text-[#f87171]" : "text-[#4ade80]"}> · {newClock}</span>
                      )}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
