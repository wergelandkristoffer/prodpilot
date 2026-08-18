"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import SupabaseSetupNotice from "@/components/SupabaseSetupNotice";
import ProjectSidebar, { ProjectOption } from "@/components/ProjectSidebar";
import ProjectSettingsModal from "@/components/ProjectSettingsModal";
import { COLORS, SessionRow } from "@/lib/types";
import { fmt, fmtClock, calcRemaining } from "@/lib/timer";
import { useLiveRemaining } from "@/hooks/useLiveRemaining";

// ── LOKAL AGENDA-MODELL ──────────────────────────────────────
// Vi holder agendaen som en enkel liste client-side og skriver hele
// listen til Supabase ved strukturelle endringer (legg til/fjern/flytt/
// rediger). Samme mønster som det gamle Firebase-oppsettet, som alltid
// pushet hele agenda-arrayet på én gang.
interface LocalItem {
  key: string; // lokal React-key, ikke nødvendigvis samme som DB-id
  is_section: boolean;
  name: string;
  duration_secs: number;
  note: string;
  color: string;
}

function newKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/** Enkelt pause-ikon (to strek) — bevisst IKKE emoji, siden emoji-tegnet ⏸
 * rendres som et fargerikt bilde på iOS/Android i stedet for et nøytralt ikon. */
function PauseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="inline-block -mt-0.5"
      aria-hidden="true"
    >
      <rect x="5" y="3" width="5" height="18" rx="1.5" />
      <rect x="14" y="3" width="5" height="18" rx="1.5" />
    </svg>
  );
}

/** Lager en lesbar feilmelding uansett om vi får en PostgrestError, en vanlig
 * nettverksfeil (fetch-exception), eller noe helt annet. */
function describeSupabaseError(err: unknown): string {
  if (!err) return "Ukjent feil (ingen detaljer fra Supabase).";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || err.name || "Ukjent feil.";
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts = [e.message, e.details, e.hint, e.code]
      .filter((v) => typeof v === "string" && v.length > 0)
      .join(" — ");
    if (parts) return parts;
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") return json;
    } catch {
      // ignore
    }
  }
  return "Ukjent feil — se nettleserkonsollen (Cmd+Opt+I) for detaljer.";
}

export default function ControlPanel({
  initialSessionId,
}: {
  initialSessionId?: string;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(
    initialSessionId ?? null
  );
  const [session, setSession] = useState<SessionRow | null>(null);
  const [agenda, setAgenda] = useState<LocalItem[]>([]);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [copiedLink, setCopiedLink] = useState<"display" | "remote" | null>(null);
  const [origin, setOrigin] = useState("");
  const [now, setNow] = useState(() => new Date());

  // ── form state ────────────────────────────────────────────
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newMin, setNewMin] = useState("");
  const [newSec, setNewSec] = useState("");
  const [selColor, setSelColor] = useState(COLORS[0]);
  const [msgInput, setMsgInput] = useState("");
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("");
  const [autostart, setAutostart] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editMin, setEditMin] = useState("");
  const [editSec, setEditSec] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editColor, setEditColor] = useState(COLORS[0]);
  const [importStatus, setImportStatus] = useState(
    "Importer fra Excel / CSV — dra hit eller klikk"
  );
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const autostartFiredRef = useRef(false);

  // ── ORIGIN + KLOKKE ──────────────────────────────────────────
  useEffect(() => {
    setOrigin(window.location.origin);
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── HENT/OPPRETT SESJON ──────────────────────────────────────
  const fetchAgenda = useCallback(async (sid: string) => {
    const { data } = await supabase
      .from("agenda_items")
      .select("*")
      .eq("session_id", sid)
      .order("position");
    if (data) {
      setAgenda(
        data.map((it) => ({
          key: it.id,
          is_section: it.is_section,
          name: it.name,
          duration_secs: it.duration_secs,
          note: it.note ?? "",
          color: it.color,
        }))
      );
    }
  }, []);

  // ── PROSJEKTLISTE (venstremeny) ────────────────────────────────
  const refreshProjects = useCallback(async () => {
    const { data } = await supabase
      .from("sessions")
      .select("id,name,updated_at")
      .order("updated_at", { ascending: false });
    if (data) setProjects(data as ProjectOption[]);
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        let sid = initialSessionId ?? null;

        if (sid) {
          const { data } = await supabase
            .from("sessions")
            .select("*")
            .eq("id", sid)
            .maybeSingle();
          if (!data) sid = null; // fantes ikke – åpne/lag et under
          else if (!cancelled) setSession(data as SessionRow);
        }

        if (!sid) {
          // Ingen prosjekt-id i URL-en — åpne det sist brukte prosjektet
          // hvis brukeren har et fra før, ellers opprett et nytt.
          const { data: recent } = await supabase
            .from("sessions")
            .select("*")
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (recent) {
            sid = recent.id;
            if (!cancelled) {
              setSession(recent as SessionRow);
              router.replace(`/?s=${sid}`);
            }
          } else {
            const { data, error } = await supabase
              .from("sessions")
              .insert({ name: "Nytt prosjekt" })
              .select("*")
              .single();
            if (error || !data) {
              console.error("Kunne ikke opprette prosjekt:", error);
              if (!cancelled) setInitError(describeSupabaseError(error));
              return;
            }
            sid = data.id;
            if (!cancelled) {
              setSession(data as SessionRow);
              router.replace(`/?s=${sid}`);
            }
          }
        }

        if (!sid || cancelled) return;
        setSessionId(sid);
        await fetchAgenda(sid);
        if (!cancelled) setReady(true);
      } catch (err) {
        console.error("Feil under oppkobling mot Supabase:", err);
        if (!cancelled) setInitError(describeSupabaseError(err));
      }
    }

    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── REALTIME-ABONNEMENT ──────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`session-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          if (payload.eventType !== "DELETE") {
            setSession(payload.new as SessionRow);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agenda_items",
          filter: `session_id=eq.${sessionId}`,
        },
        () => fetchAgenda(sessionId)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, fetchAgenda]);

  const rem = useLiveRemaining(
    session ?? { running: false, started_at: null, paused_rem: 0 }
  );

  // ── SUPABASE-SKRIVING ────────────────────────────────────────
  const patchSession = useCallback(
    async (patch: Partial<SessionRow>) => {
      setSession((prev) => (prev ? { ...prev, ...patch } : prev));
      if (!sessionId) return;
      const { error } = await supabase
        .from("sessions")
        .update(patch)
        .eq("id", sessionId);
      if (error) console.error("Kunne ikke oppdatere sesjon:", error);
    },
    [sessionId]
  );

  // Kjeder alle skrivinger til agenda_items etter hverandre (i stedet for å la
  // dem løpe parallelt). Uten dette kunne rask klikking på ↑/↓/slett føre til at
  // to delete+insert-kall overlappet — det andre kallets insert kunne da havne
  // OPPÅ det første sitt (siden begge slettet "alt" før noen rakk å sette inn
  // igjen), som ga dupliserte rader og en krasjende visning. Feil fanges nå
  // også opp i stedet for å ende som en uhåndtert løftefeil.
  const syncChainRef = useRef<Promise<void>>(Promise.resolve());
  const syncAgenda = useCallback(
    (list: LocalItem[]) => {
      setAgenda(list);
      if (!sessionId) return syncChainRef.current;
      const run = async () => {
        try {
          await supabase.from("agenda_items").delete().eq("session_id", sessionId);
          if (list.length > 0) {
            const rows = list.map((it, i) => ({
              session_id: sessionId,
              position: i,
              is_section: it.is_section,
              name: it.name,
              duration_secs: it.duration_secs,
              note: it.note,
              color: it.color,
            }));
            const { error } = await supabase.from("agenda_items").insert(rows);
            if (error) console.error("Kunne ikke lagre agenda:", error);
          }
        } catch (err) {
          console.error("Feil ved lagring av agenda:", err);
        }
      };
      syncChainRef.current = syncChainRef.current.then(run, run);
      return syncChainRef.current;
    },
    [sessionId]
  );

  // ── NAVIGASJONSHJELPERE ────────────────────────────────────────
  const findNextIdx = useCallback(
    (fromIdx: number) => {
      for (let i = fromIdx + 1; i < agenda.length; i++)
        if (!agenda[i].is_section) return i;
      return -1;
    },
    [agenda]
  );
  const findPrevIdx = useCallback(
    (fromIdx: number) => {
      for (let i = fromIdx - 1; i >= 0; i--)
        if (!agenda[i].is_section) return i;
      return -1;
    },
    [agenda]
  );
  const getScheduledOffset = useCallback(
    (i: number) => {
      let offset = 0;
      for (let j = 0; j < i; j++)
        if (!agenda[j].is_section) offset += agenda[j].duration_secs;
      return offset;
    },
    [agenda]
  );
  const getScheduledTimes = useCallback((): (number | null)[] => {
    if (!session) return agenda.map(() => null);
    const base = session.program_scheduled_ms || session.program_start_ms;
    if (!base) return agenda.map(() => null);
    let offsetMs = 0;
    return agenda.map((item) => {
      if (item.is_section) return null;
      const start = base + offsetMs;
      offsetMs += item.duration_secs * 1000;
      return start;
    });
  }, [agenda, session]);

  const activeIdx = session?.active_idx ?? -1;
  const nextIdx = findNextIdx(activeIdx);
  const prevIdx = findPrevIdx(activeIdx);
  const nextItemData = nextIdx >= 0 ? agenda[nextIdx] : null;

  // ── TIMER-KONTROLL ────────────────────────────────────────────
  const loadItem = useCallback(
    (i: number) => {
      if (!session) return;
      const item = agenda[i];
      if (!item || item.is_section) return;

      let accumulated = session.accumulated;
      if (
        session.active_idx >= 0 &&
        agenda[session.active_idx] &&
        !agenda[session.active_idx].is_section
      ) {
        accumulated -= calcRemaining(session);
      }

      let section = "";
      for (let j = i - 1; j >= 0; j--) {
        if (agenda[j].is_section) {
          section = agenda[j].name;
          break;
        }
      }

      const offset = getScheduledOffset(i);
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
      // Forankre programmets klokke-starttidspunkt idet FØRSTE punkt lastes,
      // slik at status/forsinkelse alltid regnes ut fra faktisk klokkeslett
      // (base + offset) i stedet for akkumulert regnestykke. Uten dette blir
      // "hopp frem/tilbake" upresist siden det ikke fantes noe klokke-anker.
      if (!session.program_start_ms && !session.program_scheduled_ms) {
        patch.program_start_ms = Date.now() - offset * 1000;
      }
      patchSession(patch);
    },
    [agenda, session, patchSession, getScheduledOffset]
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
    const patch: Partial<SessionRow> = {
      started_at: new Date(nowMs).toISOString(),
      running: true,
    };
    if (!session.program_start_ms) {
      patch.program_start_ms = nowMs - session.scheduled_offset_secs * 1000;
    }
    patchSession(patch);
  }, [session, agenda, loadItem, patchSession]);

  const pauseTimer = useCallback(() => {
    if (!session || !session.running) return;
    patchSession({
      paused_rem: calcRemaining(session),
      started_at: null,
      running: false,
    });
  }, [session, patchSession]);

  const resetTimer = useCallback(() => {
    patchSession({
      total_secs: 0,
      paused_rem: 0,
      started_at: null,
      running: false,
      accumulated: 0,
      program_start_ms: 0,
      program_scheduled_ms: 0,
      scheduled_offset_secs: 0,
      active_idx: -1,
      active_label: "",
      active_note: "",
      active_color: COLORS[0],
      active_section: "",
      message: "",
    });
    setMsgInput("");
  }, [patchSession]);

  const nextItem = useCallback(() => {
    if (nextIdx >= 0) loadItem(nextIdx);
  }, [nextIdx, loadItem]);
  const prevItem = useCallback(() => {
    if (prevIdx >= 0) loadItem(prevIdx);
  }, [prevIdx, loadItem]);

  // ── AGENDA-REDIGERING ────────────────────────────────────────
  const addItem = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    const min = Math.max(0, parseInt(newMin, 10) || 0);
    const sec = Math.max(0, Math.min(59, parseInt(newSec, 10) || 0));
    const secs = min * 60 + sec || 300;
    const item: LocalItem = {
      key: newKey(),
      is_section: false,
      name,
      duration_secs: secs,
      note: newNote.trim(),
      color: selColor,
    };
    syncAgenda([...agenda, item]);
    setNewName("");
    setNewMin("");
    setNewSec("");
    setNewNote("");
  }, [agenda, newName, newMin, newSec, newNote, selColor, syncAgenda]);

  const addSection = useCallback(() => {
    const name = newName.trim() || "Ny bolk";
    syncAgenda([
      ...agenda,
      { key: newKey(), is_section: true, name, duration_secs: 0, note: "", color: selColor },
    ]);
    setNewName("");
  }, [agenda, newName, selColor, syncAgenda]);

  const removeItem = useCallback(
    (i: number) => {
      const next = agenda.filter((_, idx) => idx !== i);
      syncAgenda(next);
      if (activeIdx === i) patchSession({ active_idx: -1 });
      else if (activeIdx > i) patchSession({ active_idx: activeIdx - 1 });
    },
    [agenda, syncAgenda, activeIdx, patchSession]
  );

  const moveUp = useCallback(
    (i: number) => {
      if (i <= 0) return;
      const next = [...agenda];
      [next[i], next[i - 1]] = [next[i - 1], next[i]];
      syncAgenda(next);
      if (activeIdx === i) patchSession({ active_idx: i - 1 });
      else if (activeIdx === i - 1) patchSession({ active_idx: i });
    },
    [agenda, syncAgenda, activeIdx, patchSession]
  );

  const moveDown = useCallback(
    (i: number) => {
      if (i >= agenda.length - 1) return;
      const next = [...agenda];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      syncAgenda(next);
      if (activeIdx === i) patchSession({ active_idx: i + 1 });
      else if (activeIdx === i + 1) patchSession({ active_idx: i });
    },
    [agenda, syncAgenda, activeIdx, patchSession]
  );

  const clearAll = useCallback(() => {
    if (!confirm("Tømme hele programmet?")) return;
    syncAgenda([]);
    patchSession({
      active_idx: -1,
      active_label: "",
      active_note: "",
      active_section: "",
      accumulated: 0,
    });
  }, [syncAgenda, patchSession]);

  const openEdit = useCallback(
    (i: number) => {
      const item = agenda[i];
      if (!item) return;
      setEditIdx(i);
      setEditName(item.name);
      setEditMin(String(Math.floor(item.duration_secs / 60)));
      setEditSec(String(item.duration_secs % 60));
      setEditNote(item.note);
      setEditColor(item.color || selColor);
    },
    [agenda, selColor]
  );

  const saveEdit = useCallback(() => {
    if (editIdx === null) return;
    const next = [...agenda];
    const item = { ...next[editIdx] };
    const name = editName.trim();
    if (name) item.name = name;
    if (!item.is_section) {
      const min = Math.max(0, parseInt(editMin, 10) || 0);
      const sec = Math.max(0, Math.min(59, parseInt(editSec, 10) || 0));
      const secs = min * 60 + sec;
      if (secs > 0) item.duration_secs = secs;
    }
    item.note = editNote.trim();
    item.color = editColor;
    next[editIdx] = item;
    syncAgenda(next);
    if (editIdx === activeIdx) {
      patchSession({ active_label: item.name, active_color: item.color, active_note: item.note });
    }
    setEditIdx(null);
  }, [agenda, editIdx, editName, editMin, editSec, editNote, editColor, syncAgenda, activeIdx, patchSession]);

  // ── PROSJEKTER (nytt / bytt / gi nytt navn / slett) ────────────
  const createProject = useCallback(async () => {
    const { data, error } = await supabase
      .from("sessions")
      .insert({ name: "Nytt prosjekt" })
      .select("*")
      .single();
    if (error || !data) {
      console.error("Kunne ikke opprette prosjekt:", error);
      return;
    }
    setSession(data as SessionRow);
    setSessionId(data.id);
    setAgenda([]);
    router.replace(`/?s=${data.id}`);
    setSettingsOpen(false);
    refreshProjects();
  }, [router, refreshProjects]);

  const switchProject = useCallback(
    async (id: string) => {
      if (id === sessionId) {
        setSettingsOpen(false);
        return;
      }
      const { data } = await supabase.from("sessions").select("*").eq("id", id).maybeSingle();
      if (!data) return;
      setSession(data as SessionRow);
      setSessionId(id);
      await fetchAgenda(id);
      router.replace(`/?s=${id}`);
      setSettingsOpen(false);
    },
    [sessionId, fetchAgenda, router]
  );

  const renameCurrentProject = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || !session || trimmed === session.name) return;
      patchSession({ name: trimmed });
      setProjects((prev) => prev.map((p) => (p.id === sessionId ? { ...p, name: trimmed } : p)));
    },
    [session, sessionId, patchSession]
  );

  const deleteCurrentProject = useCallback(async () => {
    if (!sessionId || !session) return;
    if (!confirm(`Slette prosjektet «${session.name}»? Dette kan ikke angres.`)) return;
    const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
    if (error) {
      console.error("Kunne ikke slette prosjekt:", error);
      return;
    }
    setSettingsOpen(false);
    const { data: remaining } = await supabase
      .from("sessions")
      .select("id,name,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (remaining) {
      await switchProject(remaining.id);
    } else {
      await createProject();
    }
    refreshProjects();
  }, [sessionId, session, switchProject, createProject, refreshProjects]);

  // ── MELDING / BAKGRUNN / LOGO ─────────────────────────────────
  const sendMsg = useCallback(() => {
    patchSession({ message: msgInput.trim() });
  }, [msgInput, patchSession]);
  const clearMsg = useCallback(() => {
    setMsgInput("");
    patchSession({ message: "" });
  }, [patchSession]);
  const setBg = useCallback(
    (bg: SessionRow["bg"]) => patchSession({ bg }),
    [patchSession]
  );
  const handleLogo = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => patchSession({ logo_url: reader.result as string });
      reader.readAsDataURL(file);
    },
    [patchSession]
  );
  const removeLogo = useCallback(() => patchSession({ logo_url: null }), [patchSession]);

  // ── TIDSPLAN / AUTOSTART ──────────────────────────────────────
  const setSchedule = useCallback(() => {
    if (!schedDate || !schedTime) return;
    const ms = new Date(`${schedDate}T${schedTime}`).getTime();
    if (Number.isNaN(ms)) return;
    autostartFiredRef.current = false;
    patchSession({ program_scheduled_ms: ms });
  }, [schedDate, schedTime, patchSession]);

  const clearSchedule = useCallback(() => {
    setSchedDate("");
    setSchedTime("");
    setAutostart(false);
    patchSession({ program_scheduled_ms: 0 });
  }, [patchSession]);

  useEffect(() => {
    if (!autostart || !session?.program_scheduled_ms) return;
    const iv = setInterval(() => {
      if (autostartFiredRef.current) return;
      if (!session) return;
      if (Date.now() >= session.program_scheduled_ms && !session.running) {
        autostartFiredRef.current = true;
        const fi = agenda.findIndex((a) => !a.is_section);
        if (fi >= 0) loadItem(fi);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [autostart, session, agenda, loadItem]);

  // ── IMPORT / EKSPORT ───────────────────────────────────────────
  const parseFile = useCallback(
    (file: File) => {
      setImportStatus("Leser fil…");
      const reader = new FileReader();
      const isCsv = file.name.toLowerCase().endsWith(".csv");
      reader.onload = (e) => {
        try {
          let rows: string[][] = [];
          if (isCsv) {
            const text = e.target?.result as string;
            rows = text
              .split("\n")
              .map((r) => r.split(/[,;]/).map((c) => c.trim().replace(/^"|"$/g, "")));
          } else {
            const wb = XLSX.read(e.target?.result, { type: "array" });
            rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
              header: 1,
              defval: "",
            }) as string[][];
          }
          const first = String(rows[0]?.[0] || "").toLowerCase();
          const start = first.includes("type") || first.includes("navn") || first.includes("name") ? 1 : 0;
          const items: LocalItem[] = [];
          for (let r = start; r < rows.length; r++) {
            const row = rows[r];
            if (!row) continue;
            const type = String(row[0] || "").trim().toLowerCase();
            const name = String(row[1] || "").trim();
            if (!name) continue;
            if (type === "bolk" || type === "section") {
              items.push({
                key: newKey(),
                is_section: true,
                name,
                duration_secs: 0,
                note: "",
                color: String(row[4] || "#666").trim(),
              });
            } else {
              const mins = Math.max(0, parseFloat(String(row[2] || "5").replace(",", ".")) || 5);
              const note = String(row[3] || "").trim();
              const col = String(row[4] || selColor).trim();
              items.push({
                key: newKey(),
                is_section: false,
                name,
                duration_secs: Math.round(mins * 60),
                note,
                color: COLORS.includes(col) ? col : selColor,
              });
            }
          }
          if (items.length === 0) {
            setImportStatus("Ingen rader funnet — bruk importmalen");
            return;
          }
          if (confirm(`Fant ${items.length} rader. Legge til?`)) {
            syncAgenda([...agenda, ...items]);
            setImportStatus(`Lagt til ${items.length} rader`);
          } else {
            setImportStatus("Importer fra Excel / CSV — dra hit eller klikk");
          }
        } catch (err) {
          console.error(err);
          setImportStatus("Feil ved lesing. Last ned og bruk importmalen.");
        }
        if (fileInputRef.current) fileInputRef.current.value = "";
      };
      if (isCsv) reader.readAsText(file, "UTF-8");
      else reader.readAsArrayBuffer(file);
    },
    [agenda, selColor, syncAgenda]
  );

  const downloadTemplate = useCallback(() => {
    const csv =
      "Type,Navn,Minutter,Notat,Farge\nBolk,Velkomst,,,#6366f1\nPunkt,Åpningstale,5,Toastmaster snakker,#6366f1\nPunkt,Champagne-skål,3,,#6366f1\nBolk,Middag,,,#10b981\nPunkt,Forrett serveres,20,,#10b981\nPunkt,Hovedrett,30,,#10b981\n";
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8,﻿" + encodeURIComponent(csv);
    a.download = "program-mal.csv";
    a.click();
  }, []);

  const exportProgram = useCallback(() => {
    if (agenda.length === 0) {
      alert("Ingen punkter å eksportere.");
      return;
    }
    const rows = ["Type,Navn,Minutter,Notat,Farge"];
    agenda.forEach((item) => {
      if (item.is_section) {
        rows.push(["Bolk", item.name, "", "", item.color].map((v) => `"${v}"`).join(","));
      } else {
        const mins = (item.duration_secs / 60).toFixed(1);
        rows.push(
          ["Punkt", item.name, mins, item.note, item.color].map((v) => `"${v}"`).join(",")
        );
      }
    });
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8,﻿" + encodeURIComponent(rows.join("\n"));
    a.download = (session?.name || "program") + ".csv";
    a.click();
  }, [agenda, session]);

  // ── LENKER ────────────────────────────────────────────────────
  const displayUrl = sessionId && origin ? `${origin}/display/${sessionId}` : "";
  const remoteUrl = sessionId && origin ? `${origin}/remote/${sessionId}` : "";

  const copyLink = useCallback((which: "display" | "remote", url: string) => {
    if (!url) return;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedLink(which);
    window.setTimeout(() => setCopiedLink((cur) => (cur === which ? null : cur)), 1500);
  }, []);

  // ── AVLEDET STATUS (forsinkelse/fremskyndelse) ─────────────────
  const liveStatus = useMemo(() => {
    if (!session) return 0;
    if (activeIdx < 0 || agenda[activeIdx]?.is_section) return 0;
    const base = session.program_scheduled_ms || session.program_start_ms;
    if (base > 0 && session.scheduled_offset_secs >= 0) {
      const scheduledItemStartMs = base + session.scheduled_offset_secs * 1000;
      const secondsPast = (Date.now() - scheduledItemStartMs) / 1000;
      const currentElapsed = session.total_secs - Math.max(0, rem);
      return secondsPast - currentElapsed;
    }
    const curOT = rem < 0 ? Math.abs(rem) : 0;
    return session.accumulated + curOT;
  }, [session, activeIdx, agenda, rem]);

  const scheduledTimes = getScheduledTimes();

  if (!isSupabaseConfigured) {
    return <SupabaseSetupNotice />;
  }

  if (initError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center text-sm text-[#888] leading-relaxed">
          <div className="text-[#fca5a5] font-semibold mb-2">
            Fikk ikke kontakt med Supabase
          </div>
          <p className="mb-3">
            Sjekk at <code className="text-[#4ade80]">.env.local</code> har riktig URL og
            nøkkel, og at Supabase-prosjektet ditt viser som aktivt (grønt) i dashbordet.
          </p>
          <p className="text-[10px] text-[#555] font-mono break-all bg-[#0e0e0e] border border-[#1e1e1e] rounded-md p-2.5">
            {initError}
          </p>
        </div>
      </div>
    );
  }

  if (!ready || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#555]">
        Kobler til…
      </div>
    );
  }

  const isOvertime = rem < 0;
  const absRem = Math.max(0, rem);
  const absStatus = Math.abs(liveStatus);

  return (
    <div className="min-h-screen p-4 md:p-5">
      {/* EDIT MODAL */}
      {editIdx !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[#2a2a2a] bg-[#111] p-5 flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-white">
              {agenda[editIdx]?.is_section ? "Rediger bolk" : "Rediger punkt"}
            </h3>
            <input
              className="input"
              placeholder="Navn"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
            {!agenda[editIdx]?.is_section && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <input
                    className="input text-center"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={editMin}
                    onChange={(e) => setEditMin(e.target.value)}
                  />
                  <div className="text-[10px] text-[#555] text-center mt-1">minutter</div>
                </div>
                <div>
                  <input
                    className="input text-center"
                    type="number"
                    min={0}
                    max={59}
                    placeholder="0"
                    value={editSec}
                    onChange={(e) => setEditSec(e.target.value)}
                  />
                  <div className="text-[10px] text-[#555] text-center mt-1">sekunder</div>
                </div>
              </div>
            )}
            <input
              className="input"
              placeholder="Notat (valgfritt)"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
            />
            <ColorRow value={editColor} onChange={setEditColor} />
            <div className="flex gap-2 pt-1">
              <button className="btn green flex-1" onClick={saveEdit}>
                Lagre endringer
              </button>
              <button className="btn flex-1" onClick={() => setEditIdx(null)}>
                Avbryt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INNSTILLINGER-MODAL */}
      {settingsOpen && (
        <ProjectSettingsModal
          session={session}
          onClose={() => setSettingsOpen(false)}
          nameDraft={nameDraft}
          onNameDraftChange={setNameDraft}
          onNameBlur={() => renameCurrentProject(nameDraft)}
          setBg={setBg}
          logoInputRef={logoInputRef}
          onLogoChange={handleLogo}
          onRemoveLogo={removeLogo}
          schedDate={schedDate}
          setSchedDate={setSchedDate}
          schedTime={schedTime}
          setSchedTime={setSchedTime}
          autostart={autostart}
          setAutostart={setAutostart}
          onSetSchedule={setSchedule}
          onClearSchedule={clearSchedule}
          displayUrl={displayUrl}
          remoteUrl={remoteUrl}
          copiedLink={copiedLink}
          onCopy={copyLink}
          importStatus={importStatus}
          dragOver={dragOver}
          setDragOver={setDragOver}
          fileInputRef={fileInputRef}
          onFile={parseFile}
          onDownloadTemplate={downloadTemplate}
          onExport={exportProgram}
          onDelete={deleteCurrentProject}
        />
      )}

      <div className="flex gap-4 items-start">
        <ProjectSidebar
          projects={projects}
          currentId={sessionId}
          onSelect={switchProject}
          onCreate={createProject}
        />

        <div className="flex-1 min-w-0">
          {/* TOPBAR */}
          <div className="flex items-center justify-between mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/prodpilot-logo.png" alt="ProdPilot" className="h-4 w-auto" />
          </div>

          {/* PROSJEKTNAVN */}
          <div className="flex items-center gap-2.5 mb-4">
            <h1 className="text-2xl font-bold text-white truncate">{session.name}</h1>
            <button
              className="btn sm flex-shrink-0"
              onClick={() => {
                setNameDraft(session.name);
                setSettingsOpen(true);
              }}
            >
              ⚙ Innstillinger
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 items-start">
            {/* VENSTRE: PROGRAM */}
            <div className="panel gap-3.5">
              <div className="ptitle">Program</div>

              <div className="rounded-lg border border-[#1e1e1e] bg-[#080808] p-3.5 flex flex-col gap-2.5">
                <div className="grid grid-cols-[1fr_80px_80px] gap-2 items-stretch">
                  <div className="flex flex-col gap-1.5">
                    <input
                      className="input"
                      placeholder="Navn på punkt eller bolk"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                    <input
                      className="input"
                      placeholder="Notat (valgfritt)"
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col">
                    <input
                      className="input text-center flex-1"
                      type="number"
                      min={0}
                      placeholder="0"
                      value={newMin}
                      onChange={(e) => setNewMin(e.target.value)}
                    />
                    <div className="text-[10px] text-[#555] text-center mt-0.5">min</div>
                  </div>
                  <div className="flex flex-col">
                    <input
                      className="input text-center flex-1"
                      type="number"
                      min={0}
                      max={59}
                      placeholder="0"
                      value={newSec}
                      onChange={(e) => setNewSec(e.target.value)}
                    />
                    <div className="text-[10px] text-[#555] text-center mt-0.5">sek</div>
                  </div>
                </div>

                <ColorRow value={selColor} onChange={setSelColor} />

                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <button className="btn blue" onClick={addItem}>
                    + Legg til punkt
                  </button>
                  <button className="btn sm" onClick={addSection}>
                    + Bolk
                  </button>
                </div>
              </div>

              <div className="flex items-center">
                <span className="text-[10px] text-[#555]">
                  {agenda.filter((a) => !a.is_section).length === 0
                    ? "Ingen punkter"
                    : `${agenda.filter((a) => !a.is_section).length} punkt${
                        agenda.filter((a) => !a.is_section).length === 1 ? "" : "er"
                      }`}
                </span>
                <button className="btn xs red ml-auto" onClick={clearAll}>
                  Tøm alt
                </button>
              </div>

              <div className="flex flex-col gap-0.5 max-h-[560px] overflow-y-auto pr-0.5">
                {agenda.map((item, i) =>
                  item.is_section ? (
                    <SectionRow key={item.key} item={item} i={i} moveUp={moveUp} moveDown={moveDown} openEdit={openEdit} removeItem={removeItem} timeLabel={fmtClock(scheduledTimes[i])} secLabel={itemSum(agenda, i)} />
                  ) : (
                    <AgendaRow
                      key={item.key}
                      item={item}
                      i={i}
                      num={agenda.slice(0, i + 1).filter((a) => !a.is_section).length}
                      isActive={i === activeIdx}
                      isDone={activeIdx >= 0 && i < activeIdx}
                      clock={fmtClock(scheduledTimes[i])}
                      moveUp={moveUp}
                      moveDown={moveDown}
                      openEdit={openEdit}
                      removeItem={removeItem}
                      loadItem={loadItem}
                    />
                  )
                )}
              </div>
            </div>

            {/* HØYRE: KONTROLLER */}
            <div className="flex flex-col gap-3.5">
              {/* Klokke */}
              <div className="panel py-3.5 px-4 gap-1">
                <div className="text-[36px] font-bold text-white text-center tracking-wide">
                  {now.toLocaleTimeString("no-NO")}
                </div>
                <div className="text-[10px] text-[#333] text-center">
                  {now.toLocaleDateString("no-NO", { weekday: "long", day: "numeric", month: "long" })}
                </div>
              </div>

              {/* Status */}
              <div className="grid grid-cols-2 gap-3.5">
                <div className="sc">
                  <div className="sc-label">Tid igjen</div>
                  <div
                    className={`sc-val ${
                      activeIdx < 0 && !session.running && session.total_secs === 0
                        ? "text-[#333]"
                        : isOvertime
                        ? "text-[#fca5a5]"
                        : absRem <= 60
                        ? "text-[#fde68a]"
                        : "text-[#4ade80]"
                    }`}
                  >
                    {activeIdx < 0 && !session.running && session.total_secs === 0 ? "--:--" : fmt(absRem)}
                  </div>
                  <div className="sc-sub">{session.active_label || "—"}</div>
                </div>
                <div className="sc">
                  <div className="sc-label">Overtid</div>
                  <div className={`sc-val ${isOvertime ? "text-[#fca5a5]" : "text-[#222]"}`}>
                    {isOvertime ? "+" + fmt(Math.abs(rem)) : "—"}
                  </div>
                  <div className="sc-sub">{nextItemData ? "Neste: " + nextItemData.name : "Siste punkt"}</div>
                </div>
              </div>

              <div className="flex items-center justify-between bg-[#080808] border border-[#1e1e1e] rounded-lg px-3.5 py-2.5">
                <span className="status-label">Status</span>
                <span
                  className={`status-pill ${
                    absStatus < 2
                      ? "text-[#555] border-[#1e1e1e]"
                      : liveStatus > 0
                      ? "text-[#fca5a5] border-[#4a1515] bg-[#1a0808]"
                      : "text-[#4ade80] border-[#1a4a2a] bg-[#0a1f0a]"
                  }`}
                >
                  {absStatus < 2 ? "0:00" : (liveStatus > 0 ? "+" : "-") + fmt(absStatus)}
                </span>
              </div>

              {/* Transport */}
              <div className="panel gap-2.5">
                <div className="ptitle">Panel</div>
                <div className="grid grid-cols-3 gap-2">
                  <button className="t-btn t-start" onClick={startTimer} disabled={session.running}>
                    ▶ Start
                  </button>
                  <button className="t-btn t-pause" onClick={pauseTimer} disabled={!session.running}>
                    <PauseIcon /> Pause
                  </button>
                  <button className="t-btn t-reset" onClick={resetTimer}>
                    ↺ Reset
                  </button>
                </div>
                <div className="grid grid-cols-[1fr_2fr] gap-2">
                  <button className="nav-btn n-prev" onClick={prevItem} disabled={prevIdx < 0}>
                    ← FORRIGE
                  </button>
                  <button className="nav-btn n-next" onClick={nextItem} disabled={nextIdx < 0}>
                    NESTE →
                  </button>
                </div>
                {nextItemData && (
                  <div className="next-hint">
                    Neste: {nextItemData.name} ({fmt(nextItemData.duration_secs)})
                  </div>
                )}
              </div>

              {/* Melding */}
              <div className="panel">
                <div className="ptitle">Melding til visningsskjerm</div>
                {session.message && (
                  <div className="flex items-start gap-2 bg-[#0d1f0d] border border-[#1a4a1a] rounded-lg px-2.5 py-2 mb-0.5">
                    <div className="flex-1">
                      <div className="text-[9px] font-bold text-[#1a4a1a] uppercase tracking-wider mb-0.5">
                        Aktiv melding
                      </div>
                      <div className="text-xs text-[#4ade80] italic">{session.message}</div>
                    </div>
                    <button
                      className="text-[#2a4a2a] text-sm px-1"
                      onClick={clearMsg}
                      aria-label="Fjern melding"
                    >
                      ✕
                    </button>
                  </div>
                )}
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Melding som vises på visningsskjermen…"
                  value={msgInput}
                  onChange={(e) => setMsgInput(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button className="btn blue" onClick={sendMsg}>
                    Send melding
                  </button>
                  <button className="btn" onClick={clearMsg}>
                    Fjern
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .panel {
          background: #0e0e0e;
          border: 1px solid #1e1e1e;
          border-radius: 10px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .ptitle {
          font-size: 9px;
          font-weight: 700;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }
        .input {
          background: #080808;
          border: 1px solid #2a2a2a;
          border-radius: 6px;
          color: #d8d8d8;
          font-size: 12px;
          padding: 8px 10px;
          width: 100%;
        }
        .input:focus {
          outline: none;
          border-color: #3a3a3a;
        }
        .btn {
          border-radius: 6px;
          padding: 8px 14px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid #2a2a2a;
          background: #141414;
          color: #d8d8d8;
          white-space: nowrap;
        }
        .btn:hover {
          background: #1c1c1c;
        }
        .btn:disabled {
          opacity: 0.25;
          cursor: default;
          pointer-events: none;
        }
        .btn.green {
          background: #0d2e1a;
          border-color: #1a4a2a;
          color: #4ade80;
        }
        .btn.blue {
          background: #0d1f40;
          border-color: #1e3a70;
          color: #93c5fd;
        }
        .btn.red {
          background: #2a0a0a;
          border-color: #4a1515;
          color: #fca5a5;
        }
        .btn.sm {
          padding: 6px 10px;
          font-size: 11px;
        }
        .btn.xs {
          padding: 3px 7px;
          font-size: 10px;
          border-radius: 5px;
        }
        .sc {
          background: #0e0e0e;
          border: 1px solid #1e1e1e;
          border-radius: 8px;
          padding: 12px 14px;
        }
        .sc-label {
          font-size: 9px;
          font-weight: 700;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 5px;
        }
        .sc-val {
          font-size: 26px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -1px;
        }
        .sc-sub {
          font-size: 10px;
          color: #333;
          margin-top: 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .status-label {
          font-size: 9px;
          font-weight: 700;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .status-pill {
          font-size: 15px;
          font-weight: 700;
          padding: 4px 14px;
          border-radius: 100px;
          border: 1.5px solid transparent;
          min-width: 80px;
          text-align: center;
          display: inline-block;
        }
        .t-btn {
          border-radius: 7px;
          padding: 12px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid #2a2a2a;
        }
        .t-btn:disabled {
          opacity: 0.25;
          cursor: default;
          pointer-events: none;
        }
        .t-start {
          background: #0d2e1a;
          border-color: #1a4a2a;
          color: #4ade80;
        }
        .t-pause {
          background: #0d1f40;
          border-color: #1e3a70;
          color: #93c5fd;
        }
        .t-reset {
          background: #141414;
          border-color: #2a2a2a;
          color: #555;
        }
        .nav-btn {
          border-radius: 7px;
          padding: 13px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          letter-spacing: 0.5px;
        }
        .nav-btn:disabled {
          opacity: 0.25;
          cursor: default;
          pointer-events: none;
        }
        .n-prev {
          background: #141414;
          border: 1px solid #2a2a2a;
          color: #555;
        }
        .n-prev:hover:not(:disabled) {
          background: #1c1c1c;
          color: #d8d8d8;
        }
        .n-next {
          background: #0d1f40;
          border: 1px solid #2563eb;
          color: #93c5fd;
        }
        .n-next:hover:not(:disabled) {
          background: #1d4ed8;
          color: #fff;
        }
        .next-hint {
          font-size: 10px;
          color: #1a4a2a;
          background: #080f08;
          border: 1px solid #1a3a1a;
          border-radius: 6px;
          padding: 7px 10px;
        }
        .link-box {
          background: #060c06;
          border: 1px solid #142014;
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 10px;
          font-family: monospace;
          color: #4ade80;
          word-break: break-all;
          line-height: 1.6;
        }
      `}</style>
    </div>
  );
}

function itemSum(agenda: LocalItem[], sectionIdx: number): string {
  let secs = 0;
  for (let j = sectionIdx + 1; j < agenda.length && !agenda[j].is_section; j++) {
    secs += agenda[j].duration_secs;
  }
  return secs > 0 ? fmt(secs) : "";
}

function ColorRow({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-1.5 items-center flex-wrap py-0.5">
      <span className="text-[10px] text-[#555]">Farge:</span>
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className="w-[18px] h-[18px] rounded-full border-2 flex-shrink-0"
          style={{
            background: c,
            borderColor: c === value ? "#fff" : "transparent",
            transform: c === value ? "scale(1.1)" : undefined,
          }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

function SectionRow({
  item,
  i,
  timeLabel,
  secLabel,
  moveUp,
  moveDown,
  openEdit,
  removeItem,
}: {
  item: LocalItem;
  i: number;
  timeLabel: string;
  secLabel: string;
  moveUp: (i: number) => void;
  moveDown: (i: number) => void;
  openEdit: (i: number) => void;
  removeItem: (i: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md mt-1.5 hover:bg-[#141414]">
      <div className="w-[3px] h-[15px] rounded flex-shrink-0" style={{ background: item.color }} />
      <span className="text-[11px] font-semibold text-[#aaa] flex-1 tracking-wide">{item.name}</span>
      <span className="text-[9px] text-[#333] bg-[#141414] rounded px-1.5 py-0.5">BOLK</span>
      <span className="text-[10px] text-[#555] ml-1.5">{timeLabel || secLabel}</span>
      <div className="flex gap-0.5 ml-auto">
        <button className="btn xs" onClick={() => moveUp(i)}>↑</button>
        <button className="btn xs" onClick={() => moveDown(i)}>↓</button>
        <button className="btn xs" onClick={() => openEdit(i)}>✎</button>
        <button className="btn xs red" onClick={() => removeItem(i)}>✕</button>
      </div>
    </div>
  );
}

function AgendaRow({
  item,
  i,
  num,
  isActive,
  isDone,
  clock,
  moveUp,
  moveDown,
  openEdit,
  removeItem,
  loadItem,
}: {
  item: LocalItem;
  i: number;
  num: number;
  isActive: boolean;
  isDone: boolean;
  clock: string;
  moveUp: (i: number) => void;
  moveDown: (i: number) => void;
  openEdit: (i: number) => void;
  removeItem: (i: number) => void;
  loadItem: (i: number) => void;
}) {
  return (
    <div
      className={`rounded-lg border ${
        isActive ? "border-[#2563eb] bg-[#080f18]" : "border-[#1e1e1e]"
      } ${isDone ? "opacity-35" : ""}`}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-2 cursor-pointer" onClick={() => loadItem(i)}>
        <span className="text-[10px] text-[#333] min-w-[18px]">{num}</span>
        <div className="w-[3px] self-stretch rounded flex-shrink-0" style={{ background: item.color }} />
        <div
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            isActive ? "bg-[#4ade80] animate-prodpilot-pulse" : isDone ? "bg-[#1e1e1e]" : "bg-[#2a2a2a]"
          }`}
        />
        <span className="text-xs flex-1 min-w-0 truncate">{item.name}</span>
        {clock && <span className="text-[10px] text-[#3a3a3a]">{clock}</span>}
        <span className="text-[10px] text-[#3a3a3a] font-mono flex-shrink-0">{fmt(item.duration_secs)}</span>
        <div className="flex gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button className="btn xs" onClick={() => moveUp(i)}>↑</button>
          <button className="btn xs" onClick={() => moveDown(i)}>↓</button>
          <button className="btn xs" onClick={() => openEdit(i)}>✎</button>
          <button className="btn xs" onClick={() => loadItem(i)}>▶</button>
          <button className="btn xs red" onClick={() => removeItem(i)}>✕</button>
        </div>
      </div>
      {item.note && <div className="text-[10px] text-[#3a3a3a] italic leading-relaxed px-2.5 pb-2 pl-9">{item.note}</div>}
    </div>
  );
}
