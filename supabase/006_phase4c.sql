-- Little Ocean of Achievements: Phase 4C database changes (private family links).
-- Run this AFTER 005_phase4b.sql, in the Supabase SQL Editor. Safe to run more than once.
--
-- Each child can have one private family link. The link carries a long random code; the database keeps only a
-- SHA-256 fingerprint of it, so the code can't be read back from here. The link shows that one child's fish and the
-- milestones the therapist approved, nothing else. Turning the link off (or making a new one) stops it at once.

create table if not exists public.family_links (
  id           uuid primary key default gen_random_uuid(),
  fish_id      uuid not null references public.fish (id),
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  revoked_at   timestamptz,
  last_used_at timestamptz
);
create index if not exists family_links_fish on public.family_links (fish_id) where revoked_at is null;
alter table public.family_links enable row level security;
drop policy if exists family_links_staff_read on public.family_links;
create policy family_links_staff_read on public.family_links for select using (public.is_staff());
revoke all on public.family_links from public, anon;
grant select on public.family_links to authenticated;

-- Staff: make a new link for a child (any older link for that child stops working). Returns the code ONCE.
create or replace function public.create_family_link(p_fish uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text; v_nick text;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select nickname into v_nick from fish where id = p_fish and archived_at is null;
  if v_nick is null then raise exception 'fish not found'; end if;
  -- 64 hex characters from two random UUIDs (about 244 random bits): impossible to guess.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update family_links set revoked_at = now() where fish_id = p_fish and revoked_at is null;
  insert into family_links (fish_id, token_hash) values (p_fish, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'));
  insert into audit_events (action, entity, entity_id, fish_id, summary)
  values ('family_link.created', 'fish', p_fish, p_fish, 'Made a new family link for ' || v_nick);
  return v_token;
end $$;

-- Staff: turn a child's family link off.
create or replace function public.revoke_family_link(p_fish uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_nick text; v_n int;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select nickname into v_nick from fish where id = p_fish;
  update family_links set revoked_at = now() where fish_id = p_fish and revoked_at is null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into audit_events (action, entity, entity_id, fish_id, summary)
    values ('family_link.revoked', 'fish', p_fish, p_fish, 'Turned off the family link for ' || coalesce(v_nick, 'a fish'));
  end if;
end $$;

-- Anyone holding a valid code: that one child's share-safe aquarium view. Wrong, old or turned-off codes get null.
create or replace function public.family_view(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l family_links; f fish; v_units int; v_items jsonb;
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
  return jsonb_build_object(
    'fish', jsonb_build_object('id', f.id, 'nickname', f.nickname, 'species', f.species, 'palette', f.palette, 'persona', f.personality,
                               'level', 1 + v_units / 10, 'currentUnits', v_units % 10, 'lifetimeUnits', v_units, 'order', 0, 'sharing', true),
    'items', (select coalesce(jsonb_agg(i - 'k'), '[]') from jsonb_array_elements(v_items) i));
end $$;

revoke all on function public.create_family_link(uuid), public.revoke_family_link(uuid), public.family_view(text) from public, anon;
grant execute on function public.create_family_link(uuid), public.revoke_family_link(uuid) to authenticated;
grant execute on function public.family_view(text) to anon, authenticated;
