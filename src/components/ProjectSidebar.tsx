"use client";

import { useEffect } from "react";
import type { ShareRole } from "@/lib/types";

export interface ProjectOption {
  id: string;
  name: string;
  updated_at: string;
  // Satt når prosjektet ikke er ens eget, men delt med en av dem (se "Del
  // prosjekt" i innstillinger) — `ownerEmail` er hvem som delte det, og
  // `myRole` er tilgangsnivået man selv har fått ("editor"/"viewer"),
  // brukt til "Delt av ..."-merkelappen og rolle-pillen under.
  isShared?: boolean;
  ownerEmail?: string;
  myRole?: ShareRole;
}

/** Meny — ligger skjult bak "Meny"-knappen i toppen av siden, og åpnes som
 * en skuff fra venstre i stedet for å alltid ta opp fast plass på
 * hovedsiden. Inneholder prosjektlisten + innlogget bruker/logg ut. */
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
        className="w-[280px] max-w-[85vw] h-full bg-[#161616] border-r border-[#2a2a2a] flex flex-col gap-3 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between flex-shrink-0">
          <span className="text-[10px] font-bold text-[#a3a3a3] uppercase tracking-wider">
            Prosjekter
          </span>
          <button
            className="w-6 h-6 flex items-center justify-center rounded-full border border-[#2a2a2a] bg-[#1c1c1c] text-[#aaa] text-xs hover:bg-[#252525] hover:text-white transition-colors"
            onClick={onClose}
            aria-label="Lukk"
          >
            ✕
          </button>
        </div>

        <button
          className="rounded-lg border border-[#2563eb]/60 bg-[#0d1f40] text-[#93c5fd] text-xs font-semibold py-2.5 hover:bg-[#123058] hover:border-[#2563eb] transition-colors flex-shrink-0"
          onClick={onCreate}
        >
          + Nytt prosjekt
        </button>

        <div className="flex flex-col gap-1.5 overflow-y-auto pr-0.5">
          {projects.length === 0 && (
            <div className="text-[11px] text-[#7d7d7d] px-1.5">Ingen prosjekter enda.</div>
          )}
          {projects.map((p) => {
            const isCurrent = p.id === currentId;
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p.id)}
                title={
                  p.isShared && p.ownerEmail ? `${p.name || "Uten navn"} — delt av ${p.ownerEmail}` : p.name || "Uten navn"
                }
                className={`text-left rounded-lg px-3 py-2.5 text-xs transition-colors border ${
                  isCurrent
                    ? "bg-[#122544] border-[#2563eb] text-white"
                    : "bg-[#1c1c1c] border-[#2a2a2a] text-[#d0d0d0] hover:bg-[#232323] hover:border-[#3a3a3a]"
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      isCurrent ? "bg-[#4ade80]" : "bg-[#3a3a3a]"
                    }`}
                  />
                  <span className="truncate font-medium">{p.name || "Uten navn"}</span>
                </div>
                {p.isShared && (
                  <div className="flex items-center gap-1 mt-1.5 pl-3 flex-wrap">
                    <span className="text-[9px] text-[#7fa8e0] bg-[#0d1f40] border border-[#1e3a70] rounded px-1.5 py-0.5 truncate max-w-full">
                      Delt av {p.ownerEmail || "ukjent"}
                    </span>
                    {p.myRole === "viewer" && (
                      <span className="text-[9px] text-[#a3a3a3] bg-[#232323] border border-[#333] rounded px-1.5 py-0.5">
                        Kan kun se
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Innlogget bruker + logg ut, nederst i skuffen. */}
        <div className="mt-auto pt-3 border-t border-[#262626] flex items-center justify-between gap-2 flex-shrink-0">
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
