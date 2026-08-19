"use client";

import { useEffect } from "react";

export interface ProjectOption {
  id: string;
  name: string;
  updated_at: string;
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
}: {
  open: boolean;
  onClose: () => void;
  projects: ProjectOption[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
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
          <span className="text-[10px] font-bold text-[#555] uppercase tracking-wider">
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
            <div className="text-[11px] text-[#444] px-1.5">Ingen prosjekter enda.</div>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              title={p.name || "Uten navn"}
              className={`text-left rounded-md px-2.5 py-2 text-xs truncate transition-colors border ${
                p.id === currentId
                  ? "bg-[#141414] text-white border-[#2a2a2a]"
                  : "text-[#777] hover:bg-[#0e0e0e] hover:text-[#aaa] border-transparent"
              }`}
            >
              {p.name || "Uten navn"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
