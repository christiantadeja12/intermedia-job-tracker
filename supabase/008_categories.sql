-- Little Ocean of Achievements: editable categories (therapy areas) for templates and stars.
-- Run this AFTER 007_phase4d.sql, in the Supabase SQL Editor. Safe to run more than once.
--
-- Before: six fixed areas. After: a goal_areas list therapists can add to, rename (English and Filipino) and hide.
-- Hiding keeps every star and template that already uses the category; it just leaves the pickers.

create table if not exists public.goal_areas (
  id          text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name_en     text not null check (char_length(btrim(name_en)) between 1 and 40),
  name_fil    text not null default '' check (char_length(name_fil) <= 40),
  sort        int not null default 1000,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
insert into public.goal_areas (id, name_en, name_fil, sort) values
  ('fine_motor',  'Fine motor',         'Pinong galaw',          10),
  ('gross_motor', 'Gross motor',        'Malaking galaw',        20),
  ('sensory',     'Sensory regulation', 'Pandama at pagkalma',   30),
  ('self_care',   'Self-care',          'Pag-aalaga sa sarili',  40),
  ('handwriting', 'Handwriting',        'Pagsulat',              50),
  ('play_social', 'Play and social',    'Laro at pakikisama',    60)
on conflict (id) do nothing;
alter table public.goal_areas enable row level security;
drop policy if exists goal_areas_staff_read on public.goal_areas;
create policy goal_areas_staff_read on public.goal_areas for select using (public.is_staff());
revoke all on public.goal_areas from public, anon;
grant select on public.goal_areas to authenticated;

-- Stars and templates now point at this list instead of a fixed set.
alter table public.achievements drop constraint if exists achievements_goal_area_check;
alter table public.achievements drop constraint if exists achievements_goal_area_fkey;
alter table public.achievements add constraint achievements_goal_area_fkey foreign key (goal_area) references public.goal_areas (id);
alter table public.milestone_templates drop constraint if exists milestone_templates_area_check;
alter table public.milestone_templates drop constraint if exists milestone_templates_area_fkey;
alter table public.milestone_templates add constraint milestone_templates_area_fkey foreign key (area) references public.goal_areas (id);

-- Therapists add or rename a category. Returns its id.
create or replace function public.save_goal_area(p_id text, p_name_en text, p_name_fil text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id text := coalesce(nullif(btrim(p_id), ''), 'ga_' || substr(md5(gen_random_uuid()::text), 1, 12)); v_old goal_areas;
begin
  if not is_therapist() then raise exception 'not allowed' using errcode = '42501'; end if;
  if exists (select 1 from goal_areas where lower(btrim(name_en)) = lower(btrim(p_name_en)) and id <> v_id and archived_at is null) then
    raise exception 'Another category already uses this name.' using errcode = '23505';
  end if;
  select * into v_old from goal_areas where id = v_id;
  insert into goal_areas (id, name_en, name_fil, sort)
  values (v_id, btrim(p_name_en), btrim(coalesce(p_name_fil, '')), coalesce((select max(sort) from goal_areas), 0) + 10)
  on conflict (id) do update set name_en = excluded.name_en, name_fil = excluded.name_fil, updated_at = now();
  insert into audit_events (action, entity, summary, before, after)
  values (case when v_old.id is null then 'category.created' else 'category.renamed' end, 'category',
          case when v_old.id is null then 'Added category ' || btrim(p_name_en) else 'Renamed category ' || v_old.name_en || ' to ' || btrim(p_name_en) end,
          case when v_old.id is null then null else jsonb_build_object('name_en', v_old.name_en, 'name_fil', v_old.name_fil) end,
          jsonb_build_object('id', v_id, 'name_en', btrim(p_name_en), 'name_fil', btrim(coalesce(p_name_fil, ''))));
  return v_id;
end $$;

-- Therapists hide or restore a category (nothing that uses it is changed).
create or replace function public.archive_goal_area(p_id text, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not is_therapist() then raise exception 'not allowed' using errcode = '42501'; end if;
  update goal_areas set archived_at = case when p_archived then now() end, updated_at = now() where id = p_id returning name_en into v_name;
  if v_name is null then raise exception 'category not found'; end if;
  insert into audit_events (action, entity, summary)
  values (case when p_archived then 'category.hidden' else 'category.restored' end, 'category', (case when p_archived then 'Hid category ' else 'Restored category ' end) || v_name);
end $$;
revoke all on function public.save_goal_area(text, text, text), public.archive_goal_area(text, boolean) from public, anon;
grant execute on function public.save_goal_area(text, text, text), public.archive_goal_area(text, boolean) to authenticated;
