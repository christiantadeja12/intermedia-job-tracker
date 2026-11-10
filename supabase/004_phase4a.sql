-- Little Ocean of Achievements: Phase 4A database changes.
-- Run this AFTER schema.sql and 002_app_connection.sql, in the Supabase SQL Editor. Safe to run more than once.
-- Before running it, read "Phase 4A: what changes for you" in docs/DEPLOYMENT.md: after it, every staff
-- account needs an authenticator app code (MFA) to see the fish or open the therapist area.

-- ---------- 1. Private aquarium ----------
--
-- Before: anyone with the site address could read the share-safe fish list and milestones.
-- After:  only signed-in staff can. Signed-out visitors see a welcome screen instead of the fish.
--         Families will see only their own child's fish through a private link (Phase 4C).
-- Themes and display settings stay readable, so the welcome screen still shows the seasonal look.

create or replace view public.public_fish as
  select f.id, f.nickname, f.species, f.palette, f.personality, f.sort_order,
         1 + coalesce(sum(a.units) filter (where a.status = 'active'), 0)::int / 10 as level,
         coalesce(sum(a.units) filter (where a.status = 'active'), 0)::int % 10 as current_units,
         coalesce(sum(a.units) filter (where a.status = 'active'), 0)::int as lifetime_units,
         c.share_consent and c.archived_at is null as sharing
  from public.fish f
  join public.clients c on c.id = f.client_id
  left join public.achievements a on a.fish_id = f.id
  where f.archived_at is null and public.is_staff()
  group by f.id, c.id;

create or replace view public.public_milestones as
  select a.fish_id, 'achievement'::text as kind, a.achieved_at as date, a.title, a.public_description as description, a.units, null::int as to_level, a.created_at as sort_key
  from public.achievements a join public.fish f on f.id = a.fish_id join public.clients c on c.id = f.client_id
  where a.status = 'active' and a.public_visible and c.share_consent and f.archived_at is null and c.archived_at is null and public.is_staff()
  union all
  select e.fish_id, 'evolution', e.achieved_on, null, null, null, e.to_level, e.occurred_at
  from public.evolutions e join public.fish f on f.id = e.fish_id join public.clients c on c.id = f.client_id
  where e.reversed_at is null and c.share_consent and f.archived_at is null and public.is_staff();

-- Signed-out visitors can no longer ask for these views at all (the staff check above is a second lock).
revoke all on public.public_fish, public.public_milestones from public, anon;
grant select on public.public_fish, public.public_milestones to authenticated;

-- ---------- 2. Two-step sign-in (MFA) for all staff ----------
-- Staff rights now need a session that passed the authenticator-app step ("aal2"), not just the password.
-- The app walks each staff member through setting this up the first time they sign in.
-- Locked out (lost phone)? See "If someone loses their authenticator" in docs/DEPLOYMENT.md.
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.staff where user_id = auth.uid());
$$;
create or replace function public.is_therapist() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.staff where user_id = auth.uid() and role = 'therapist');
$$;
