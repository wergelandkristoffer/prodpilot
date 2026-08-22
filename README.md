# Prodpilot

Sanntids programstyringsverktøy for events og bryllup. Tre visninger i én app,
synkronisert via Supabase Realtime:

- **Kontrollpanel** (`/`) — desktop-verktøy for toastmaster/regissør. Bygger
  programmet (bolker + punkter), styrer timeren (Start/Pause/Reset/Forrige/Neste),
  sender meldinger og bakgrunnsfarge til visningsskjermen, lagrer/laster
  programmer, importerer fra CSV/Excel, og genererer lenker til visningsskjerm
  og fjernkontroll.
- **Visningsskjerm** (`/display/[id]`) — stor skjerm på scenen: nedtellingstimer,
  aktivt punkt, de neste tre punktene med klokkeslett, statuspill og meldinger.
- **Fjernkontroll** (`/remote/[id]`) — mobilvisning med Start/Pause/Neste, aktivt
  punkt, status og meldinger. Mobilbrukere som åpner `/` eller en
  visningsskjerm-lenke sendes automatisk hit (se `src/proxy.ts`).

Kontrollpanelet er "master" og eier timertilstanden i `sessions`-tabellen.
Visningsskjerm og fjernkontroll abonnerer på endringer via Supabase Realtime og
regner ut tid igjen lokalt fra `started_at` + `paused_rem` (ingen konstant
server-polling).

## Kom i gang

### 1. Supabase

1. Opprett et prosjekt på [supabase.com](https://supabase.com).
2. Åpne **SQL Editor** og kjør innholdet i [`supabase/schema.sql`](./supabase/schema.sql).
   Dette oppretter tabellene `sessions`, `programs`, `agenda_items`, slår på
   Realtime, og setter opp en åpen RLS-policy (appen har ingen innlogging enda
   — se merknad i skjemafilen om å stramme inn senere).
3. Kopier **Project URL** og **anon public key** fra Project Settings → API.

### 2. Miljøvariabler

```bash
cp .env.local.example .env.local
# fyll inn NEXT_PUBLIC_SUPABASE_URL og NEXT_PUBLIC_SUPABASE_ANON_KEY
```

### 3. Kjør lokalt

```bash
npm install
npm run dev
```

Åpne [http://localhost:3000](http://localhost:3000).

### 4. Deploy

Koble repoet til [Vercel](https://vercel.com), legg inn de samme
miljøvariablene under Project Settings → Environment Variables, og deploy.

## Status

Bygget så langt (se prosjektets oppgaveliste for videre arbeid):

- [x] Next.js + TypeScript + Tailwind + Supabase-oppsett
- [x] Databaseskjema (`sessions`, `programs`, `agenda_items`) + Realtime
- [x] Kontrollpanel — full funksjonalitet
- [x] Visningsskjerm — nedtelling, neste punkter, status, melding, logo
- [x] Fjernkontroll — Start/Pause/Neste, status, melding, programoversikt
- [x] Mobildeteksjon (`src/proxy.ts`) med auto-redirect til fjernkontroll

Ikke bygget enda / naturlige neste steg:

- Innlogging/auth (RLS er åpen for `anon`-nøkkelen som et MVP-valg)
- Logo lagres i dag som data-URL på sesjonen — bør flyttes til Supabase Storage
  hvis logoene blir store
- E-post (Resend) — planlagt, ikke startet
- Egen "mine sesjoner"-oversikt (i dag lager kontrollpanelet en ny sesjon per
  besøk uten `?s=`-parameter)
