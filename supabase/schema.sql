-- Prodpilot – Supabase-skjema
-- Kjør dette i Supabase Dashboard → SQL Editor (eller via `supabase db push`).
-- Trygt å kjøre flere ganger (bruker "if not exists" der det er mulig).

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- PROGRAMS: lagrede/gjenbrukbare programmaler (Lagre/Last i kontrollpanelet)
-- ─────────────────────────────────────────────────────────────
create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  schedule_ms bigint,
  agenda jsonb not null default '[]'::jsonb
);

-- ─────────────────────────────────────────────────────────────
-- SESSIONS: én rad per aktiv "visning" (én show/kveld).
-- Kontrollpanelet er master og skriver hele tilstanden hit.
-- Visningsskjerm og fjernkontroll leser/abonnerer og regner tid lokalt.
-- ─────────────────────────────────────────────────────────────
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Nytt program',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- timer-tilstand
  running boolean not null default false,
  total_secs integer not null default 0,
  started_at timestamptz,
  paused_rem numeric not null default 0,
  accumulated numeric not null default 0,

  -- tidsplan
  program_start_ms bigint not null default 0,
  program_scheduled_ms bigint not null default 0,
  scheduled_offset_secs integer not null default 0,
  active_idx integer not null default -1,

  -- denormalisert aktivt-punkt-info (rask lesing for visningsskjerm/fjernkontroll)
  active_label text not null default '',
  active_note text not null default '',
  active_color text not null default '#6366f1',
  active_section text not null default '',

  -- utseende / melding
  bg text not null default 'dark' check (bg in ('dark','yellow','red','green')),
  message text not null default '',
  logo_url text,

  program_id uuid references programs(id) on delete set null
);

-- ─────────────────────────────────────────────────────────────
-- AGENDA_ITEMS: det levende programmet (punkter + bolker) for en sesjon
-- ─────────────────────────────────────────────────────────────
create table if not exists agenda_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  position integer not null,
  is_section boolean not null default false,
  name text not null,
  duration_secs integer not null default 0,
  note text not null default '',
  color text not null default '#6366f1',
  created_at timestamptz not null default now()
);

create index if not exists agenda_items_session_position_idx
  on agenda_items (session_id, position);

-- ─────────────────────────────────────────────────────────────
-- updated_at-triggere
-- ─────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sessions_set_updated_at on sessions;
create trigger sessions_set_updated_at
  before update on sessions
  for each row execute function set_updated_at();

drop trigger if exists programs_set_updated_at on programs;
create trigger programs_set_updated_at
  before update on programs
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- REALTIME: gjør at endringer pushes live til visningsskjerm/fjernkontroll
-- Pakket inn i en sjekk slik at det tåler å kjøres flere ganger — et rått
-- "alter publication ... add table" feiler hvis tabellen allerede er lagt
-- til fra en tidligere kjøring.
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions'
  ) then
    alter publication supabase_realtime add table sessions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agenda_items'
  ) then
    alter publication supabase_realtime add table agenda_items;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- MVP: appen har ingen innlogging ennå (samme åpne modell som det gamle
-- Firebase-oppsettet). Vi slår på RLS, men gir "anon"-nøkkelen fulle
-- rettigheter så kontrollpanel/visning/fjernkontroll fungerer uten auth.
-- Stram inn her (f.eks. med Supabase Auth + policies pr. bruker/org) når
-- appen får innlogging.
-- ─────────────────────────────────────────────────────────────
alter table sessions enable row level security;
alter table agenda_items enable row level security;
alter table programs enable row level security;

drop policy if exists "anon full access sessions" on sessions;
create policy "anon full access sessions" on sessions
  for all using (true) with check (true);

drop policy if exists "anon full access agenda_items" on agenda_items;
create policy "anon full access agenda_items" on agenda_items
  for all using (true) with check (true);

drop policy if exists "anon full access programs" on programs;
create policy "anon full access programs" on programs
  for all using (true) with check (true);

-- ─────────────────────────────────────────────────────────────
-- GRANTS
-- RLS-policyene over bestemmer HVILKE rader anon/authenticated kan røre,
-- men Postgres krever i tillegg at rollen har grunnleggende tabell-
-- rettigheter i utgangspunktet. Tabeller opprettet via SQL Editor (slik
-- disse er) får IKKE dette automatisk slik tabeller laget i Table Editor-UI-et
-- gjør — uten disse grantene feiler alle kall fra appen med
-- "permission denied for table ...".
-- ─────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.sessions, public.programs, public.agenda_items
  to anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- AUTH-MIGRASJON (2026-08-21) — innlogging + eier-styrt lagring
-- Trygt å kjøre på nytt (og trygt å kjøre FØR kontoen under er opprettet —
-- tilbakefyllingen nederst er da bare en no-op inntil den finnes).
--
-- Endrer sessions/agenda_items fra fullt åpne RLS-policyer til:
--   • Kun innlogget EIER kan OPPRETTE et nytt prosjekt, SLETTE et
--     prosjekt, eller redigere selve programmet (legge til/redigere/
--     slette punkter og bolker i agenda_items).
--   • LESING av en sesjon og programmet, OG å styre avspilling
--     (start/pause/neste/melding — alt som skjer via sessions-UPDATE),
--     forblir ÅPENT for alle som har lenken/ID-en, akkurat som i dag.
--     Dette er bevisst valgt: Fjernkontroll (/remote/[id]) og
--     Visningsskjerm (/display/[id]) skal fortsatt fungere UTEN
--     innlogging for alle man deler lenken med.
-- ─────────────────────────────────────────────────────────────

-- Ny kolonne: hvem eier prosjektet. Nullable inntil videre — eksisterende
-- rader (fra før innlogging fantes) får eier tilbakefylt lenger ned.
alter table sessions add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create index if not exists sessions_owner_id_idx on sessions (owner_id);

-- owner_id skal KUN kunne settes ved opprettelse (INSERT), aldri endres
-- via en senere UPDATE — selv om sessions-UPDATE for øvrig er åpen for
-- alle (se over), slik at en fjernkontroll-lenke ikke kan brukes til å
-- "kapre" eierskapet til et prosjekt ved å sende owner_id i en vanlig
-- avspillings-oppdatering.
create or replace function lock_owner_id() returns trigger as $$
begin
  new.owner_id = old.owner_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists sessions_lock_owner_id on sessions;
create trigger sessions_lock_owner_id
  before update on sessions
  for each row execute function lock_owner_id();

-- De gamle, fullt åpne "for all"-policyene MÅ droppes (ikke bare legges
-- til ved siden av) — Postgres slår sammen flere policyer for samme
-- operasjon med "OR", så den gamle åpne policyen ville ellers fortsatt
-- tillate alt, uansett hva de nye, strammere policyene sier.
drop policy if exists "anon full access sessions" on sessions;

create policy "sessions select open" on sessions
  for select using (true);

create policy "sessions insert own" on sessions
  for insert with check (auth.uid() = owner_id);

create policy "sessions update open" on sessions
  for update using (true) with check (true);

create policy "sessions delete own" on sessions
  for delete using (auth.uid() = owner_id);

drop policy if exists "anon full access agenda_items" on agenda_items;

create policy "agenda_items select open" on agenda_items
  for select using (true);

create policy "agenda_items insert own" on agenda_items
  for insert with check (
    session_id in (select id from sessions where owner_id = auth.uid())
  );

create policy "agenda_items update own" on agenda_items
  for update using (
    session_id in (select id from sessions where owner_id = auth.uid())
  );

create policy "agenda_items delete own" on agenda_items
  for delete using (
    session_id in (select id from sessions where owner_id = auth.uid())
  );

-- Engangs-tilbakefylling: alle eksisterende prosjekter (uten eier fra
-- før innlogging fantes) kobles til Kristoffers konto. Trygt å kjøre
-- flere ganger — rører aldri rader som allerede har fått en eier.
update sessions
set owner_id = (select id from auth.users where email = 'kristoffer.wergeland@gmail.com' limit 1)
where owner_id is null
  and exists (select 1 from auth.users where email = 'kristoffer.wergeland@gmail.com');

-- ─────────────────────────────────────────────────────────────
-- DEL PROSJEKT-MIGRASJON (2026-09-10) — flere kan redigere samme prosjekt
-- Trygt å kjøre på nytt.
--
-- Legger til en enkel "project_shares"-tabell: én rad per e-postadresse som
-- eieren har gitt REDIGERINGS-tilgang til et prosjekt. Ingen egne roller —
-- alle som er delt med kan redigere programmet akkurat som eieren (legge
-- til/endre/flytte/slette punkter og bolker), men KUN eieren kan slette
-- selve prosjektet eller dele/fjerne tilgang for andre.
-- ─────────────────────────────────────────────────────────────

create table if not exists project_shares (
  session_id uuid not null references sessions(id) on delete cascade,
  email text not null,
  shared_by_email text not null default '',
  created_at timestamptz not null default now(),
  primary key (session_id, email)
);

-- E-post lagres/sammenlignes alltid med små bokstaver — denne sjekken
-- fanger opp rader satt inn utenom appens egen lower()-normalisering.
alter table project_shares drop constraint if exists project_shares_email_lower_chk;
alter table project_shares add constraint project_shares_email_lower_chk
  check (email = lower(email));

create index if not exists project_shares_email_idx on project_shares (email);

alter table project_shares enable row level security;

-- SELECT: eieren av prosjektet ser alltid alle delinger på det. En bruker
-- som prosjektet er delt MED skal også kunne se sin egen rad (bl.a. for at
-- prosjektet skal dukke opp i "Prosjekter"-lista med "Delt av ..."), men
-- IKKE andres delinger på samme prosjekt.
drop policy if exists "project_shares select own" on project_shares;
create policy "project_shares select own" on project_shares
  for select using (
    session_id in (select id from sessions where owner_id = auth.uid())
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- INSERT/DELETE: kun eieren av prosjektet kan dele det med noen, eller
-- fjerne en deling — bortsett fra at en bruker som har fått tilgang også
-- kan fjerne SIN EGEN rad selv (dvs. "forlate" et delt prosjekt).
drop policy if exists "project_shares insert own" on project_shares;
create policy "project_shares insert own" on project_shares
  for insert with check (
    session_id in (select id from sessions where owner_id = auth.uid())
  );

drop policy if exists "project_shares delete own" on project_shares;
create policy "project_shares delete own" on project_shares
  for delete using (
    session_id in (select id from sessions where owner_id = auth.uid())
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

grant select, insert, delete on public.project_shares to anon, authenticated;

-- agenda_items: de gamle "kun eier"-policyene for insert/update/delete må
-- droppes og lages på nytt slik at de OGSÅ tillater alle som har fått
-- prosjektet delt med seg (matchet på innlogget bruker sin egen e-post via
-- auth.jwt()) — ikke bare den opprinnelige eieren.
drop policy if exists "agenda_items insert own" on agenda_items;
create policy "agenda_items insert own" on agenda_items
  for insert with check (
    session_id in (select id from sessions where owner_id = auth.uid())
    or session_id in (
      select session_id from project_shares
      where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

drop policy if exists "agenda_items update own" on agenda_items;
create policy "agenda_items update own" on agenda_items
  for update using (
    session_id in (select id from sessions where owner_id = auth.uid())
    or session_id in (
      select session_id from project_shares
      where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

drop policy if exists "agenda_items delete own" on agenda_items;
create policy "agenda_items delete own" on agenda_items
  for delete using (
    session_id in (select id from sessions where owner_id = auth.uid())
    or session_id in (
      select session_id from project_shares
      where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

-- sessions-UPDATE er (og forblir) åpent for alle med lenken (se
-- AUTH-MIGRASJON-blokken over) — det dekker allerede avspilling/redigering
-- for delte brukere, så ingen endring trengs der. sessions-DELETE forblir
-- bevisst eier-only (uendret over): en som har fått prosjektet delt med seg
-- kan redigere og "forlate" delingen (se project_shares delete-policyen),
-- men aldri slette selve prosjektet.
