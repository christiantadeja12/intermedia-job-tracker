-- Little Ocean of Achievements: Family PEO bubbles (Phase 2 of the Family View enhancements).
-- Run in the Supabase SQL Editor AFTER 011_family_house.sql. Safe to run more than once.
--
-- Three bubbles (Person, Environment, Occupation) float in each family's aquarium. A therapist sets each bubble's size
-- (1 to 5, the emphasis it has for that family) and colour. Stored per child in family_homes.peo, for example:
--   {"person": {"size": 4, "color": "#7ccf8a"}, "environment": {...}, "occupation": {...}}
-- Only a therapist can change it (set_family_peo); the family link view reads it through family_view.

alter table public.family_homes add column if not exists peo jsonb;

create or replace function public.set_family_peo(p_fish uuid, p_peo jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_nick text; k text; v jsonb; v_clean jsonb := '{}'::jsonb;
begin
  if not is_therapist() then raise exception 'not allowed' using errcode = '42501'; end if;
  select nickname into v_nick from fish where id = p_fish and archived_at is null;
  if v_nick is null then raise exception 'fish not found'; end if;
  foreach k in array array['person', 'environment', 'occupation'] loop
    v := p_peo -> k;
    if v is null or jsonb_typeof(v) <> 'object' then raise exception 'missing bubble %', k; end if;
    if coalesce(v ->> 'size', '') !~ '^[1-5]$' then raise exception 'size must be 1 to 5'; end if;
    if coalesce(v ->> 'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'colour must look like #aabbcc'; end if;
    v_clean := v_clean || jsonb_build_object(k, jsonb_build_object('size', (v ->> 'size')::int, 'color', lower(v ->> 'color')));
  end loop;
  insert into family_homes (fish_id, peo) values (p_fish, v_clean)
  on conflict (fish_id) do update set peo = excluded.peo, updated_at = now(), updated_by = auth.uid();
  insert into audit_events (action, entity, entity_id, fish_id, summary)
  values ('family_peo.updated', 'fish', p_fish, p_fish, 'Changed the family bubbles for ' || v_nick);
end $$;
revoke all on function public.set_family_peo(uuid, jsonb) from public, anon;
grant execute on function public.set_family_peo(uuid, jsonb) to authenticated;

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
    'peo', v_home.peo,
    'items', (select coalesce(jsonb_agg(i - 'k'), '[]') from jsonb_array_elements(v_items) i));
end $$;

revoke all on function public.family_view(text) from public, anon;
grant execute on function public.family_view(text) to anon, authenticated;
