-- Little Ocean of Achievements: Phase 4B database changes.
-- Run this AFTER 004_phase4a.sql, in the Supabase SQL Editor. Safe to run more than once.

-- ---------- Philippine sea-life looks ----------
-- Three new looks that unlock as a fish grows: pawikan (level 3), dugong (level 4), butanding (level 5, Ocean Champion).
alter table public.fish drop constraint if exists fish_species_check;
alter table public.fish add constraint fish_species_check
  check (species in ('clown','puffer','angel','tang','betta','goby','butterfly','guppy','pawikan','dugong','butanding'));

-- The database checks the level too, so a modified page can't skip it.
-- A fish that later drops a level keeps the look it already has. Backup restores (lo.restoring) are let through.
create or replace function public.check_special_species() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_min int := case new.species when 'pawikan' then 3 when 'dugong' then 4 when 'butanding' then 5 else 1 end;
  v_level int;
begin
  if v_min = 1 or (tg_op = 'UPDATE' and new.species = old.species) or current_setting('lo.restoring', true) = 'on' then
    return new;
  end if;
  select 1 + coalesce(sum(units) filter (where status = 'active'), 0)::int / 10 into v_level
    from public.achievements where fish_id = new.id;
  if coalesce(v_level, 1) < v_min then
    raise exception 'This look unlocks at level %', v_min using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists fish_special_species on public.fish;
create trigger fish_special_species before insert or update of species on public.fish
  for each row execute function public.check_special_species();
