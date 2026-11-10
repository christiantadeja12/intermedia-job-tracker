-- Little Ocean of Achievements: Family fish house (Phase 1 of the Family View enhancements).
-- Run in the Supabase SQL Editor AFTER 008_categories.sql (and 009/010 if you use them). Safe to run more than once.
--
-- Each child's family aquarium shows a house and a fence chosen by a therapist. One row per child; the family link view
-- reads it through family_view (below). Only a therapist can change it (set_family_home); assistants cannot.
-- fence is null until a therapist chooses one: porous, rigid or healthy.

create table if not exists public.family_homes (
  fish_id    uuid primary key references public.fish (id),
  house      text not null default 'cottage' check (house in ('cottage', 'cabin', 'shell', 'lighthouse')),
  fence      text check (fence in ('porous', 'rigid', 'healthy')),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.family_homes enable row level security;
drop policy if exists family_homes_staff_read on public.family_homes;
create policy family_homes_staff_read on public.family_homes for select using (public.is_staff());
revoke all on public.family_homes from public, anon;
grant select on public.family_homes to authenticated;

create or replace function public.set_family_home(p_fish uuid, p_house text, p_fence text)
returns void language plpgsql security definer set search_path = public as $$
declare v_nick text;
begin
  if not is_therapist() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_house not in ('cottage', 'cabin', 'shell', 'lighthouse') then raise exception 'unknown house'; end if;
  if p_fence is not null and p_fence not in ('porous', 'rigid', 'healthy') then raise exception 'unknown fence'; end if;
  select nickname into v_nick from fish where id = p_fish and archived_at is null;
  if v_nick is null then raise exception 'fish not found'; end if;
  insert into family_homes (fish_id, house, fence) values (p_fish, p_house, p_fence)
  on conflict (fish_id) do update set house = excluded.house, fence = excluded.fence, updated_at = now(), updated_by = auth.uid();
  insert into audit_events (action, entity, entity_id, fish_id, summary)
  values ('family_home.updated', 'fish', p_fish, p_fish, 'Changed the fish house for ' || v_nick);
end $$;
revoke all on function public.set_family_home(uuid, text, text) from public, anon;
grant execute on function public.set_family_home(uuid, text, text) to authenticated;

-- Anyone holding a valid code: that one child's share-safe aquarium view. Wrong, old or turned-off codes get null.
create or replace function public.family_view(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l family_links; f fish; v_units int; v_items jsonb; v_home family_homes;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into l from family_links where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and revoked_at is null;
  if l.id is null then return null; end if;
  select * into f from fish where id = l.fish_id and archived_at is null;
  if f.id is null then return null; end if;
  update family_links set last_used_at = now() where id = l.id and (last_used_at is null or last_used_at < now() - interval '1 hour');
  select coalesce(sum(units), 0)::int into v_units from achievements where fish_id = f.id and status = 'active';
  select coalesce(jsonb_agg(x order by x ->> 'k' desc), '[]') into v_items from (
    select jsonb_build_object('type', 'a', 'date', a.achieved_at, 'title', a.title, 'desc', a.public_description, 'units', a.units,
                              'k', a.achieved_at::text || '|' || a.created_at::text) as x
      from achievements a where a.fish_id = f.id and a.status = 'active' and a.public_visible
    union all
    select jsonb_build_object('type', 'e', 'date', e.achieved_on, 'to', e.to_level, 'k', e.achieved_on::text || '|~' || lpad(e.to_level::text, 3, '0'))
      from evolutions e where e.fish_id = f.id and e.reversed_at is null
  ) s;
  select * into v_home from family_homes where fish_id = f.id;
  return jsonb_build_object(
    'fish', jsonb_build_object('id', f.id, 'nickname', f.nickname, 'species', f.species, 'palette', f.palette, 'persona', f.personality,
                               'level', 1 + v_units / 10, 'currentUnits', v_units % 10, 'lifetimeUnits', v_units, 'order', 0, 'sharing', true),
    'home', jsonb_build_object('house', coalesce(v_home.house, 'cottage'), 'fence', v_home.fence),
    'items', (select coalesce(jsonb_agg(i - 'k'), '[]') from jsonb_array_elements(v_items) i));
end $$;

revoke all on function public.family_view(text) from public, anon;
grant execute on function public.family_view(text) to anon, authenticated;
