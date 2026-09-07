import { PDFParse } from "pdf-parse";

// Denne route-handleren kjører KUN på Vercel sin server, aldri i
// nettleseren. Den leser ut ren tekst fra PDF-en (med pdf-parse/pdf.js)
// og gjetter seg til punkter/bolker med enkle, faste regler — INGEN AI,
// INGEN API-nøkkel, INGEN kostnad. Klienten (ControlPanel.tsx) sender
// bare selve PDF-filen hit som base64, og får en strukturert liste over
// program-punkter tilbake, akkurat som før — brukeren bekrefter alltid
// før noe faktisk legges inn, siden en automatisk lesing kan bomme på
// enkelttall.

export const runtime = "nodejs";

const MAX_BASE64_CHARS = 20_000_000; // grovt vern mot ekstremt store filer

interface ParsedItem {
  type: "item" | "section";
  name: string;
  minutes?: number;
  note?: string;
}

// Gjenkjenner klokkeslett som "17:00" eller "17.00".
const TIME_RE = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/;
// Gjenkjenner varighet som "30 min", "5 minutter", "7,5 min".
const DURATION_RE = /(\d+(?:[.,]\d+)?)\s*min(?:utter)?\b/i;
// En egen bolk-linje, f.eks. "BOLK: Velkomst" eller "Seksjon - Middag".
const SECTION_PREFIX_RE = /^(bolk|seksjon|del|avsnitt)\s*[:.\-–]?\s*(.*)$/i;

/** Enkel, regelbasert tolkning av ren tekst fra en program-PDF til en
 * liste med punkter/bolker — se forklaring i modul-kommentaren over. */
function heuristicParseAgendaText(text: string): ParsedItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•*•]\s*/, "").trim())
    .filter((l) => l.length > 0);

  const items: ParsedItem[] = [];

  for (const line of lines) {
    const sectionMatch = line.match(SECTION_PREFIX_RE);
    if (sectionMatch) {
      const name = sectionMatch[2].trim() || line;
      items.push({ type: "section", name });
      continue;
    }

    // Kort, rent stor-bokstav-linje uten tall/tid er trolig en bolk-
    // overskrift selv uten "BOLK:"-prefiks (f.eks. "MIDDAG").
    const hasDigit = /\d/.test(line);
    const isUpperish = line.length <= 40 && line === line.toUpperCase() && /[A-ZÆØÅ]/.test(line);
    if (!hasDigit && isUpperish) {
      items.push({ type: "section", name: line });
      continue;
    }

    let name = line;
    let minutes: number | undefined;

    const timeMatch = name.match(TIME_RE);
    if (timeMatch) {
      name = name.replace(timeMatch[0], "").trim();
    }

    const durMatch = name.match(DURATION_RE);
    if (durMatch) {
      minutes = parseFloat(durMatch[1].replace(",", "."));
      // Fjern ev. omsluttende parenteser sammen med selve treffet.
      name = name.replace(new RegExp(`\\(\\s*${escapeRegExp(durMatch[0])}\\s*\\)`, "i"), "");
      name = name.replace(durMatch[0], "");
    }

    name = name
      .replace(/^[-–:.\s]+/, "")
      .replace(/[-–:.\s]+$/, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (!name) continue;

    items.push({
      type: "item",
      name,
      minutes: minutes ?? 10,
    });
  }

  return items;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function POST(request: Request) {
  let body: { fileBase64?: string; fileName?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const fileBase64 = body?.fileBase64;
  if (!fileBase64 || typeof fileBase64 !== "string") {
    return Response.json({ error: "Ingen fil mottatt." }, { status: 400 });
  }
  if (fileBase64.length > MAX_BASE64_CHARS) {
    return Response.json({ error: "PDF-en er for stor. Prøv en mindre fil." }, { status: 400 });
  }

  let parser: PDFParse | null = null;
  try {
    const buffer = Buffer.from(fileBase64, "base64");
    parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    const rawText = textResult.text || "";

    const parsed = heuristicParseAgendaText(rawText);

    if (parsed.length === 0) {
      return Response.json(
        { error: "Fant ingen programpunkter i denne PDF-en. Sjekk at det er ren tekst (ikke et skannet bilde), eller bruk CSV-import i stedet." },
        { status: 422 }
      );
    }

    return Response.json({ items: parsed });
  } catch (err) {
    console.error("PDF-import feilet:", err);
    return Response.json(
      { error: "Noe gikk galt ved lesing av PDF-en. Prøv igjen, eller bruk CSV-import i stedet." },
      { status: 500 }
    );
  } finally {
    if (parser) await parser.destroy();
  }
}
