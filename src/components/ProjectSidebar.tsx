"use client";

import { useEffect } from "react";

export interface ProjectOption {
  id: string;
  name: string;
  updated_at: string;
  // Satt når prosjektet ikke er ens eget, men delt med en av dem (se "Del
  // prosjekt" i innstillinger) — `ownerEmail` er hvem som delte det, brukt
  // til "Delt av ..."-merkelappen under.
  isShared?: boolean;
  ownerEmail?: string;
}

/** Prosjektmeny — ligger skjult bak en knapp i toppen av siden, og åpnes som
 * en meny/skuff fra venstre i stedet for å alltid ta opp fast plass på
 * hovedsiden. */
export default function ProjectSidebar({
  open,
  onClose,
  projects,
  currentId,
  onSelect,
  onCreate,
  userEmail,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  projects: ProjectOption[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  userEmail: string;
  onSignOut: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex bg-black/70" onClick={onClose}>
      <div
        className="w-[240px] max-w-[80vw] h-full bg-[#111] border-r border-[#2a2a2a] flex flex-col gap-3 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-wider">
            Prosjekter
          </span>
          <button
            className="w-6 h-6 flex items-center justify-center rounded-full border border-[#2a2a2a] bg-[#141414] text-[#aaa] text-xs hover:bg-[#1c1c1c] hover:text-white transition-colors"
            onClick={onClose}
            aria-label="Lukk"
          >
            ✕
          </button>
        </div>

        <button
          className="rounded-lg border border-[#1e3a70] bg-[#0d1f40] text-[#93c5fd] text-xs font-semibold py-2.5 hover:bg-[#123058] transition-colors flex-shrink-0"
          onClick={onCreate}
        >
          + Nytt prosjekt
        </button>

        <div className="flex flex-col gap-0.5 overflow-y-auto pr-0.5">
          {projects.length === 0 && (
            <div className="text-[11px] text-[#7d7d7d] px-1.5">Ingen prosjekter enda.</div>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              title={p.isShared && p.ownerEmail ? `${p.name || "Uten navn"} — delt av ${p.ownerEmail}` : p.name || "Uten navn"}
              className={`text-left rounded-md px-2.5 py-2 text-xs transition-colors border ${
                p.id === currentId
                  ? "bg-[#141414] text-white border-[#2a2a2a]"
                  : "text-[#a3a3a3] hover:bg-[#0e0e0e] hover:text-[#aaa] border-transparent"
              }`}
            >
              <div className="truncate">{p.name || "Uten navn"}</div>
              {p.isShared && (
                <div className="text-[9px] text-[#6b8fc9] truncate mt-0.5">
                  Delt av {p.ownerEmail || "ukjent"}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Innlogget bruker + logg ut, nederst i skuffen. */}
        <div className="mt-auto pt-3 border-t border-[#1e1e1e] flex items-center justify-between gap-2 flex-shrink-0">
          <span className="text-[10px] text-[#8a8a8a] truncate" title={userEmail}>
            {userEmail}
          </span>
          <button
            onClick={onSignOut}
            className="text-[10px] text-[#a3a3a3] hover:text-[#f87171] transition-colors flex-shrink-0"
          >
            Logg ut
          </button>
        </div>
      </div>
    </div>
  );
}
