"use client";

import { useEffect } from "react";

/**
 * Next.js sin innebygde feilgrense for denne ruten (og alle under den:
 * "/", "/display/[id]", "/remote/[id]"). Uten denne filen viser Next.js sin
 * egen, uforståelige "This page couldn't load"-skjerm ved enhver uventet
 * krasj i klientkoden — og et vanlig sideoppfrisk løser IKKE det, fordi
 * feilen oppstår på nytt hver gang React prøver å tegne opp den samme,
 * ukorrekte tilstanden igjen.
 *
 * Denne fanger opp krasjet i stedet, viser en forklarende melding på norsk,
 * og gir en "Prøv igjen"-knapp som ber React prøve på nytt uten en full
 * reload (nyttig hvis feilen var forbigående, f.eks. et sanntids-oppdatering
 * som kom midt i en tegning), pluss en lenke tilbake til forsiden i tilfelle
 * det er selve prosjektet/sesjonen i URL-en som er årsaken.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Uventet feil i Prodpilot:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center flex flex-col items-center gap-4">
        <div className="text-sm text-[#fca5a5] font-semibold">
          Noe gikk galt
        </div>
        <p className="text-sm text-[#888] leading-relaxed">
          Siden støtte på en uventet feil og klarte ikke å tegne seg opp.
          Dette skjer noen ganger hvis data endres akkurat idet siden lastes.
          Prøv på nytt — hvis det ikke hjelper, gå tilbake til forsiden og
          velg prosjektet igjen derfra.
        </p>
        <div className="flex gap-2">
          <button
            className="rounded-lg border border-[#1e3a70] bg-[#0d1f40] text-[#93c5fd] text-xs font-semibold px-4 py-2.5 hover:bg-[#123058] transition-colors"
            onClick={() => reset()}
          >
            Prøv igjen
          </button>
          {/* Bevisst vanlig <a>, ikke next/link: en full sideinnlasting her
              er poenget — vi vil tvinge frem en helt fersk React-tilstand i
              stedet for å gjenbruke det samme (mulig ødelagte) treet. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            className="rounded-lg border border-[#2a2a2a] bg-[#141414] text-[#aaa] text-xs font-semibold px-4 py-2.5 hover:bg-[#1c1c1c] hover:text-white transition-colors"
            href="/"
          >
            Til forsiden
          </a>
        </div>
        {error?.message && (
          <p className="text-[10px] text-[#444] font-mono break-all bg-[#0e0e0e] border border-[#1e1e1e] rounded-md p-2.5">
            {error.message}
          </p>
        )}
      </div>
    </div>
  );
}
