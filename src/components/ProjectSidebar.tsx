"use client";

export interface ProjectOption {
  id: string;
  name: string;
  updated_at: string;
}

export default function ProjectSidebar({
  projects,
  currentId,
  onSelect,
  onCreate,
}: {
  projects: ProjectOption[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="hidden md:flex flex-col w-[190px] flex-shrink-0 gap-3 sticky top-4 self-start max-h-[calc(100vh-2rem)]">
      <button
        className="rounded-lg border border-[#1e3a70] bg-[#0d1f40] text-[#93c5fd] text-xs font-semibold py-2.5 hover:bg-[#123058] transition-colors"
        onClick={onCreate}
      >
        + Nytt prosjekt
      </button>
      <div className="flex flex-col gap-0.5 overflow-y-auto pr-0.5">
        <div className="text-[9px] font-bold text-[#444] uppercase tracking-wider px-1.5 mb-1">
          Prosjekter
        </div>
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
  );
}
