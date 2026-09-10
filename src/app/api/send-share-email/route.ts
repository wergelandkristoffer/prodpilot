// Sender et enkelt varsel på e-post når noen deler et prosjekt med en
// annen e-postadresse (se "Del prosjekt" i innstillinger). Kjører KUN på
// Vercel sin server, aldri i nettleseren — bruker Resend sitt vanlige
// HTTP-API direkte (ikke SMTP, som kun Supabase Auth sin egen innlogging
// bruker) med en egen RESEND_API_KEY miljøvariabel.
//
// Best-effort: hvis dette feiler (manglende nøkkel, Resend nede, o.l.)
// skal selve delingen (raden i project_shares) IKKE regnes som mislykket —
// den er uansett allerede lagret før dette kalles, se `addShare` i
// ControlPanel.tsx. Klienten logger en feil til konsollen ved en feilet
// respons herfra, men viser ingenting skummelt til brukeren.

export const runtime = "nodejs";

const ROLE_LABELS: Record<string, string> = {
  editor: "redigere programmet",
  viewer: "se og starte programmet, og dele lenker videre",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(request: Request) {
  let body: { to?: string; projectName?: string; ownerEmail?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const to = body?.to;
  const projectName = body?.projectName || "et program";
  const ownerEmail = body?.ownerEmail || "noen";
  const role = body?.role === "viewer" ? "viewer" : "editor";

  if (!to || typeof to !== "string" || !to.includes("@")) {
    return Response.json({ error: "Ugyldig mottaker-e-post." }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Ikke satt opp ennå (se manuelt steg i statusdokumentet) — feiler
    // stille i stedet for å krasje selve delingen.
    console.error("RESEND_API_KEY er ikke satt — kan ikke sende delings-varsel.");
    return Response.json({ error: "E-postvarsling er ikke satt opp ennå." }, { status: 501 });
  }

  const roleLabel = ROLE_LABELS[role] ?? ROLE_LABELS.editor;
  const nameHtml = escapeHtml(projectName);
  const ownerHtml = escapeHtml(ownerEmail);

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a;">
      <h2 style="margin:0 0 12px;font-size:18px;">Du har fått tilgang til et Prodpilot-program</h2>
      <p style="font-size:14px;line-height:1.6;">
        <strong>${ownerHtml}</strong> ønsker å dele prosjektet
        <strong>${nameHtml}</strong> med deg på Prodpilot. Du kan
        ${roleLabel}.
      </p>
      <p style="font-size:14px;line-height:1.6;">
        Logg inn på <a href="https://prodpilot.no" style="color:#2563eb;">prodpilot.no</a>
        med denne e-postadressen (${escapeHtml(to)}) — prosjektet dukker da
        automatisk opp i din egen prosjektliste, merket «Delt av ${ownerHtml}».
      </p>
      <p style="font-size:12px;color:#888;margin-top:24px;">
        Fikk du denne e-posten ved en feil? Du kan trygt ignorere den — ingen
        konto opprettes automatisk, og ingenting skjer før du selv logger inn.
      </p>
    </div>
  `.trim();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "Prodpilot <onboarding@resend.dev>",
        to: [to],
        subject: `${ownerEmail} ønsker å dele "${projectName}" med deg på Prodpilot`,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend avviste delings-varselet:", res.status, errText);
      return Response.json({ error: "Kunne ikke sende e-post akkurat nå." }, { status: 502 });
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("Feil ved sending av delings-varsel:", err);
    return Response.json({ error: "Kunne ikke sende e-post akkurat nå." }, { status: 500 });
  }
}
