"use client";

import { RefObject, useEffect } from "react";
import { SessionRow } from "@/lib/types";

function LinkRow({
  label,
  disabled,
  copied,
  onOpen,
  onCopy,
}: {
  label: string;
  disabled: boolean;
  copied: boolean;
  onOpen: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-[#aaa]">{label}</span>
      <div className="flex gap-1.5">
        <button className="btn xs" onClick={onOpen} disabled={disabled}>
          Åpne
        </button>
        <button className="btn xs" onClick={onCopy} disabled={disabled}>
          {copied ? "Kopiert!" : "Kopier"}
        </button>
      </div>
    </div>
  );
}

export default function ProjectSettingsModal({
  session,
  onClose,
  nameDraft,
  onNameDraftChange,
  onNameBlur,
  setBg,
  logoInputRef,
  onLogoChange,
  onRemoveLogo,
  schedDate,
  setSchedDate,
  schedTime,
  setSchedTime,
  autostart,
  setAutostart,
  onSetSchedule,
  onClearSchedule,
  displayUrl,
  remoteUrl,
  copiedLink,
  onCopy,
  importStatus,
  dragOver,
  setDragOver,
  fileInputRef,
  onFile,
  onDownloadTemplate,
  onExport,
  pdfStatus,
  pdfBusy,
  pdfDragOver,
  setPdfDragOver,
  pdfInputRef,
  onPdfFile,
  onShowPdfExample,
  onDelete,
}: {
  session: SessionRow;
  onClose: () => void;
  nameDraft: string;
  onNameDraftChange: (v: string) => void;
  onNameBlur: () => void;
  setBg: (bg: SessionRow["bg"]) => void;
  logoInputRef: RefObject<HTMLInputElement | null>;
  onLogoChange: (file: File | undefined) => void;
  onRemoveLogo: () => void;
  schedDate: string;
  setSchedDate: (v: string) => void;
  schedTime: string;
  setSchedTime: (v: string) => void;
  autostart: boolean;
  setAutostart: (v: boolean) => void;
  onSetSchedule: () => void;
  onClearSchedule: () => void;
  displayUrl: string;
  remoteUrl: string;
  copiedLink: "display" | "remote" | null;
  onCopy: (which: "display" | "remote", url: string) => void;
  importStatus: string;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
  onDownloadTemplate: () => void;
  onExport: () => void;
  pdfStatus: string;
  pdfBusy: boolean;
  pdfDragOver: boolean;
  setPdfDragOver: (v: boolean) => void;
  pdfInputRef: RefObject<HTMLInputElement | null>;
  onPdfFile: (file: File) => void;
  onShowPdfExample: () => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] rounded-xl border border-[#2a2a2a] bg-[#111] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a] flex-shrink-0">
          <h3 className="text-sm font-semibold text-white">Innstillinger for prosjekt</h3>
          <button
            className="w-7 h-7 flex items-center justify-center rounded-full border border-[#2a2a2a] bg-[#141414] text-[#aaa] text-sm hover:bg-[#1c1c1c] hover:text-white transition-colors flex-shrink-0"
            onClick={onClose}
            aria-label="Lukk"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5 overflow-y-auto">
        {/* Navn */}
        <div className="panel">
          <div className="ptitle">Navn</div>
          <input
            className="input"
            value={nameDraft}
            onChange={(e) => onNameDraftChange(e.target.value)}
            onBlur={onNameBlur}
            placeholder="Navn på prosjekt"
          />
        </div>

        {/* Visningsskjerm */}
        <div className="panel">
          <div className="ptitle">Visningsskjerm</div>
          <div className="text-[10px] text-[#8a8a8a] uppercase tracking-wider mb-0.5">Bakgrunnsfarge</div>
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                ["dark", "Mørk", "#111", "#d8d8d8", "#2a2a2a"],
                ["yellow", "Gul", "#5a3000", "#fde68a", "#7a4a00"],
                ["red", "Rød", "#5a0a0a", "#fca5a5", "#7a1a1a"],
                ["green", "Grønn", "#0a3a16", "#4ade80", "#1a5a26"],
              ] as const
            ).map(([key, label, bg, color, border]) => (
              <button
                key={key}
                className="btn sm"
                style={{
                  background: bg,
                  color,
                  borderColor: border,
                  outline: session.bg === key ? "2px solid #fff" : "none",
                  outlineOffset: 2,
                }}
                onClick={() => setBg(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="text-[10px] text-[#8a8a8a] uppercase tracking-wider mt-1 mb-0.5">Logo</div>
          <div className="flex items-center gap-2">
            <button className="btn sm" onClick={() => logoInputRef.current?.click()}>
              Velg logo (PNG/JPG)
            </button>
            {session.logo_url && (
              <button className="btn xs red" onClick={onRemoveLogo}>
                Fjern logo
              </button>
            )}
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onLogoChange(e.target.files?.[0])}
          />
          {session.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={session.logo_url} alt="Logo" className="max-h-8 max-w-[110px] mt-1" />
          )}
        </div>

        {/* Starttidspunkt */}
        <div className="panel">
          <div className="ptitle">Starttidspunkt for prosjekt</div>
          <p className="text-[10px] text-[#7d7d7d] leading-relaxed">
            Sett dato og tid for første programpunkt.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <input
                className="input text-xs"
                type="date"
                value={schedDate}
                onChange={(e) => setSchedDate(e.target.value)}
              />
              <div className="text-[10px] text-[#7d7d7d] text-center mt-0.5">dato</div>
            </div>
            <div>
              <input
                className="input text-xs text-center"
                type="time"
                value={schedTime}
                onChange={(e) => setSchedTime(e.target.value)}
              />
              <div className="text-[10px] text-[#7d7d7d] text-center mt-0.5">klokkeslett</div>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer py-1">
            <input
              type="checkbox"
              checked={autostart}
              onChange={(e) => setAutostart(e.target.checked)}
              className="accent-[#4ade80]"
            />
            <span className="text-xs text-[#888]">Start automatisk på dette tidspunktet</span>
          </label>

          <div className="flex gap-1.5">
            <button className="btn green sm flex-1" onClick={onSetSchedule}>
              Sett starttid
            </button>
            {session.program_scheduled_ms > 0 && (
              <button className="btn sm flex-1" onClick={onClearSchedule}>
                Fjern
              </button>
            )}
          </div>
          {session.program_scheduled_ms > 0 && (
            <div className="text-[11px] text-[#8a8a8a]">
              Planlagt start: {new Date(session.program_scheduled_ms).toLocaleString("no-NO")}
            </div>
          )}
        </div>

        {/* Lenker */}
        <div className="panel">
          <div className="ptitle">Lenker</div>
          <LinkRow
            label="Visningsskjerm"
            disabled={!displayUrl}
            copied={copiedLink === "display"}
            onOpen={() => displayUrl && window.open(displayUrl, "_blank")}
            onCopy={() => onCopy("display", displayUrl)}
          />
          <LinkRow
            label="Fjernkontroll"
            disabled={!remoteUrl}
            copied={copiedLink === "remote"}
            onOpen={() => remoteUrl && window.open(remoteUrl, "_blank")}
            onCopy={() => onCopy("remote", remoteUrl)}
          />
        </div>

        {/* Import / eksport */}
        <div className="panel">
          <div className="ptitle">Importer / eksporter program</div>
          <div
            className={`rounded-md border border-dashed ${
              dragOver ? "border-[#2563eb] text-[#93c5fd]" : "border-[#2a2a2a] text-[#8a8a8a]"
            } p-2 text-center text-[11px] cursor-pointer transition-colors`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
            }}
          >
            {importStatus}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <button className="btn xs" onClick={onDownloadTemplate}>
              Last ned importmal
            </button>
            <button className="btn xs" onClick={onExport}>
              Eksporter program
            </button>
          </div>

          {/* PDF-import — se forklaring i ControlPanel.tsx sin versjon av
              denne boksen (samme oppførsel, delt via props). */}
          <div className="border-t border-[#1e1e1e] pt-2.5 mt-0.5">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="ptitle !mb-0">Importer fra PDF</div>
              <button className="text-[10px] text-[#93c5fd] hover:underline flex-shrink-0" onClick={onShowPdfExample}>
                Se eksempel
              </button>
            </div>
            <div className="text-[10px] text-[#8a8a8a] leading-relaxed mb-1.5">
              Fungerer best på et program med ren tekst (ikke et skannet
              bilde) — f.eks. en liste med tidspunkt/varighet og navn på
              hvert punkt, gjerne gruppert i bolker (linjer som starter
              med «BOLK:»). Mangler varighet, brukes 10 minutter som
              utgangspunkt — sjekk og juster gjerne etterpå.
            </div>
            <div
              className={`rounded-md border border-dashed ${
                pdfDragOver ? "border-[#c4b5fd] text-[#c4b5fd]" : "border-[#2a2a2a] text-[#8a8a8a]"
              } p-2 text-center text-[11px] transition-colors ${
                pdfBusy ? "opacity-60 cursor-wait" : "cursor-pointer"
              }`}
              onClick={() => !pdfBusy && pdfInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                if (!pdfBusy) setPdfDragOver(true);
              }}
              onDragLeave={() => setPdfDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setPdfDragOver(false);
                if (!pdfBusy && e.dataTransfer.files[0]) onPdfFile(e.dataTransfer.files[0]);
              }}
            >
              {pdfStatus}
            </div>
            <input
              ref={pdfInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onPdfFile(e.target.files[0])}
            />
          </div>
        </div>

        {/* Farlig sone */}
        <div className="panel">
          <div className="ptitle">Farlig sone</div>
          <button className="btn red sm w-fit" onClick={onDelete}>
            Slett prosjekt
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
