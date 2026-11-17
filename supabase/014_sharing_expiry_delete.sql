-- Little Ocean of Achievements: sharing switches per child, family link duration, and deleting archived fish.
-- Run in the Supabase SQL Editor AFTER 013_evolve_at_3_5_stars.sql. Safe to run more than once.
--
-- Your existing fish, stars, evolutions, clients and audit history are NOT changed or removed by this file.
-- It only adds two switches per child, an expiry date on family links, and the "delete archived fish" function.
-- (Archived fish are only removed when a therapist presses the final button in the app.)
--
-- 1. Two switches per child replace the old tick on each achievement:
--      family_showcase    : every active milestone of this child appears in the family aquarium.
--      aquarium_showcase  : every active milestone appears on the main aquarium profile
--                           (also needs the existing family consent, share_consent, as before).
--    Both start OFF. The first time this file runs, a child's switches are turned ON only when ALL of that child's
--    active milestones were already approved, so nothing that was private becomes visible. Everything else starts
--    off and the therapist ticks the switch per child in the app.
--    The old public_visible column stays in the table (it is simply no longer used).
-- 2. Family links get an expiry: one day, one week or one month. Links made before this update never expire,
--    exactly as before, until the therapist turns them off or makes a new one.
-- 3. A therapist can permanently delete ALL archived fish, after a warning in the app.

-- ---------- 1. Sharing switches per child ----------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'clients' and column_name = 'family_showcase') then
    alter table public.clients add column family_showcase   boolean not null default false;
    alter table public.clients add column aquarium_showcase boolean not null default false;
    -- One-time carry-over: switch on only where every active milestone of the child was already approved.
    update public.clients c set
      family_showcase = true,
      aquarium_showcase = c.share_consent
    where exists (select 1 from public.achievements a join public.fish f on f.id = a.fish_id
                  where f.client_id = c.id and a.status = 'active' and a.public_visible)
      and not exists (select 1 from public.achievements a join public.fish f on f.id = a.fish_id
                      where f.client_id = c.id and a.status = 'active' and not a.public_visible);
  end if;
end $$;

-- Staff: set both switches for one child.
create or replace function public.set_client_sharing(p_fish uuid, p_family boolean, p_aquarium boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_nick text; v_client uuid; c clients;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select f.nickname, f.client_id into v_nick, v_client from fish f where f.id = p_fish;
  if v_client is null then raise exception 'fish not found'; end if;
  select * into c from clients where id = v_client for update;
  if c.family_showcase is not distinct from coalesce(p_family, false)
     and c.aquarium_showcase is not distinct from coalesce(p_aquarium, false) then return; end if;
  update clients set family_showcase = coalesce(p_family, false), aquarium_showcase = coalesce(p_aquarium, false) where id = v_client;
  insert into audit_events (action, entity, entity_id, fish_id, summary, before, after)
  values ('sharing.updated', 'fish', p_fish, p_fish, 'Changed milestone sharing for ' || v_nick,
          jsonb_build_object('family', c.family_showcase, 'aquarium', c.aquarium_showcase),
          jsonb_build_object('family', coalesce(p_family, false), 'aquarium', coalesce(p_aquarium, false)));
end $$;
revoke all on function public.set_client_sharing(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_client_sharing(uuid, boolean, boolean) to authenticated;

-- Main aquarium profile: milestones show when the family consented AND the aquarium switch is on.
create or replace view public.public_milestones as
  select a.fish_id, 'achievement'::text as kind, a.achieved_at as date, a.title, a.public_description as description, a.units, null::int as to_level, a.created_at as sort_key
  from public.achievements a join public.fish f on f.id = a.fish_id join public.clients c on c.id = f.client_id
  where a.status = 'active' and c.share_consent and c.aquarium_showcase and f.archived_at is null and c.archived_at is null and public.is_staff()
  union all
  select e.fish_id, 'evolution', e.achieved_on, null, null, null, e.to_level, e.occurred_at
  from public.evolutions e join public.fish f on f.id = e.fish_id join public.clients c on c.id = f.client_id
  where e.reversed_at is null and c.share_consent and f.archived_at is null and public.is_staff();
revoke all on public.public_milestones from public, anon;
grant select on public.public_milestones to authenticated;

-- ---------- 2. Family link duration ----------
alter table public.family_links add column if not exists expires_at timestamptz;   -- null = never expires (links made before this update)

-- Staff: make a new link that works for a day, a week or a month. Returns the code ONCE, with its expiry.
drop function if exists public.create_family_link(uuid);
create or replace function public.create_family_link(p_fish uuid, p_duration text default 'week')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_token text; v_nick text; v_days int; v_exp timestamptz;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  v_days := case p_duration when 'day' then 1 when 'week' then 7 when 'month' then 30 end;
  if v_days is null then raise exception 'unknown duration'; end if;
  select nickname into v_nick from fish where id = p_fish and archived_at is null;
  if v_nick is null then raise exception 'fish not found'; end if;
  v_exp := now() + make_interval(days => v_days);
  -- 64 hex characters from two random UUIDs (about 244 random bits): impossible to guess.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update family_links set revoked_at = now() where fish_id = p_fish and revoked_at is null;
  insert into family_links (fish_id, token_hash, expires_at) values (p_fish, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_exp);
  insert into audit_events (action, entity, entity_id, fish_id, summary)
  values ('family_link.created', 'fish', p_fish, p_fish, 'Made a new family link for ' || v_nick || ' (' || p_duration || ')');
  return jsonb_build_object('token', v_token, 'expiresAt', v_exp);
end $$;
revoke all on function public.create_family_link(uuid, text) from public, anon;
grant execute on function public.create_family_link(uuid, text) to authenticated;

-- Anyone holding a valid, unexpired code: that one child's share-safe aquarium view. Wrong, old, expired or turned-off codes get null.
-- Milestones appear only when the child's family switch is on; level-ups always appear.
create or replace function public.family_view(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l family_links; f fish; c clients; v_units int; v_items jsonb; v_home family_homes;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into l from family_links
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and revoked_at is null and (expires_at is null or expires_at > now());
  if l.id is null then return null; end if;
  select * into f from fish where id = l.fish_id and archived_at is null;
  if f.id is null then return null; end if;
  select * into c from clients where id = f.client_id;
  update family_links set last_used_at = now() where id = l.id and (last_used_at is null or last_used_at < now() - interval '1 hour');
  select coalesce(sum(units), 0)::int into v_units from achievements where fish_id = f.id and status = 'active';
  select coalesce(jsonb_agg(x order by x ->> 'k' desc), '[]') into v_items from (
    select jsonb_build_object('type', 'a', 'date', a.achieved_at, 'title', a.title, 'desc', a.public_description, 'units', a.units,
                              'k', a.achieved_at::text || '|' || a.created_at::text) as x
      from achievements a where a.fish_id = f.id and a.status = 'active' and c.family_showcase
    union all
    select jsonb_build_object('type', 'e', 'date', e.achieved_on, 'to', e.to_level, 'k', e.achieved_on::text || '|~' || lpad(e.to_level::text, 3, '0'))
      from evolutions e where e.fish_id = f.id and e.reversed_at is null
  ) s;
  select * into v_home from family_homes where fish_id = f.id;
  return jsonb_build_object(
    'fish', jsonb_build_object('id', f.id, 'nickname', f.nickname, 'species', f.species, 'palette', f.palette, 'persona', f.personality,
                               'level', 1 + v_units / public.units_per_level(), 'currentUnits', v_units % public.units_per_level(), 'lifetimeUnits', v_units, 'order', 0, 'sharing', true),
    'home', jsonb_build_object('house', coalesce(v_home.house, 'cottage'), 'fence', v_home.fence),
    'peo', v_home.peo,
    'items', (select coalesce(jsonb_agg(i - 'k'), '[]') from jsonb_array_elements(v_items) i));
end $$;
revoke all on function public.family_view(text) from public, anon;
grant execute on function public.family_view(text) to anon, authenticated;

-- ---------- 3. Permanently delete archived fish ----------
-- Therapist only. Deletes EVERY archived fish with its client record, stars, level-ups, family link, family aquarium
-- settings and its audit entries, then writes one audit entry that records only how many were deleted (no names).
-- Active fish are never touched. This cannot be undone; the app shows a warning and asks for a final confirmation first.
create or replace function public.delete_archived_fish()
returns int language plpgsql security definer set search_path = public as $$
declare v_fish uuid[]; v_clients uuid[];
begin
  if not is_therapist() then raise exception 'not allowed' using errcode = '42501'; end if;
  select array_agg(id), array_agg(distinct client_id) into v_fish, v_clients from fish where archived_at is not null;
  if v_fish is null then return 0; end if;
  delete from family_links  where fish_id = any (v_fish);
  delete from family_homes  where fish_id = any (v_fish);
  delete from evolutions    where fish_id = any (v_fish);
  update achievements set correction_of = null where fish_id = any (v_fish);
  delete from achievements  where fish_id = any (v_fish);
  delete from audit_events  where fish_id = any (v_fish);
  delete from fish          where id = any (v_fish);
  delete from clients c     where c.id = any (v_clients) and not exists (select 1 from fish where client_id = c.id);
  insert into audit_events (action, entity, summary) values ('archived.deleted', 'settings', 'Permanently deleted ' || cardinality(v_fish) || ' archived fish');
  return cardinality(v_fish);
end $$;
revoke all on function public.delete_archived_fish() from public, anon;
grant execute on function public.delete_archived_fish() to authenticated;
