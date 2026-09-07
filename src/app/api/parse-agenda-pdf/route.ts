import Anthropic from "@anthropic-ai/sdk";

// Denne route-handleren kjører KUN på Vercel sin server, aldri i
// nettleseren — det er poenget: ANTHROPIC_API_KEY (lagt inn som
// miljøvariabel i Vercel, IKKE prefikset med NEXT_PUBLIC_) er dermed
// aldri synlig for noen som åpner appen. Klienten (ControlPanel.tsx)
// sender bare selve PDF-filen hit som base64, og får en strukturert
// liste over program-punkter tilbake.
//
// Oppsett brukeren selv må gjøre (kan ikke gjøres herfra, ingen
// nettverkstilgang til Anthropic/Vercel fra Claude-sandkassen):
//   1. Opprett en API-nøkkel på https://console.anthropic.com
//   2. Legg den inn i Vercel: Project → Settings → Environment Variables
//      → navn "ANTHROPIC_API_KEY", verdi = nøkkelen din
//   3. Redeploy prosjektet (eller bare push en ny commit) slik at Vercel
//      faktisk tar i bruk den nye miljøvariabelen.

// Overstyres via miljøvariabelen ANTHROPIC_PARSE_MODEL hvis Anthropic
// noen gang endrer/pensjonerer denne modell-IDen — se
// https://docs.claude.com/en/docs/about-claude/models for gjeldende liste.
const MODEL = process.env.ANTHROPIC_PARSE_MODEL || "claude-sonnet-4-5";

const MAX_BASE64_CHARS = 20_000_000; // grovt vern mot ekstremt store filer

interface ParsedItem {
  type?: string;
  name?: string;
  minutes?: number;
  note?: string;
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          "PDF-import er ikke satt opp ennå — mangler ANTHROPIC_API_KEY på serveren. Se README/statusnotat for oppsett, eller bruk Excel/CSV-import i mellomtiden.",
      },
      { status: 500 }
    );
  }

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

  try {
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: fileBase64,
              },
            },
            {
              type: "text",
              text:
                "Dette er et program/rundskjema for et arrangement (bryllup, konferanse, TV-opptak e.l.). " +
                "Les gjennom hele dokumentet og lag en strukturert liste over alle punkter og eventuelle " +
                "bolker/seksjoner, i kronologisk rekkefølge.\n\n" +
                "Svar KUN med gyldig JSON (ingen forklaringstekst før eller etter, ingen \\`\\`\\`-blokk), " +
                "som et array av objekter på denne formen:\n" +
                '- Et punkt: {"type":"item","name":"...","minutes":15,"note":""}\n' +
                '- En bolk/seksjon (gruppeoverskrift uten egen varighet): {"type":"section","name":"..."}\n\n' +
                "Regler:\n" +
                '- "minutes" er varigheten i minutter (desimaltall er greit, f.eks 7.5). Gjett et rimelig ' +
                "anslag (typisk 5–15 min) hvis varighet ikke er oppgitt eksplisitt, i stedet for å utelate punktet.\n" +
                '- "note" er valgfri tilleggsinfo (f.eks. hvem som gjør noe) — sett til tom streng hvis ' +
                "ingenting relevant.\n" +
                "- Ikke ta med sammendrag, dokument-overskrifter eller metadata som ikke er et faktisk " +
                "programpunkt.\n" +
                "- Behold rekkefølgen fra dokumentet.",
            },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text : "";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return Response.json(
        { error: "Klarte ikke å tolke PDF-en. Prøv en tydeligere fil, eller bruk CSV-import i stedet." },
        { status: 422 }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return Response.json({ error: "Klarte ikke å tolke svaret fra AI-en. Prøv igjen." }, { status: 422 });
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return Response.json({ error: "Fant ingen programpunkter i denne PDF-en." }, { status: 422 });
    }

    // Enkel opprydding/validering før vi sender det videre til klienten —
    // klienten bekrefter uansett med brukeren før noe faktisk legges inn.
    const items: ParsedItem[] = (parsed as unknown[])
      .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
      .map((r) => ({
        type: typeof r.type === "string" ? r.type : "item",
        name: typeof r.name === "string" ? r.name : "",
        minutes: typeof r.minutes === "number" ? r.minutes : Number(r.minutes) || undefined,
        note: typeof r.note === "string" ? r.note : "",
      }))
      .filter((r) => r.name.trim().length > 0);

    if (items.length === 0) {
      return Response.json({ error: "Fant ingen programpunkter i denne PDF-en." }, { status: 422 });
    }

    return Response.json({ items });
  } catch (err) {
    console.error("PDF-import (AI-tolkning) feilet:", err);
    return Response.json(
      { error: "Noe gikk galt ved tolkning av PDF-en. Prøv igjen senere, eller bruk CSV-import i stedet." },
      { status: 500 }
    );
  }
}
