"use client";

import { useEffect } from "react";

/**
 * Fanger krasj i selve rot-layouten (svært sjelden — layout.tsx gjør nesten
 * ingenting). Må inneholde egne <html>/<body>-tagger siden den erstatter
 * HELE rot-layouten når den vises.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Uventet global feil i ProdPilot:", error);
  }, [error]);

  return (
    <html lang="no" className="h-full antialiased">
      <body className="min-h-full flex items-center justify-center bg-[#080808] text-[#d8d8d8] font-sans px-6">
        <div className="max-w-md text-center flex flex-col items-center gap-4">
          <div className="text-sm text-[#fca5a5] font-semibold">
            Noe gikk galt
          </div>
          <p className="text-sm text-[#888] leading-relaxed">
            Appen støtte på en uventet feil og klarte ikke å laste.
          </p>
          <button
            className="rounded-lg border border-[#1e3a70] bg-[#0d1f40] text-[#93c5fd] text-xs font-semibold px-4 py-2.5 hover:bg-[#123058] transition-colors"
            onClick={() => reset()}
          >
            Prøv igjen
          </button>
        </div>
      </body>
    </html>
  );
}
