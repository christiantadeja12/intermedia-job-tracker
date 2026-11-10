-- Little Ocean of Achievements: Supabase (PostgreSQL) schema with row-level security.
-- Mirrors the prototype's data rules so the GitHub build keeps the same guarantees, now enforced on the server:
--   * stars are integer half-star units (1 = half, 2 = full); 10 units = one evolution
--   * awards are idempotent (unique idempotency_key) and serialised per fish
--   * evolutions are recorded exactly once per level (unique fish_id + to_level)
--   * corrections never delete history; every change writes an append-only audit event
--   * public views expose only share-safe fields; therapist notes and client labels never leave the private tables
-- Run in the Supabase SQL editor (or `supabase db push`). Review with a qualified privacy adviser before real client use.

create extension if not exists pgcrypto;

-- ---------- Staff and roles ----------
create table public.staff (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  role         text not null check (role in ('therapist', 'assistant')),
  display_name text not null default '',
  created_at   timestamptz not null default now()
);
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;
create or replace function public.is_therapist() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and role = 'therapist');
$$;

-- ---------- Clients and fish (private) ----------
create table public.clients (
  id                 uuid primary key default gen_random_uuid(),
  private_label      text not null check (char_length(btrim(private_label)) between 1 and 60),
  share_consent      boolean not null default false,
  consent_updated_at timestamptz,
  created_at         timestamptz not null default now(),
  archived_at        timestamptz
);

create table public.fish (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id),
  nickname    text not null check (char_length(btrim(nickname)) between 1 and 20),
  species     text not null check (species in ('clown','puffer','angel','tang','betta','goby','butterfly','guppy')),
  palette     jsonb not null check (palette ?& array['body','fin','pat']),
  personality text not null,
  sort_order  bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);
create unique index fish_active_nickname on public.fish (lower(btrim(nickname))) where archived_at is null;

-- ---------- Achievements ledger ----------
create table public.achievements (
  id                 uuid primary key default gen_random_uuid(),
  fish_id            uuid not null references public.fish (id),
  units              smallint not null check (units in (1, 2)),
  title              text not null check (char_length(btrim(title)) between 1 and 60),
  public_description text not null check (char_length(btrim(public_description)) between 1 and 240),
  private_note       text not null default '' check (char_length(private_note) <= 1000),
  achieved_at        date not null check (achieved_at >= date '2000-01-01'),
  public_visible     boolean not null default false,
  status             text not null default 'active' check (status in ('active', 'voided', 'corrected')),
  idempotency_key    uuid not null unique,
  correction_of      uuid references public.achievements (id),
  created_by         uuid not null default auth.uid() references auth.users (id),
  created_at         timestamptz not null default now(),
  voided_at          timestamptz,
  voided_by          uuid references auth.users (id),
  void_reason        text check (void_reason is null or char_length(btrim(void_reason)) between 3 and 200)
);
create index achievements_fish on public.achievements (fish_id, achieved_at, created_at);

create table public.evolutions (
  id                       uuid primary key default gen_random_uuid(),
  fish_id                  uuid not null references public.fish (id),
  from_level               int not null,
  to_level                 int not null check (to_level = from_level + 1 and to_level >= 2),
  occurred_at              timestamptz not null default now(),
  achieved_on              date not null,
  triggering_achievement   uuid references public.achievements (id),
  reversed_at              timestamptz,
  restored_at              timestamptz,
  unique (fish_id, to_level)
);

create table public.audit_events (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor     uuid default auth.uid(),
  action    text not null,
  entity    text,
  entity_id uuid,
  fish_id   uuid,
  summary   text not null default '',
  reason    text,
  before    jsonb,
  after     jsonb
);

-- ---------- Themes and settings (non-sensitive; readable by the aquarium) ----------
create table public.themes (
  id           text primary key,                 -- built-in ids ('christmas', ...) or 'th_...' for custom
  is_custom    boolean not null default false,
  name         text not null check (char_length(btrim(name)) between 1 and 40),
  enabled      boolean not null default true,
  priority     int not null default 30 check (priority between 0 and 100),
  config       jsonb not null default '{}',      -- water tint, effect, keep_scenery, background + decoration storage paths
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create table public.theme_schedules (
  id         uuid primary key default gen_random_uuid(),
  theme_id   text not null references public.themes (id) on delete cascade,
  start_date date not null,
  end_date   date not null,
  timezone   text not null default 'Asia/Manila',
  enabled    boolean not null default true,
  check (end_date >= start_date and end_date - start_date <= 366)
);
create table public.app_settings (
  id              int primary key default 1 check (id = 1),
  defaults        jsonb not null default '{"effects":"full","bubbles":true,"rays":true,"calm":false,"hc":false,"names":true}',
  theme_mode      text not null default 'auto' check (theme_mode in ('auto', 'manual')),
  manual_theme_id text references public.themes (id) on delete set null,
  pin_hash        text,                           -- optional device-lock PIN (PBKDF2), never readable by clients
  updated_at      timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict do nothing;

-- ---------- Derived progress (source of truth = the ledger) ----------
create or replace view public.fish_progress with (security_invoker = true) as
  select f.id as fish_id,
         coalesce(sum(a.units) filter (where a.status = 'active'), 0)::int as lifetime_units,
         1 + coalesce(sum(a.units) filter (where a.status = 'active'), 0)::int / 10 as level,
         coalesce(sum(a.units) filter (where a.status = 'active'), 0)::int % 10 as current_units
  from public.fish f left join public.achievements a on a.fish_id = f.id
  group by f.id;

-- Recompute evolutions for one fish: insert newly crossed levels once, reverse levels lost to corrections, restore regained ones.
create or replace function public.sync_fish(p_fish uuid) returns int[] language plpgsql security definer set search_path = public as $$
declare v_new int[] := '{}'; v_level int; r record;
begin
  perform pg_advisory_xact_lock(hashtext(p_fish::text));
  for r in
    with ordered as (
      select id, achieved_at, units,
             sum(units) over (order by achieved_at, created_at, id) as cum
      from achievements where fish_id = p_fish and status = 'active'
    ), crossed as (
      select o.id, o.achieved_at, gs.lvl + 1 as to_level
      from ordered o
      cross join lateral generate_series((o.cum - o.units) / 10 + 1, o.cum / 10) as gs(lvl)
    )
    select * from crossed
  loop
    insert into evolutions (fish_id, from_level, to_level, achieved_on, triggering_achievement)
    values (p_fish, r.to_level - 1, r.to_level, r.achieved_at, r.id)
    on conflict (fish_id, to_level) do update
      set reversed_at = null, restored_at = now(), achieved_on = excluded.achieved_on, triggering_achievement = excluded.triggering_achievement
      where evolutions.reversed_at is not null;
    if found then v_new := v_new || r.to_level; end if;
  end loop;
  select level into v_level from fish_progress where fish_id = p_fish;
  with undone as (
    update evolutions set reversed_at = now() where fish_id = p_fish and to_level > v_level and reversed_at is null returning to_level
  )
  insert into audit_events (action, entity, fish_id, summary)
  select 'evolution.reversed', 'evolution', p_fish, 'Level ' || to_level || ' undone because a correction lowered the stars' from undone;
  return v_new;
end $$;

-- Award stars: validated, idempotent, serialised per fish, audited, all in one transaction.
create or replace function public.award_achievement(
  p_fish uuid, p_units int, p_title text, p_public_description text, p_private_note text,
  p_achieved_at date, p_public_visible boolean, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_new int[]; v_existing uuid;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_units not in (1, 2) then raise exception 'units must be 1 (half star) or 2 (full star)'; end if;
  if p_achieved_at > (now() at time zone 'Asia/Manila')::date then raise exception 'achieved_at cannot be in the future'; end if;
  if exists (select 1 from fish where id = p_fish and archived_at is not null) then raise exception 'fish is archived'; end if;
  perform pg_advisory_xact_lock(hashtext(p_fish::text));
  select id into v_existing from achievements where idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return jsonb_build_object('achievement_id', v_existing, 'duplicate', true, 'new_levels', '[]'::jsonb);
  end if;
  insert into achievements (fish_id, units, title, public_description, private_note, achieved_at, public_visible, idempotency_key)
  values (p_fish, p_units, btrim(p_title), btrim(p_public_description), coalesce(btrim(p_private_note), ''), p_achieved_at, p_public_visible, p_idempotency_key)
  returning id into v_id;
  insert into audit_events (action, entity, entity_id, fish_id, summary, after)
  values ('achievement.awarded', 'achievement', v_id, p_fish, case p_units when 2 then '+1 star: ' else '+½ star: ' end || btrim(p_title),
          jsonb_build_object('units', p_units, 'achieved_at', p_achieved_at, 'public_visible', p_public_visible));
  v_new := sync_fish(p_fish);
  if array_length(v_new, 1) > 0 then
    insert into audit_events (action, entity, fish_id, summary) select 'evolution.recorded', 'evolution', p_fish, 'Evolved to level ' || l from unnest(v_new) l;
  end if;
  return jsonb_build_object('achievement_id', v_id, 'duplicate', false, 'new_levels', to_jsonb(v_new));
end $$;

create or replace function public.void_achievement(p_id uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fish uuid;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required'; end if;
  update achievements set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_id and status = 'active' returning fish_id into v_fish;
  if v_fish is null then raise exception 'achievement is not active'; end if;
  insert into audit_events (action, entity, entity_id, fish_id, summary, reason) values ('achievement.voided', 'achievement', p_id, v_fish, 'Voided an achievement', btrim(p_reason));
  perform sync_fish(v_fish);
  return jsonb_build_object('fish_id', v_fish);
end $$;

create or replace function public.change_achievement_units(p_id uuid, p_units int, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare a achievements; v_new uuid;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_units not in (1, 2) then raise exception 'units must be 1 or 2'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required'; end if;
  select * into a from achievements where id = p_id and status = 'active' for update;
  if a.id is null then raise exception 'achievement is not active'; end if;
  if a.units = p_units then raise exception 'pick a different amount'; end if;
  insert into achievements (fish_id, units, title, public_description, private_note, achieved_at, public_visible, idempotency_key, correction_of)
  values (a.fish_id, p_units, a.title, a.public_description, a.private_note, a.achieved_at, a.public_visible, gen_random_uuid(), a.id) returning id into v_new;
  update achievements set status = 'corrected', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) where id = a.id;
  insert into audit_events (action, entity, entity_id, fish_id, summary, reason, before, after)
  values ('achievement.points_changed', 'achievement', a.id, a.fish_id, 'Changed the stars for ' || a.title, btrim(p_reason),
          jsonb_build_object('units', a.units), jsonb_build_object('units', p_units, 'replacement', v_new));
  perform sync_fish(a.fish_id);
  return jsonb_build_object('replacement_id', v_new);
end $$;

-- ---------- Share-safe views (the only things the aquarium and family profiles read) ----------
-- These run with the owner's rights on purpose, and select only non-sensitive columns.
create or replace view public.public_fish as
  select f.id, f.nickname, f.species, f.palette, f.personality, f.sort_order,
         1 + coalesce(sum(a.units) filter (where a.status = 'active'), 0)::int / 10 as level,
         coalesce(sum(a.units) filter (where a.status = 'active'), 0)::int % 10 as current_units,
         coalesce(sum(a.units) filter (where a.status = 'active'), 0)::int as lifetime_units
  from public.fish f left join public.achievements a on a.fish_id = f.id
  where f.archived_at is null
  group by f.id;

create or replace view public.public_milestones as
  select a.fish_id, 'achievement'::text as kind, a.achieved_at as date, a.title, a.public_description as description, a.units, null::int as to_level, a.created_at as sort_key
  from public.achievements a join public.fish f on f.id = a.fish_id join public.clients c on c.id = f.client_id
  where a.status = 'active' and a.public_visible and c.share_consent and f.archived_at is null and c.archived_at is null
  union all
  select e.fish_id, 'evolution', e.achieved_on, null, null, null, e.to_level, e.occurred_at
  from public.evolutions e join public.fish f on f.id = e.fish_id join public.clients c on c.id = f.client_id
  where e.reversed_at is null and c.share_consent and f.archived_at is null;

create or replace view public.public_settings as
  select defaults, theme_mode, manual_theme_id, updated_at from public.app_settings where id = 1;

-- ---------- Row-level security ----------
alter table public.staff           enable row level security;
alter table public.clients         enable row level security;
alter table public.fish            enable row level security;
alter table public.achievements    enable row level security;
alter table public.evolutions      enable row level security;
alter table public.audit_events    enable row level security;
alter table public.themes          enable row level security;
alter table public.theme_schedules enable row level security;
alter table public.app_settings    enable row level security;

create policy staff_read_self   on public.staff for select using (user_id = auth.uid() or public.is_therapist());
create policy staff_manage      on public.staff for all using (public.is_therapist()) with check (public.is_therapist());

create policy clients_staff     on public.clients for select using (public.is_staff());
create policy clients_write     on public.clients for insert with check (public.is_staff());
create policy clients_update    on public.clients for update using (public.is_staff()) with check (public.is_staff());

create policy fish_staff        on public.fish for select using (public.is_staff());
create policy fish_write        on public.fish for insert with check (public.is_staff());
create policy fish_update       on public.fish for update using (public.is_staff()) with check (public.is_staff());

-- Achievements and evolutions change only through the functions above (no direct insert/update/delete policies).
create policy ach_staff_read    on public.achievements for select using (public.is_staff());
create policy evo_staff_read    on public.evolutions for select using (public.is_staff());

-- Audit log is append-only: staff can read it; nobody can update or delete rows through the API.
create policy audit_staff_read  on public.audit_events for select using (public.is_staff());
create policy audit_staff_add   on public.audit_events for insert with check (public.is_staff());

create policy themes_read       on public.themes for select using (true);
create policy themes_write      on public.themes for all using (public.is_therapist()) with check (public.is_therapist());
create policy sched_read        on public.theme_schedules for select using (true);
create policy sched_write       on public.theme_schedules for all using (public.is_therapist()) with check (public.is_therapist());
create policy settings_staff    on public.app_settings for select using (public.is_staff());
create policy settings_write    on public.app_settings for update using (public.is_therapist()) with check (public.is_therapist());

revoke all on public.audit_events from anon, authenticated;
grant select, insert on public.audit_events to authenticated;
revoke update, delete, truncate on public.audit_events from public, anon, authenticated;

revoke all on public.public_fish, public.public_milestones, public.public_settings from public;
grant select on public.public_fish, public.public_milestones, public.public_settings to anon, authenticated;
grant select on public.fish_progress to authenticated;

revoke execute on function public.award_achievement, public.void_achievement, public.change_achievement_units, public.sync_fish from public, anon;
grant execute on function public.award_achievement, public.void_achievement, public.change_achievement_units to authenticated;

-- ---------- Storage (theme images) ----------
-- Create a public bucket named 'theme-assets' in the dashboard, then:
--   create policy "theme assets readable"   on storage.objects for select using (bucket_id = 'theme-assets');
--   create policy "therapists upload assets" on storage.objects for insert with check (bucket_id = 'theme-assets' and public.is_therapist());
--   create policy "therapists remove assets" on storage.objects for delete using (bucket_id = 'theme-assets' and public.is_therapist());
-- Never store photos of children in this bucket: it is publicly readable.
