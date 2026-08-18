-- ProdPilot – Supabase-skjema
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
-- ─────────────────────────────────────────────────────────────
alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table agenda_items;

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
