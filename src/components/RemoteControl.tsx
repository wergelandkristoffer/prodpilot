"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AgendaItemRow, SessionRow } from "@/lib/types";
import { fmt, calcRemaining } from "@/lib/timer";
import { useLiveRemaining } from "@/hooks/useLiveRemaining";
import SupabaseSetupNotice from "@/components/SupabaseSetupNotice";

function PauseIcon() {
  return (
    <svg
      width="12"
      height="12"
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

export default function RemoteControl({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionRow | null>(null);
  const [agenda, setAgenda] = useState<AgendaItemRow[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [msgInput, setMsgInput] = useState("");

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
  const absRem = Math.max(0, rem);
  const hasActive = activeIdx >= 0 && !agenda[activeIdx]?.is_section;
  const absStatus = Math.abs(liveStatus);

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#080808] text-[#d8d8d8] p-4 pb-10 flex flex-col gap-4 max-w-md mx-auto">
      <div className="flex items-center justify-between pt-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/prodpilot-logo.png" alt="ProdPilot" className="h-3.5 w-auto" />
        <span className="text-[10px] font-semibold rounded-full border border-[#1a3a6a] bg-[#080f20] text-[#93c5fd] px-2.5 py-0.5">
          Fjernkontroll
        </span>
      </div>

      <div className="rounded-2xl border border-[#1e1e1e] bg-[#0e0e0e] p-5 flex flex-col items-center gap-2 text-center">
        {session.active_section && (
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#555]">{session.active_section}</div>
        )}
        <div className="text-lg font-semibold text-white">{hasActive ? session.active_label : "Ingen aktiv"}</div>
        <div
          className="text-6xl font-bold tabular-nums"
          style={{ color: hasActive ? session.active_color : "#333" }}
        >
          {hasActive ? (isOvertime ? "+" : "") + fmt(absRem) : "--:--"}
        </div>
        {hasActive && (
          <span
            className={`text-xs font-semibold px-3 py-1 rounded-full border ${
              absStatus < 2
                ? "border-[#2a2a2a] text-[#555]"
                : liveStatus > 0
                ? "border-[#4a1515] text-[#fca5a5] bg-[#1a0808]"
                : "border-[#1a4a2a] text-[#4ade80] bg-[#0a1f0a]"
            }`}
          >
            {absStatus < 2 ? "På tid" : (liveStatus > 0 ? "Forsinket +" : "Foran -") + fmt(absStatus)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          className="rounded-xl border border-[#1a4a2a] bg-[#0d2e1a] text-[#4ade80] font-semibold py-4 text-sm disabled:opacity-25"
          onClick={startTimer}
          disabled={session.running}
        >
          ▶ Start
        </button>
        <button
          className="rounded-xl border border-[#1e3a70] bg-[#0d1f40] text-[#93c5fd] font-semibold py-4 text-sm disabled:opacity-25 flex items-center justify-center gap-1.5"
          onClick={pauseTimer}
          disabled={!session.running}
        >
          <PauseIcon /> Pause
        </button>
        <button
          className="rounded-xl border border-[#2563eb] bg-[#0d1f40] text-[#93c5fd] font-semibold py-4 text-sm disabled:opacity-25"
          onClick={nextItem}
          disabled={nextIdx < 0}
        >
          NESTE →
        </button>
      </div>

      <div className="rounded-2xl border border-[#1e1e1e] bg-[#0e0e0e] p-4 flex flex-col gap-2">
        <div className="text-[9px] font-bold text-[#555] uppercase tracking-wider">Melding til visningsskjerm</div>
        {session.message && (
          <div className="text-xs text-[#4ade80] italic bg-[#0d1f0d] border border-[#1a4a1a] rounded-lg px-3 py-2">
            {session.message}
          </div>
        )}
        <textarea
          className="bg-[#080808] border border-[#2a2a2a] rounded-md text-[#d8d8d8] text-sm p-2.5"
          rows={2}
          placeholder="Skriv en melding…"
          value={msgInput}
          onChange={(e) => setMsgInput(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            className="rounded-md border border-[#1e3a70] bg-[#0d1f40] text-[#93c5fd] text-xs py-2"
            onClick={sendMsg}
          >
            Send
          </button>
          <button className="rounded-md border border-[#2a2a2a] bg-[#141414] text-xs py-2" onClick={clearMsg}>
            Fjern
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-[#1e1e1e] bg-[#0e0e0e] p-4 flex flex-col gap-1">
        <div className="text-[9px] font-bold text-[#555] uppercase tracking-wider mb-1">Programoversikt</div>
        <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto">
          {agenda.length === 0 && <div className="text-xs text-[#444]">Ingen punkter enda.</div>}
          {agenda.map((item, i) =>
            item.is_section ? (
              <div key={item.id} className="text-[10px] font-semibold text-[#666] uppercase tracking-wide pt-2">
                {item.name}
              </div>
            ) : (
              <button
                key={item.id}
                onClick={() => loadItem(i)}
                className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs ${
                  i === activeIdx
                    ? "bg-[#080f18] border border-[#2563eb] text-white"
                    : activeIdx >= 0 && i < activeIdx
                    ? "opacity-35"
                    : "border border-transparent"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
                <span className="flex-1 truncate">{item.name}</span>
                <span className="text-[10px] text-[#444] font-mono">{fmt(item.duration_secs)}</span>
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
