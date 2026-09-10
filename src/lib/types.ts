export type BgTheme = "dark" | "yellow" | "red" | "green";

export const COLORS = [
  "#6366f1",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#ef4444",
  "#f97316",
  "#8b5cf6",
  "#14b8a6",
  "#64748b",
];

export interface AgendaItemRow {
  id: string;
  session_id: string;
  position: number;
  is_section: boolean;
  name: string;
  duration_secs: number;
  note: string;
  color: string;
  created_at: string;
}

export type NewAgendaItem = Omit<
  AgendaItemRow,
  "id" | "session_id" | "created_at"
>;

export interface SessionRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;

  running: boolean;
  total_secs: number;
  started_at: string | null;
  paused_rem: number;
  accumulated: number;

  program_start_ms: number;
  program_scheduled_ms: number;
  scheduled_offset_secs: number;
  active_idx: number;

  active_label: string;
  active_note: string;
  active_color: string;
  active_section: string;

  bg: BgTheme;
  message: string;
  logo_url: string | null;

  program_id: string | null;

  // Hvem eier prosjektet (satt automatisk ved opprettelse). `null` for
  // gamle rader fra før innlogging fantes, inntil de er tilbakefylt via
  // engangs-migrasjonen i `supabase/schema.sql`.
  owner_id: string | null;
}

export interface AgendaSnapshotItem {
  name: string;
  is_section: boolean;
  duration_secs?: number;
  note?: string;
  color?: string;
}

// Tilgangsnivået en deling gir: "editor" kan redigere programmet akkurat
// som eieren, "viewer" kan kun se det, starte/styre avspilling og dele
// lenker videre — ikke legge til/endre/flytte/slette punkter og bolker.
export type ShareRole = "editor" | "viewer";

// En delt tilgang til et prosjekt — se "Del prosjekt" i innstillinger og
// migrasjonen for `project_shares` i `supabase/schema.sql`. E-posten er
// alltid lagret med små bokstaver (se `addShare` i ControlPanel.tsx).
export interface ShareRow {
  session_id: string;
  email: string;
  shared_by_email: string;
  role: ShareRole;
  created_at: string;
}

export interface ProgramRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  schedule_ms: number | null;
  agenda: AgendaSnapshotItem[];
}
