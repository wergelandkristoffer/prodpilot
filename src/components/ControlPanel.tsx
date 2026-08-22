"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import SupabaseSetupNotice from "@/components/SupabaseSetupNotice";
import ProjectSidebar, { ProjectOption } from "@/components/ProjectSidebar";
import ProjectSettingsModal from "@/components/ProjectSettingsModal";
import { COLORS, SessionRow } from "@/lib/types";
import { fmt, fmtClock, fmtDuration, calcRemaining } from "@/lib/timer";
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

/** Gjør et millisekund-tidsstempel om til verdiene <input type="date"> og
 * <input type="time"> forventer (lokal tid), slik at innstillinger-modalen
 * kan vise det som FAKTISK er lagret i databasen i stedet for alltid å
 * starte tom — det var trolig hovedårsaken til at planlagt-starttid-
 * funksjonen fremsto som "ødelagt": man kunne ikke se hva som egentlig lå
 * lagret fra før. */
function msToDateTimeParts(ms: number): { date: string; time: string } {
  if (!ms) return { date: "", time: "" };
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Setter inn et nytt punkt rett etter siste punkt i valgt bolk, i stedet
 * for alltid nederst i hele programmet. Tom sectionKey ("") betyr "legg
 * til på slutten av programmet" (samme oppførsel som før). */
function insertAfterSection(
  list: LocalItem[],
  sectionKey: string,
  item: LocalItem
): LocalItem[] {
  if (!sectionKey) return [...list, item];
  const startIdx = list.findIndex((it) => it.is_section && it.key === sectionKey);
  if (startIdx === -1) return [...list, item];
  let endIdx = list.length;
  for (let i = startIdx + 1; i < list.length; i++) {
    if (list[i].is_section) {
      endIdx = i;
      break;
    }
  }
  return [...list.slice(0, endIdx), item, ...list.slice(endIdx)];
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
  userId,
  userEmail,
  onSignOut,
}: {
  initialSessionId?: string;
  userId: string;
  userEmail: string;
  onSignOut: () => void;
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
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
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
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [newSectionColor, setNewSectionColor] = useState(COLORS[0]);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [newItemSectionKey, setNewItemSectionKey] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [linkMenuOpen, setLinkMenuOpen] = useState<"display" | "remote" | null>(null);
  // Egen, i appens stil, bekreftelses-dialog i stedet for nettleserens
  // innebygde window.confirm() — ser mer helhetlig ut og kan faktisk
  // stylet/oversettes fritt.
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Egen fil-input for import/eksport-boksen i "Rediger program"-visningen
  // (samme handlers/status som Innstillinger-modalen, men modalen sin
  // skjulte <input type="file"> finnes bare i DOM-en mens modalen er åpen).
  const fileInputRefEdit = useRef<HTMLInputElement>(null);
  const linkMenuRef = useRef<HTMLDivElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const autostartFiredRef = useRef(false);

  const askConfirm = useCallback(
    (
      message: string,
      onConfirm: () => void,
      opts?: { onCancel?: () => void; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
    ) => {
      setConfirmDialog({
        message,
        onConfirm,
        onCancel: opts?.onCancel,
        confirmLabel: opts?.confirmLabel,
        cancelLabel: opts?.cancelLabel,
        danger: opts?.danger,
      });
    },
    []
  );

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
      // Filtrerer bort ev. korrupte/tomme rader (f.eks. fra en gammel,
      // avbrutt skriving) i stedet for å la dem krasje resten av siden —
      // en rad uten id/navn er ikke brukbar uansett.
      setAgenda(
        data
          .filter((it): it is NonNullable<typeof it> => !!it && !!it.id)
          .map((it) => ({
            key: it.id,
            is_section: it.is_section === true,
            name: it.name ?? "",
            duration_secs: it.duration_secs ?? 0,
            note: it.note ?? "",
            color: it.color ?? COLORS[0],
          }))
      );
    }
  }, []);

  // ── PROSJEKTLISTE (venstremeny) ────────────────────────────────
  // Filtrert på `owner_id` — hver innlogget bruker skal kun se sine EGNE
  // prosjekter her. Merk at dette IKKE er det som egentlig håndhever
  // eierskap (det gjør RLS-policyene i `schema.sql`) — dette er bare
  // hvilke rader appen faktisk ber om.
  const refreshProjects = useCallback(async () => {
    const { data } = await supabase
      .from("sessions")
      .select("id,name,updated_at")
      .eq("owner_id", userId)
      .order("updated_at", { ascending: false });
    if (data) setProjects(data as ProjectOption[]);
  }, [userId]);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // Rydder bort tomme test-prosjekter (standardnavn, ingen agenda-punkter) som
  // gjerne har hopet seg opp under testing. Rører ALDRI det prosjektet som er
  // åpent akkurat nå. Kjøres kun én gang per sideinnlasting.
  const cleanupRanRef = useRef(false);
  useEffect(() => {
    if (!ready || cleanupRanRef.current) return;
    cleanupRanRef.current = true;
    (async () => {
      try {
        // Kun blant EGNE prosjekter — uten dette kunne oppryddingen (før
        // innlogging fantes, da alt var åpent for alle) risikere å slette
        // en annen brukers tomme test-rad.
        const { data: candidates } = await supabase
          .from("sessions")
          .select("id,name")
          .eq("owner_id", userId)
          .in("name", ["Nytt program", "Nytt prosjekt"]);
        if (!candidates || candidates.length === 0) return;
        const staleIds: string[] = [];
        for (const c of candidates) {
          if (c.id === sessionId) continue;
          const { count } = await supabase
            .from("agenda_items")
            .select("id", { count: "exact", head: true })
            .eq("session_id", c.id);
          if (!count) staleIds.push(c.id);
        }
        if (staleIds.length > 0) {
          await supabase.from("sessions").delete().in("id", staleIds);
          refreshProjects();
        }
      } catch (err) {
        console.error("Feil ved opprydding av tomme prosjekter:", err);
      }
    })();
  }, [ready, sessionId, refreshProjects, userId]);

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
          // Ingen prosjekt-id i URL-en — åpne det sist brukte AV EGNE
          // prosjekter hvis brukeren har et fra før, ellers opprett et
          // nytt (eid av den innloggede brukeren).
          const { data: recent } = await supabase
            .from("sessions")
            .select("*")
            .eq("owner_id", userId)
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
              .insert({ name: "Nytt prosjekt", owner_id: userId })
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

  // Klemmer active_idx til et gyldig array-indeks. Uten dette kan en
  // sesjon som (av en eller annen grunn — f.eks. punkter slettet fra en
  // annen fane/enhet mens denne var åpen) peker på en indeks utenfor
  // agenda-arrayet, føre til at siden krasjer permanent ved hver
  // sideinnlasting siden verdien ligger lagret i databasen.
  const rawActiveIdx = session?.active_idx ?? -1;
  const activeIdx = rawActiveIdx >= 0 && rawActiveIdx < agenda.length ? rawActiveIdx : -1;
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

  // ── TASTATURSNARVEIER (kun PC — mobil-nettlesere sender ikke disse
  // tastene, så ingen egen enhets-sjekk er nødvendig) ────────────────
  // Piltastene: frem/tilbake. Mellomrom: neste. R: reset. Enter: start
  // hvis stoppet, pause hvis den går. Slås av mens man skriver i et
  // felt (input/textarea/select/contenteditable), slik at man kan skrive
  // navn, notater osv. som normalt uten at bokstaver trigger snarveier.
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null) {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      // Ikke la snarveier trigge transport-knapper mens en pop-up/modal
      // står åpen (legg til punkt/bolk, innstillinger, rediger punkt,
      // bekreftelsesdialog osv.) — da vil man normalt bare lukke/avbryte,
      // ikke starte/pause/reset/hoppe i programmet i bakgrunnen.
      if (
        addItemOpen ||
        addSectionOpen ||
        settingsOpen ||
        editIdx !== null ||
        confirmDialog ||
        projectMenuOpen ||
        linkMenuOpen
      )
        return;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case " ":
          e.preventDefault();
          nextItem();
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          prevItem();
          break;
        case "r":
        case "R":
          e.preventDefault();
          resetTimer();
          break;
        case "Enter":
          e.preventDefault();
          if (session?.running) pauseTimer();
          else startTimer();
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    session,
    startTimer,
    pauseTimer,
    resetTimer,
    nextItem,
    prevItem,
    addItemOpen,
    addSectionOpen,
    settingsOpen,
    editIdx,
    confirmDialog,
    projectMenuOpen,
    linkMenuOpen,
  ]);

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
    syncAgenda(insertAfterSection(agenda, newItemSectionKey, item));
    setNewName("");
    setNewMin("");
    setNewSec("");
    setNewNote("");
    setNewItemSectionKey("");
    setAddItemOpen(false);
  }, [agenda, newName, newMin, newSec, newNote, selColor, newItemSectionKey, syncAgenda]);

  const closeAddItem = useCallback(() => {
    setAddItemOpen(false);
    setNewName("");
    setNewMin("");
    setNewSec("");
    setNewNote("");
    setNewItemSectionKey("");
  }, []);

  const addSection = useCallback(() => {
    const name = newSectionName.trim() || "Ny bolk";
    syncAgenda([
      ...agenda,
      { key: newKey(), is_section: true, name, duration_secs: 0, note: "", color: newSectionColor },
    ]);
    setNewSectionName("");
    setAddSectionOpen(false);
  }, [agenda, newSectionName, newSectionColor, syncAgenda]);

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
    askConfirm(
      "Tømme hele programmet?",
      () => {
        syncAgenda([]);
        patchSession({
          active_idx: -1,
          active_label: "",
          active_note: "",
          active_section: "",
          accumulated: 0,
        });
      },
      { danger: true, confirmLabel: "Tøm alt" }
    );
  }, [askConfirm, syncAgenda, patchSession]);

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
    // editIdx er React-state og kan bli "foreldet" hvis agenda endres (f.eks.
    // et punkt slettet fra en annen fane) mens redigerings-vinduet er åpent.
    // Uten denne sjekken kunne next[editIdx] skrive utenfor arrayet og lage
    // et "hull" (udefinert element) som senere krasjer visningen.
    if (editIdx === null || editIdx < 0 || editIdx >= agenda.length) {
      setEditIdx(null);
      return;
    }
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
      .insert({ name: "Nytt prosjekt", owner_id: userId })
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
    setProjectMenuOpen(false);
    // Hopp rett inn i innstillinger for det nye prosjektet, så man kan gi det
    // navn og sette opp resten med en gang. Nullstiller også tidsplan-
    // feltene, så de ikke arver en gammel dato/klokkeslett fra et annet
    // prosjekt som tilfeldigvis sto åpent i innstillinger nylig.
    setNameDraft(data.name);
    setSchedDate("");
    setSchedTime("");
    setSettingsOpen(true);
    refreshProjects();
  }, [router, refreshProjects, userId]);

  const switchProject = useCallback(
    async (id: string) => {
      if (id === sessionId) {
        setSettingsOpen(false);
        setProjectMenuOpen(false);
        return;
      }
      try {
        const { data, error } = await supabase.from("sessions").select("*").eq("id", id).maybeSingle();
        if (error) throw error;
        if (!data) {
          // Prosjektet finnes ikke lenger (f.eks. slettet i en annen fane) —
          // rydd det bort fra listen i stedet for å krasje.
          setProjects((prev) => prev.filter((p) => p.id !== id));
          return;
        }
        setSession(data as SessionRow);
        setSessionId(id);
        await fetchAgenda(id);
        router.replace(`/?s=${id}`);
        setSettingsOpen(false);
        setProjectMenuOpen(false);
      } catch (err) {
        console.error("Kunne ikke bytte prosjekt:", err);
      }
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

  const deleteCurrentProject = useCallback(() => {
    if (!sessionId || !session) return;
    askConfirm(
      `Slette prosjektet «${session.name}»? Dette kan ikke angres.`,
      async () => {
        const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
        if (error) {
          console.error("Kunne ikke slette prosjekt:", error);
          return;
        }
        setSettingsOpen(false);
        // Kun blant EGNE gjenværende prosjekter — ellers kunne man etter
        // sletting havne inne i en annen brukers (siden lesing av sessions
        // fortsatt er åpent, se schema.sql).
        const { data: remaining } = await supabase
          .from("sessions")
          .select("id,name,updated_at")
          .eq("owner_id", userId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (remaining) {
          await switchProject(remaining.id);
        } else {
          await createProject();
        }
        refreshProjects();
      },
      { danger: true, confirmLabel: "Slett prosjekt" }
    );
  }, [sessionId, session, askConfirm, switchProject, createProject, refreshProjects, userId]);

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
          // Vår egen bekreftelses-dialog er asynkron (venter på klikk) i
          // stedet for blokkerende som window.confirm() var — selve
          // fil-inputen nullstilles derfor uavhengig av svaret, med det
          // samme, som før.
          askConfirm(
            `Fant ${items.length} rader. Legge til?`,
            () => {
              syncAgenda([...agenda, ...items]);
              setImportStatus(`Lagt til ${items.length} rader`);
            },
            {
              onCancel: () => setImportStatus("Importer fra Excel / CSV — dra hit eller klikk"),
              confirmLabel: "Legg til",
            }
          );
        } catch (err) {
          console.error(err);
          setImportStatus("Feil ved lesing. Last ned og bruk importmalen.");
        }
        if (fileInputRef.current) fileInputRef.current.value = "";
      };
      if (isCsv) reader.readAsText(file, "UTF-8");
      else reader.readAsArrayBuffer(file);
    },
    [agenda, selColor, syncAgenda, askConfirm]
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

  // Lukk "Fjernkontroll"/"Visningsskjerm"-menyen ved klikk utenfor.
  useEffect(() => {
    if (!linkMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (linkMenuRef.current && !linkMenuRef.current.contains(e.target as Node)) {
        setLinkMenuOpen(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [linkMenuOpen]);

  // ── AVLEDET STATUS (forsinkelse/fremskyndelse) ─────────────────
  // Status regnes mot ett fast klokke-anker: enten et eksplisitt planlagt
  // starttidspunkt (satt i Innstillinger), ELLER — hvis ingen er satt —
  // tidspunktet da "Start" ble trykket for aller første gang etter siste
  // nullstilling (program_start_ms, satt automatisk i loadItem/startTimer).
  // Uten NOEN av delene (programmet er aldri startet) vises ingen status.
  //
  // Med et anker satt, tikker status i ekte sanntid: 1 sekund forskjell i
  // status per faktisk forløpt sekund — ingen kunstig hopping. Det som KAN
  // gi et hopp når man navigerer frem/tilbake mellom punkter er reelt: du
  // sammenligner faktisk klokke mot planen, så hvis du faktisk brukte tid på
  // å teste/navigere, vil status riktig nok vise at du ligger noe bak planen
  // akkurat da — det er ikke en bug, det er selve poenget med indikatoren.
  const liveStatus = useMemo(() => {
    if (!session) return 0;
    if (activeIdx < 0 || agenda[activeIdx]?.is_section) return 0;
    const anchorMs = session.program_scheduled_ms || session.program_start_ms;
    if (!anchorMs) return rem < 0 ? Math.abs(rem) : 0;
    const scheduledItemStartMs = anchorMs + session.scheduled_offset_secs * 1000;
    const secondsPast = (Date.now() - scheduledItemStartMs) / 1000;
    const currentElapsed = session.total_secs - Math.max(0, rem);
    return secondsPast - currentElapsed;
    // `now` tikker hvert sekund (se ORIGIN+KLOKKE-effekten) og er med her
    // for å tvinge status til å regnes ut på nytt kontinuerlig — også mens
    // man står i PAUSE. Uten den fryser status idet man trykker pause,
    // siden `rem` slutter å oppdatere seg selv når timeren ikke går.
  }, [session, activeIdx, agenda, rem, now]);

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

  // Forventet sluttidspunkt: den opprinnelige planen (klokke-anker + summen
  // av alle punktenes lengde) og — når vi ligger foran/bak — et justert
  // anslag basert på nøyaktig samme avvik som Status-pillen viser akkurat nå.
  const programAnchorMs = session.program_scheduled_ms || session.program_start_ms;
  const totalProgramSecs = agenda.reduce(
    (sum, it) => sum + (it.is_section ? 0 : it.duration_secs),
    0
  );
  const plannedEndMs =
    programAnchorMs && totalProgramSecs > 0 ? programAnchorMs + totalProgramSecs * 1000 : null;
  // `Math.round(liveStatus)` FØR gangingen med 1000 — uten dette forplantet
  // brøkdels-sekunder fra `liveStatus` seg som flyttall-støy gjennom
  // ms→sek→ms-regnestykket under, som igjen fikk "Program igjen" til å
  // "vippe" tilfeldig mellom to tall hvert sekund (spesielt synlig i
  // overtid) i stedet for å telle jevnt.
  const estimatedEndMs = plannedEndMs != null ? plannedEndMs + Math.round(liveStatus) * 1000 : null;
  // Ny tidtaker: hvor mye tid som er igjen av HELE det planlagte programmet
  // (ikke bare det aktive punktet). Regnes mot `estimatedEndMs` (justert med
  // gjeldende avvik), IKKE den opprinnelige faste `plannedEndMs` — slik at
  // tallet faktisk endrer seg etter hvert som man ligger foran/bak planen,
  // ikke bare teller ned mot et tall som aldri flytter seg. Negativt tall
  // (etter forventet sluttid) vises som overtid i rødt.
  // VIKTIG: bruk et FRISKT `Date.now()`-kall her — IKKE `now.getTime()`
  // (den tikkende state-klokken, som kun oppdaterer seg selv ett hakk i
  // sekundet via setInterval). `estimatedEndMs` over er allerede regnet ut
  // fra `liveStatus`, som selv bruker et friskt `Date.now()`-kall og
  // gjenberegnes langt oftere enn `now` (opptil 60 ganger/sek. via
  // `rem`/requestAnimationFrame). Å blande et fersk tidspunkt med et
  // inntil ett sekund gammelt var nettopp det som fikk tallet til å
  // "glitche"/vippe: de to klokkene kom sjelden helt i takt, så avrundingen
  // kunne slå ulikt ut fra rendring til rendring. Med samme ferske
  // tidspunkt begge steder oppdaterer tallet seg jevnt, ett sekund av
  // gangen.
  const programRemainingSecs =
    estimatedEndMs != null ? Math.round((estimatedEndMs - Date.now()) / 1000) : null;

  // Klokkeboksens to "rader" ligger som egne variabler (i stedet for å
  // skrives rett inn i JSX-en under) slik at de samme elementene kan
  // gjenbrukes TO steder: én gang i en usynlig "målestokk" (som alltid
  // viser begge radene og dermed alltid gir boksen riktig, fast høyde —
  // helt uavhengig av om "planlagt start" faktisk er satt), og én gang i
  // det virkelige, synlige laget (der rad 2 kun tas med når "planlagt
  // start" faktisk finnes, og som midtstilles vertikalt i den faste
  // høyden målestokken bestemte). Se boksen selv lenger ned for hvordan
  // dette settes sammen — dette er det som gir "like mye luft over og
  // under" uansett om raden med planlagt start vises eller ikke.
  const clockRow1 = (
    <div className="flex items-center gap-3">
      <div className="flex flex-col items-center flex-shrink-0 pr-3 border-r border-[#1e1e1e]">
        <span className="text-[10px] text-[#888] capitalize tracking-wide whitespace-nowrap">
          {now.toLocaleDateString("no-NO", { weekday: "long", day: "numeric", month: "long" })}
        </span>
        <span className="text-[26px] font-bold text-white tracking-wide tabular-nums leading-none mt-0.5">
          {now.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-[#555] flex-shrink-0">Planlagt slutt</span>
          <span className="text-[11px] text-[#888] font-mono tabular-nums">
            {plannedEndMs != null ? fmtClock(plannedEndMs) : "--:--"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-[#555] flex-shrink-0">Ny tid</span>
          <span
            className={`text-[11px] font-mono font-semibold tabular-nums ${
              estimatedEndMs == null
                ? "text-[#555]"
                : absStatus < 2
                ? "text-[#888]"
                : liveStatus > 0
                ? "text-[#f87171]"
                : "text-[#4ade80]"
            }`}
          >
            {estimatedEndMs != null ? fmtClock(estimatedEndMs) : "--:--"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[#1e1e1e] pt-1.5">
          <span className="text-[9px] text-[#555] uppercase tracking-wider flex-shrink-0">
            Program igjen
          </span>
          {/* Ingen gul/grønn fargeskala her lenger — kun hvit (normalt) og
              rødt (overtid), samme regel som resten av tidtakerne i
              appen. */}
          <span
            className={`text-[15px] font-bold font-mono tabular-nums ${
              programRemainingSecs == null
                ? "text-[#555]"
                : programRemainingSecs < 0
                ? "text-[#f87171]"
                : "text-white"
            }`}
          >
            {programRemainingSecs == null
              ? "--:--"
              : (programRemainingSecs < 0 ? "+" : "") + fmt(Math.abs(programRemainingSecs))}
          </span>
        </div>
      </div>
    </div>
  );
  const clockRow2 = (
    <div className="text-[9px] text-[#555] text-center pt-1.5 mt-0.5 border-t border-[#1e1e1e]">
      Planlagt start:{" "}
      {session.program_scheduled_ms > 0
        ? new Date(session.program_scheduled_ms).toLocaleString("no-NO", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          }) +
          (session.program_scheduled_ms > now.getTime()
            ? ` · om ${fmt(Math.round((session.program_scheduled_ms - now.getTime()) / 1000))}`
            : "")
        : "–"}
    </div>
  );

  // Punktlisten er en funksjon (ikke en fast variabel) slik at den kan
  // gjenbrukes med ulik makshøyde i vanlig visning vs. "Rediger program".
  // Samme avvik som Status-pillen — brukes til å justere "Ny tid" for hver
  // rad i programoversikten.
  const agendaDriftSecs = activeIdx >= 0 && !agenda[activeIdx]?.is_section ? liveStatus : 0;

  const renderAgendaList = (maxHeightClass: string) => (
    <>
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

      {/* Kolonneoverskrifter — ALLTID synlige (ikke lenger betinget av om et
          klokke-anker finnes) og bredden på selve kolonnene under er FAST,
          slik at ingenting her endrer form/hopper når man trykker Start og
          feltene fylles med faktiske klokkeslett. */}
      <div className="flex items-center gap-1.5 px-2.5 text-[9px] text-[#444] uppercase tracking-wide">
        <span className="min-w-[18px] flex-shrink-0" />
        <span className="w-[3px] flex-shrink-0" />
        <span className="w-1.5 flex-shrink-0" />
        <span className="flex-1 min-w-0" />
        {/* Litt mer luft + tynne skillestreker mellom de tre tallkolonnene,
            så de ikke flyter sammen visuelt. */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <span className="w-[100px] text-right">Varighet</span>
          <span className="w-[46px] text-right border-l border-[#242424] pl-2.5">Planlagt</span>
          <span className="w-[46px] text-right border-l border-[#242424] pl-2.5">Ny tid</span>
        </div>
        <span className="w-[135px] flex-shrink-0" />
      </div>

      <div className={`flex flex-col gap-0.5 ${maxHeightClass} overflow-y-auto pr-0.5`}>
        {agenda.map((item, i) => {
          if (item.is_section) {
            return (
              <SectionRow
                key={item.key}
                item={item}
                i={i}
                moveUp={moveUp}
                moveDown={moveDown}
                openEdit={openEdit}
                removeItem={removeItem}
                timeLabel={fmtClock(scheduledTimes[i])}
                secLabel={itemSum(agenda, i)}
              />
            );
          }
          const plannedMs = scheduledTimes[i];
          const clock = fmtClock(plannedMs);
          const newClock = plannedMs != null ? fmtClock(plannedMs + agendaDriftSecs * 1000) : "";
          return (
            <AgendaRow
              key={item.key}
              item={item}
              i={i}
              num={agenda.slice(0, i + 1).filter((a) => !a.is_section).length}
              isActive={i === activeIdx}
              isDone={activeIdx >= 0 && i < activeIdx}
              clock={clock}
              newClock={newClock}
              isLate={agendaDriftSecs > 0}
              moveUp={moveUp}
              moveDown={moveDown}
              openEdit={openEdit}
              removeItem={removeItem}
              loadItem={loadItem}
            />
          );
        })}
      </div>
    </>
  );

  // Vanlig visning: to knapper som åpner pop-up med valgene (navn, tid,
  // farge osv.) — holder resten av kontrollpanelet ryddig når man bare
  // trenger å legge til ett og ett punkt innimellom.
  const programPanel = (
    <div className="panel gap-3.5 h-full min-h-0">
      <div className="ptitle">Program</div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          className="btn blue"
          onClick={() => {
            setNewItemSectionKey("");
            setAddItemOpen(true);
          }}
        >
          + Legg til punkt
        </button>
        <button className="btn purple" onClick={() => setAddSectionOpen(true)}>
          + Legg til bolk
        </button>
      </div>
      {/* Ingen fast minstehøyde her lenger — listen skal bla INNAD i boksen
          uansett hvor mye plass boksen faktisk får, i stedet for å presse
          hele siden til å vokse/bla. */}
      {renderAgendaList("flex-1 min-h-0")}
    </div>
  );

  // "Rediger program"-visning: legg-til-feltene ligger fast til venstre
  // (bolk øverst, litt mer kompakt siden den har færre felt — punkt under,
  // med full plass) mens hele programmet ligger til høyre i full bredde og
  // bla-bart for seg selv. Venstre kolonne er sticky, så den blir stående
  // mens man blar i et langt program til høyre.
  const editProgramPanel = (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-3.5 items-start">
      <div className="flex flex-col gap-3.5 lg:sticky lg:top-4">
        <div className="panel gap-2 py-3">
          <div className="ptitle text-[#c4b5fd]">+ Legg til bolk</div>
          <input
            className="input"
            placeholder="Navn på bolk"
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSection()}
          />
          <ColorRow value={newSectionColor} onChange={setNewSectionColor} />
          <button className="btn purple sm" onClick={addSection}>
            Legg til bolk
          </button>
        </div>

        <div className="panel gap-2.5">
          <div className="ptitle text-[#93c5fd]">+ Legg til punkt</div>
          <input
            className="input"
            placeholder="Navn på punkt"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem()}
          />
          {/* Kompakt "XX min XX sek" på én linje i stedet for to store
              felt med egen etikettlinje under — sparer vertikal plass.
              Tallet er midtstilt i feltet UAVHENGIG av nettleserens
              opp/ned-piler (skjult via .no-spinner), som ellers dytter
              den synlige teksten ut av senter. */}
          <div className="flex items-center gap-1.5">
            <input
              className="input no-spinner text-center w-14 flex-none"
              type="number"
              min={0}
              placeholder="0"
              value={newMin}
              onChange={(e) => setNewMin(e.target.value)}
            />
            <span className="text-[11px] text-[#555] flex-shrink-0">min</span>
            <input
              className="input no-spinner text-center w-14 flex-none"
              type="number"
              min={0}
              max={59}
              placeholder="0"
              value={newSec}
              onChange={(e) => setNewSec(e.target.value)}
            />
            <span className="text-[11px] text-[#555] flex-shrink-0">sek</span>
          </div>
          <input
            className="input"
            placeholder="Notat (valgfritt)"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
          />
          <ColorRow value={selColor} onChange={setSelColor} />
          {agenda.some((a) => a.is_section) && (
            <div>
              <div className="text-[10px] text-[#555] uppercase tracking-wider mb-1">
                Bolk
              </div>
              <select
                className="input"
                value={newItemSectionKey}
                onChange={(e) => setNewItemSectionKey(e.target.value)}
              >
                <option value="">Legg til på slutten av programmet</option>
                {agenda
                  .filter((a) => a.is_section)
                  .map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name || "Uten navn"}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <button className="btn blue" onClick={addItem}>
            Legg til punkt
          </button>
        </div>

        {/* Samme importer/eksporter-boks som ligger i Innstillinger — lagt
            til her nederst også, slik at man slipper å forlate
            redigeringsvisningen for å importere et program mens man bygger
            det opp. Egen fil-input (fileInputRefEdit) siden modalens
            skjulte <input type="file"> ikke finnes i DOM-en her. */}
        <div className="panel gap-2.5">
          <div className="ptitle">Importer / eksporter program</div>
          <div
            className={`rounded-md border border-dashed ${
              dragOver ? "border-[#2563eb] text-[#93c5fd]" : "border-[#2a2a2a] text-[#555]"
            } p-2 text-center text-[11px] cursor-pointer transition-colors`}
            onClick={() => fileInputRefEdit.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files[0]) parseFile(e.dataTransfer.files[0]);
            }}
          >
            {importStatus}
          </div>
          <input
            ref={fileInputRefEdit}
            type="file"
            accept=".xlsx,.csv,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <button className="btn xs" onClick={downloadTemplate}>
              Last ned importmal
            </button>
            <button className="btn xs" onClick={exportProgram}>
              Eksporter program
            </button>
          </div>
        </div>
      </div>

      <div className="panel gap-3.5">
        <div className="ptitle">Program</div>
        {renderAgendaList("max-h-[75vh]")}
      </div>
    </div>
  );

  return (
    <div className="h-dvh w-full overflow-hidden p-4 md:p-5 flex flex-col">
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

      {/* NYTT PUNKT-MODAL */}
      {addItemOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={closeAddItem}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-[#2a2a2a] bg-[#111] p-5 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-white">Nytt punkt</h3>
            <input
              className="input"
              placeholder="Navn på punkt"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addItem()}
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <input
                  className="input text-center"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={newMin}
                  onChange={(e) => setNewMin(e.target.value)}
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
                  value={newSec}
                  onChange={(e) => setNewSec(e.target.value)}
                />
                <div className="text-[10px] text-[#555] text-center mt-1">sekunder</div>
              </div>
            </div>
            <input
              className="input"
              placeholder="Notat (valgfritt)"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
            />
            <ColorRow value={selColor} onChange={setSelColor} />
            {agenda.some((a) => a.is_section) && (
              <div>
                <div className="text-[10px] text-[#555] uppercase tracking-wider mb-1">
                  Bolk
                </div>
                <select
                  className="input"
                  value={newItemSectionKey}
                  onChange={(e) => setNewItemSectionKey(e.target.value)}
                >
                  <option value="">Legg til på slutten av programmet</option>
                  {agenda
                    .filter((a) => a.is_section)
                    .map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.name || "Uten navn"}
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button className="btn green flex-1" onClick={addItem}>
                Legg til punkt
              </button>
              <button className="btn flex-1" onClick={closeAddItem}>
                Avbryt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NY BOLK-MODAL */}
      {/* Egen bekreftelses-dialog (erstatter window.confirm() sitt
          nettleser-utseende) — brukes for "Tøm alt", "Slett prosjekt" og
          "Legge til importerte rader?". */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => {
            confirmDialog.onCancel?.();
            setConfirmDialog(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-[#2a2a2a] bg-[#111] p-5 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-[#d8d8d8] leading-relaxed">{confirmDialog.message}</p>
            <div className="flex gap-2">
              <button
                className={`btn flex-1 ${confirmDialog.danger ? "red" : "blue"}`}
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
              >
                {confirmDialog.confirmLabel || "Bekreft"}
              </button>
              <button
                className="btn flex-1"
                onClick={() => {
                  confirmDialog.onCancel?.();
                  setConfirmDialog(null);
                }}
              >
                {confirmDialog.cancelLabel || "Avbryt"}
              </button>
            </div>
          </div>
        </div>
      )}

      {addSectionOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setAddSectionOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-[#2a2a2a] bg-[#111] p-5 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-white">Ny bolk</h3>
            <input
              className="input"
              placeholder="Navn på bolk"
              autoFocus
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSection()}
            />
            <ColorRow value={newSectionColor} onChange={setNewSectionColor} />
            <div className="flex gap-2 pt-1">
              <button className="btn purple flex-1" onClick={addSection}>
                Legg til bolk
              </button>
              <button className="btn flex-1" onClick={() => setAddSectionOpen(false)}>
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

      <ProjectSidebar
        open={projectMenuOpen}
        onClose={() => setProjectMenuOpen(false)}
        projects={projects}
        currentId={sessionId}
        onSelect={switchProject}
        onCreate={createProject}
        userEmail={userEmail}
        onSignOut={onSignOut}
      />

      <div className="flex flex-col flex-1 min-h-0">
        {/* TOPBAR */}
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <button
            className="flex items-center gap-1.5 pl-2.5 pr-3.5 py-1.5 rounded-full border border-[#2a2a2a] bg-transparent text-[#999] text-xs font-semibold tracking-wide hover:bg-[#141414] hover:text-white hover:border-[#3a3a3a] transition-colors"
            onClick={() => setProjectMenuOpen(true)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
            Prosjekter
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/prodpilot-logo.png" alt="Prodpilot" className="h-6 w-auto" />
        </div>

        {/* PROSJEKTNAVN — tittel på egen linje, knappene i to grupper som
            stables under hverandre på smale skjermer i stedet for å presses
            sammen på én linje (uten at knappene selv blir større). */}
        <div className="flex flex-col gap-1.5 mb-4 flex-shrink-0">
          <h1 className="text-2xl font-bold text-white truncate">{session.name}</h1>
          <div className="flex flex-col sm:flex-row sm:items-center gap-1.5">
            <div className="flex flex-wrap gap-1.5">
              {!editMode && (
                <button
                  className="btn sm flex-shrink-0"
                  onClick={() => {
                    setNameDraft(session.name);
                    // Fyller tidsplan-feltene med det som FAKTISK er lagret på
                    // prosjektet akkurat nå, i stedet for å alltid åpne tomt —
                    // det var trolig grunnen til at "planlegg starttidspunkt"
                    // fremsto som ødelagt (man så aldri hva som egentlig sto
                    // lagret fra før).
                    const parts = msToDateTimeParts(session.program_scheduled_ms);
                    setSchedDate(parts.date);
                    setSchedTime(parts.time);
                    setSettingsOpen(true);
                  }}
                >
                  ⚙ Innstillinger
                </button>
              )}
              <button
                className={`btn sm flex-shrink-0 ${editMode ? "green" : ""}`}
                onClick={() => setEditMode((v) => !v)}
              >
                {editMode ? "✓ Ferdig med redigering" : "✎ Rediger program"}
              </button>
            </div>

            {/* Fjernkontroll / visningsskjerm — små knapper med Åpne/Kopier-valg.
                Egen gruppe, så den kan stables under hovedknappene på mobil i
                stedet for å tvinges helt til høyre og brekke rart. */}
            <div className="flex gap-1.5 flex-shrink-0 sm:ml-auto" ref={linkMenuRef}>
              <div className="relative">
                <button
                  className="btn xs"
                  onClick={() => setLinkMenuOpen((v) => (v === "remote" ? null : "remote"))}
                  disabled={!remoteUrl}
                >
                  Fjernkontroll
                </button>
                {linkMenuOpen === "remote" && (
                  <div className="absolute right-0 top-full mt-1 z-30 flex flex-col bg-[#141414] border border-[#2a2a2a] rounded-lg shadow-xl overflow-hidden min-w-[130px]">
                    <a
                      href={remoteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 text-xs text-[#ddd] hover:bg-[#1c1c1c] text-left"
                      onClick={() => setLinkMenuOpen(null)}
                    >
                      Åpne
                    </a>
                    <button
                      className="px-3 py-2 text-xs text-[#ddd] hover:bg-[#1c1c1c] text-left"
                      onClick={() => {
                        copyLink("remote", remoteUrl);
                        setLinkMenuOpen(null);
                      }}
                    >
                      {copiedLink === "remote" ? "Kopiert!" : "Kopier lenke"}
                    </button>
                  </div>
                )}
              </div>
              <div className="relative">
                <button
                  className="btn xs"
                  onClick={() => setLinkMenuOpen((v) => (v === "display" ? null : "display"))}
                  disabled={!displayUrl}
                >
                  Visningsskjerm
                </button>
                {linkMenuOpen === "display" && (
                  <div className="absolute right-0 top-full mt-1 z-30 flex flex-col bg-[#141414] border border-[#2a2a2a] rounded-lg shadow-xl overflow-hidden min-w-[130px]">
                    <a
                      href={displayUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 text-xs text-[#ddd] hover:bg-[#1c1c1c] text-left"
                      onClick={() => setLinkMenuOpen(null)}
                    >
                      Åpne
                    </a>
                    <button
                      className="px-3 py-2 text-xs text-[#ddd] hover:bg-[#1c1c1c] text-left"
                      onClick={() => {
                        copyLink("display", displayUrl);
                        setLinkMenuOpen(null);
                      }}
                    >
                      {copiedLink === "display" ? "Kopiert!" : "Kopier lenke"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {editMode ? (
          /* REDIGER PROGRAM-VISNING: legg-til-bolk og legg-til-punkt står
             alltid synlige side om side øverst, med programlisten under.
             Resten av kontrollpanelet (klokke, status, transport, melding
             til visningsskjerm) er bevisst ikke synlig her — dette er kun
             for å bygge opp programmet før man faktisk er i gang. */
          <div className="w-full flex-1 min-h-0 overflow-y-auto">{editProgramPanel}</div>
        ) : (
        <div className="grid grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[2fr_1fr] lg:grid-rows-1 gap-4 flex-1 min-h-0">
            {/* VENSTRE PÅ DESKTOP / NEDERST PÅ MOBIL: PROGRAM — punktlisten
                scroller internt i sin egen boks i stedet for at hele siden
                vokser/blar. `order` snur rekkefølgen kun på mobil (én
                kolonne), slik at kontrollene kommer først og programmet
                under — desktop-layouten (venstre/høyre) er uendret. */}
            <div className="order-2 lg:order-1 min-h-0 flex flex-col">{programPanel}</div>

            {/* HØYRE PÅ DESKTOP / ØVERST PÅ MOBIL: KONTROLLER — hele
                kolonnen scroller internt (dersom den ikke får plass) i
                stedet for at siden gjør det. ALLE felt under er nå alltid
                synlige (viser "--:--"/"–" når det ikke finnes data ennå) i
                stedet for å dukke opp/forsvinne — det var det som fikk hele
                siden til å "hoppe" idet man trykket Start eller sendte en
                melding. */}
            <div className="order-1 lg:order-2 flex flex-col gap-3 min-h-0 overflow-y-auto pr-0.5">
              {/* Slått sammen til ÉN boks: klokkeslett til venstre, resten
                  (planlagt slutt / ny tid / tid igjen av programmet) til
                  høyre — i stedet for to separate bokser.

                  "Målestokk + overlegg"-mønster for midtstilling: en usynlig
                  kopi av INNHOLDET (alltid med begge radene, uansett om
                  "planlagt start" er satt) ligger i vanlig flyt og bestemmer
                  boksens faste høyde helt automatisk — ingen hardkodede
                  piksler, boksen tilpasser seg alltid ekte skrift-mål. Selve
                  det synlige innholdet ligger i et absolutt posisjonert lag
                  OVENPÅ målestokken og fyller boksen nøyaktig (`inset-0`),
                  og bruker `justify-center` til å midtstille seg i den faste
                  høyden. Når "planlagt start" IKKE er satt vises kun rad 1,
                  og den blir dermed midtstilt med like mye luft over og
                  under. Når "planlagt start" settes, blir rad 2 med i det
                  synlige laget også — siden boksens høyde da er nøyaktig
                  stor nok for begge radene (det er jo det målestokken alltid
                  viser), fyller de to radene sammen boksen akkurat, med den
                  samme polstringen over og under — altså fortsatt like mye
                  luft over og under, nå rundt begge radene samlet. */}
              <div className="panel py-3 px-4 flex-shrink-0 relative">
                <div className="invisible flex flex-col gap-1.5" aria-hidden="true">
                  {clockRow1}
                  {clockRow2}
                </div>
                {/* `inset-0` fyller boksens PADDING-boks (kanten helt ut mot
                    border), IKKE boksens indre content-boks — så polstringen
                    (`py-3 px-4`) må gjentas eksplisitt her for at det
                    synlige laget skal havne innenfor samme ramme som
                    målestokken (som får polstringen sin "gratis" via vanlig
                    dokumentflyt). */}
                <div className="absolute inset-0 flex flex-col justify-center gap-1.5 py-3 px-4">
                  {clockRow1}
                  {session.program_scheduled_ms > 0 && clockRow2}
                </div>
              </div>

              {/* Tidtaker (aktivt punkt) — navnet på hva som er på nå
                  venstrestilt, selve tiden høyrestilt (byttet om fra forrige
                  runde). Kun hvit (normalt) og rødt (overtid) — farges ALDRI
                  etter posten/bolkens egen farge. */}
              <div className="sc flex items-center justify-between gap-3 flex-shrink-0">
                <div className="flex flex-col min-w-0 gap-0.5 flex-1">
                  <span className="text-[9px] font-bold text-[#555] uppercase tracking-wider">
                    Tidtaker
                  </span>
                  {/* Fikk lov til å bruke mer av boksens bredde før "…" —
                      ikke lenger en fast `max-w-[150px]`, men strekker seg
                      til det som faktisk er ledig plass til venstre for
                      selve tallet (som har `flex-shrink-0` og dermed alltid
                      beholder sin fulle bredde). */}
                  <span className="text-[13px] font-medium text-[#bbb] truncate">
                    {session.active_label || "—"}
                  </span>
                </div>
                <div
                  className={`sc-val lg leading-none text-right flex-shrink-0 ${
                    activeIdx < 0 && !session.running && session.total_secs === 0
                      ? "text-[#333]"
                      : isOvertime
                      ? "text-[#f87171]"
                      : "text-white"
                  }`}
                >
                  {activeIdx < 0 && !session.running && session.total_secs === 0
                    ? "--:--"
                    : (isOvertime ? "+" : "") + fmt(isOvertime ? Math.abs(rem) : absRem)}
                </div>
              </div>

              <div className="flex items-center justify-between bg-[#080808] border border-[#1e1e1e] rounded-lg px-3.5 py-2.5 flex-shrink-0">
                <span className="status-label">Status</span>
                <span
                  className={`status-pill ${
                    absStatus < 2
                      ? "text-[#555] border-[#1e1e1e]"
                      : liveStatus > 0
                      ? "text-[#f87171] border-[#4a1515] bg-[#1a0808]"
                      : "text-[#4ade80] border-[#1a4a2a] bg-[#0a1f0a]"
                  }`}
                >
                  {absStatus < 2 ? "0:00" : (liveStatus > 0 ? "+" : "-") + fmt(absStatus)}
                </span>
              </div>

              {/* Transport */}
              <div className="panel gap-2.5 flex-shrink-0">
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
                    Neste: {nextItemData.name} ({fmtDuration(nextItemData.duration_secs)})
                  </div>
                )}
              </div>

              {/* Melding — nå kompakt (én linje) i stedet for et alltid synlig
                  tekstfelt. Bytter mellom "skriv melding"-visning og "aktiv
                  melding"-visning, så boksen aldri utvider seg og man ikke
                  kan sende en ny melding før den aktive er fjernet. */}
              <div className="panel gap-2 py-3 px-4 flex-shrink-0">
                <div className="ptitle">Melding til visningsskjerm</div>
                {session.message ? (
                  <div className="flex items-center gap-2 bg-[#0d1f0d] border border-[#1a4a1a] rounded-lg px-2.5 py-2">
                    <div className="flex-1 min-w-0 text-xs text-[#4ade80] italic truncate">
                      {session.message}
                    </div>
                    <button className="btn xs flex-shrink-0" onClick={clearMsg}>
                      Fjern
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      className="input"
                      placeholder="Skriv en melding…"
                      value={msgInput}
                      onChange={(e) => setMsgInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && msgInput.trim() && sendMsg()}
                    />
                    <button
                      className="btn blue xs flex-shrink-0"
                      onClick={sendMsg}
                      disabled={!msgInput.trim()}
                    >
                      Send
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
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
        /* Skjuler nettleserens opp/ned-piler på tall-felt, slik at selve
           tallet faktisk midtstiller seg i feltet (pilene tar ellers plass
           til høyre og dytter den synlige teksten ut av senter). */
        .input.no-spinner::-webkit-outer-spin-button,
        .input.no-spinner::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .input.no-spinner {
          -moz-appearance: textfield;
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
        .btn.purple {
          background: #241040;
          border-color: #3d1e70;
          color: #c4b5fd;
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
        .sc-val.lg {
          font-size: 42px;
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
          color: #888;
        }
        .t-reset:hover:not(:disabled) {
          background: #1c1c1c;
          border-color: #3a3a3a;
          color: #d8d8d8;
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
          color: #888;
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
  return secs > 0 ? fmtDuration(secs) : "";
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
  newClock,
  isLate,
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
  newClock: string;
  isLate: boolean;
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
        {/* Tre FASTE kolonner (Varighet / Planlagt / Ny tid) — alltid
            rendret med samme bredde, med "–" som plassholder når det ikke
            finnes data ennå, slik at raden aldri endrer form/bredde når man
            trykker Start og feltene fylles med faktiske klokkeslett. Litt
            mer luft + tynne skillestreker mellom dem, samme mønster som
            kolonneoverskriftene over. */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <span className="text-[10px] text-[#3a3a3a] font-mono w-[100px] text-right truncate">
            {fmtDuration(item.duration_secs)}
          </span>
          <span className="text-[10px] text-[#3a3a3a] font-mono w-[46px] text-right border-l border-[#242424] pl-2.5">
            {clock || "–"}
          </span>
          <span
            className={`text-[10px] font-mono w-[46px] text-right border-l border-[#242424] pl-2.5 ${
              newClock && newClock !== clock ? (isLate ? "text-[#f87171]" : "text-[#4ade80]") : "text-[#3a3a3a]"
            }`}
          >
            {newClock || clock || "–"}
          </span>
        </div>
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
