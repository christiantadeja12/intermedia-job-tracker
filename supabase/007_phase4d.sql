-- Little Ocean of Achievements: Phase 4D database changes (milestone templates, goal areas, quick awards).
-- Run this AFTER 006_phase4c.sql, in the Supabase SQL Editor. Safe to run more than once.

-- ---------- OT goal areas on each star ----------
alter table public.achievements add column if not exists goal_area text;
-- (Once 008_categories.sql has run, categories live in their own table, so this fixed list is skipped.)
do $$ begin
  if to_regclass('public.goal_areas') is null then
    alter table public.achievements drop constraint if exists achievements_goal_area_check;
    alter table public.achievements add constraint achievements_goal_area_check
      check (goal_area is null or goal_area in ('fine_motor','gross_motor','sensory','self_care','handwriting','play_social'));
  end if;
end $$;

-- A star whose size is corrected keeps its goal area (the correction is a new linked row).
create or replace function public.copy_goal_area_on_correction() returns trigger language plpgsql as $$
begin
  if new.correction_of is not null and new.goal_area is null then
    select goal_area into new.goal_area from public.achievements where id = new.correction_of;
  end if;
  return new;
end $$;
drop trigger if exists achievements_copy_goal_area on public.achievements;
create trigger achievements_copy_goal_area before insert on public.achievements for each row execute function public.copy_goal_area_on_correction();

-- award_achievement gains an optional goal area. Everything else is unchanged from schema.sql.
drop function if exists public.award_achievement(uuid, int, text, text, text, date, boolean, uuid);
create or replace function public.award_achievement(
  p_fish uuid, p_units int, p_title text, p_public_description text, p_private_note text,
  p_achieved_at date, p_public_visible boolean, p_idempotency_key uuid, p_goal_area text default null
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
  insert into achievements (fish_id, units, title, public_description, private_note, achieved_at, public_visible, idempotency_key, goal_area)
  values (p_fish, p_units, btrim(p_title), btrim(p_public_description), coalesce(btrim(p_private_note), ''), p_achieved_at, p_public_visible, p_idempotency_key, nullif(p_goal_area, ''))
  returning id into v_id;
  insert into audit_events (action, entity, entity_id, fish_id, summary, after)
  values ('achievement.awarded', 'achievement', v_id, p_fish, case p_units when 2 then '+1 star: ' else '+½ star: ' end || btrim(p_title),
          jsonb_build_object('units', p_units, 'achieved_at', p_achieved_at, 'public_visible', p_public_visible, 'goal_area', nullif(p_goal_area, '')));
  v_new := sync_fish(p_fish);
  if array_length(v_new, 1) > 0 then
    insert into audit_events (action, entity, fish_id, summary) select 'evolution.recorded', 'evolution', p_fish, 'Evolved to level ' || l from unnest(v_new) l;
  end if;
  return jsonb_build_object('achievement_id', v_id, 'duplicate', false, 'new_levels', to_jsonb(v_new));
end $$;
revoke execute on function public.award_achievement from public, anon;
grant execute on function public.award_achievement to authenticated;

-- Change the goal area of an existing star (audited).
create or replace function public.set_achievement_area(p_id uuid, p_area text)
returns void language plpgsql security definer set search_path = public as $$
declare a achievements;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into a from achievements where id = p_id and status = 'active';
  if a.id is null then raise exception 'achievement is not active'; end if;
  if a.goal_area is not distinct from nullif(p_area, '') then return; end if;
  update achievements set goal_area = nullif(p_area, '') where id = p_id;
  insert into audit_events (action, entity, entity_id, fish_id, summary, before, after)
  values ('achievement.area_changed', 'achievement', p_id, a.fish_id, 'Changed the goal area of “' || a.title || '”',
          jsonb_build_object('goal_area', a.goal_area), jsonb_build_object('goal_area', nullif(p_area, '')));
end $$;

-- ---------- Milestone templates ----------
create table if not exists public.milestone_templates (
  id          uuid primary key default gen_random_uuid(),
  area        text not null check (area in ('fine_motor','gross_motor','sensory','self_care','handwriting','play_social')),
  units       smallint not null default 2 check (units in (1, 2)),
  title_en    text not null check (char_length(btrim(title_en)) between 1 and 60),
  desc_en     text not null check (char_length(btrim(desc_en)) between 1 and 240),
  title_fil   text not null default '' check (char_length(title_fil) <= 60),
  desc_fil    text not null default '' check (char_length(desc_fil) <= 240),
  sort        int not null default 1000,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.milestone_templates enable row level security;
drop policy if exists templates_staff_read on public.milestone_templates;
create policy templates_staff_read on public.milestone_templates for select using (public.is_staff());
revoke all on public.milestone_templates from public, anon;
grant select on public.milestone_templates to authenticated;

-- Therapists add, change and hide templates. Hidden templates stay for the record.
create or replace function public.save_template(p_id uuid, p_area text, p_units int, p_title_en text, p_desc_en text, p_title_fil text, p_desc_fil text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_new boolean;
begin
  if not is_therapist() then raise exception 'not allowed' using errcode = '42501'; end if;
  v_new := not exists (select 1 from milestone_templates where id = v_id);
  insert into milestone_templates (id, area, units, title_en, desc_en, title_fil, desc_fil, sort)
  values (v_id, p_area, p_units, btrim(p_title_en), btrim(p_desc_en), btrim(coalesce(p_title_fil, '')), btrim(coalesce(p_desc_fil, '')),
          coalesce((select max(sort) from milestone_templates where area = p_area), 0) + 10)
  on conflict (id) do update set area = excluded.area, units = excluded.units, title_en = excluded.title_en, desc_en = excluded.desc_en,
    title_fil = excluded.title_fil, desc_fil = excluded.desc_fil, updated_at = now();
  insert into audit_events (action, entity, entity_id, summary)
  values (case when v_new then 'template.created' else 'template.updated' end, 'template', v_id, (case when v_new then 'Added template ' else 'Changed template ' end) || btrim(p_title_en));
  return v_id;
end $$;
create or replace function public.archive_template(p_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_title text;
begin
  if not is_therapist() then raise exception 'not allowed' using errcode = '42501'; end if;
  update milestone_templates set archived_at = case when p_archived then now() end, updated_at = now() where id = p_id returning title_en into v_title;
  if v_title is null then raise exception 'template not found'; end if;
  insert into audit_events (action, entity, entity_id, summary)
  values (case when p_archived then 'template.hidden' else 'template.restored' end, 'template', p_id, (case when p_archived then 'Hid template ' else 'Restored template ' end) || v_title);
end $$;
revoke all on function public.set_achievement_area(uuid, text), public.save_template(uuid, text, int, text, text, text, text), public.archive_template(uuid, boolean) from public, anon;
grant execute on function public.set_achievement_area(uuid, text), public.save_template(uuid, text, int, text, text, text, text), public.archive_template(uuid, boolean) to authenticated;

-- Starter templates (only added once; edit or hide them in the therapist area).
insert into public.milestone_templates (id, area, units, title_en, desc_en, title_fil, desc_fil, sort) values
  ('00000000-0000-4d00-8000-000000000001', 'fine_motor', 1, 'Stacked 5 blocks', 'I built a tower of five blocks!', 'Nakapagpatong ng 5 bloke', 'Gumawa ako ng tore na may limang bloke!', 10),
  ('00000000-0000-4d00-8000-000000000002', 'fine_motor', 2, 'Cut along a line', 'I cut along the line with my scissors.', 'Gumupit sa linya', 'Ginupit ko ang papel sa linya gamit ang gunting.', 20),
  ('00000000-0000-4d00-8000-000000000003', 'fine_motor', 1, 'Threaded beads', 'I put beads on a string all by myself.', 'Nagtuhog ng beads', 'Ako mismo ang nagtuhog ng beads sa tali.', 30),
  ('00000000-0000-4d00-8000-000000000004', 'fine_motor', 1, 'Pinched and picked up', 'I picked up small things with my fingertips.', 'Pumulot gamit ang daliri', 'Pinulot ko ang maliliit na bagay gamit ang dulo ng aking mga daliri.', 40),
  ('00000000-0000-4d00-8000-000000000005', 'gross_motor', 1, 'Balanced on one foot', 'I stood on one foot and counted to five!', 'Tumayo sa isang paa', 'Tumayo ako sa isang paa at nagbilang hanggang lima!', 50),
  ('00000000-0000-4d00-8000-000000000006', 'gross_motor', 1, 'Jumped with two feet', 'I jumped forward with both feet together.', 'Tumalon nang dalawang paa', 'Tumalon ako pasulong nang magkasama ang dalawang paa.', 60),
  ('00000000-0000-4d00-8000-000000000007', 'gross_motor', 2, 'Caught a ball', 'I caught the ball with both hands.', 'Nasalo ang bola', 'Nasalo ko ang bola gamit ang dalawang kamay.', 70),
  ('00000000-0000-4d00-8000-000000000008', 'gross_motor', 2, 'Climbed the steps', 'I went up and down the steps safely.', 'Umakyat sa hagdan', 'Umakyat at bumaba ako sa hagdan nang ligtas.', 80),
  ('00000000-0000-4d00-8000-000000000009', 'sensory', 1, 'Tried a new texture', 'I touched something new and was brave.', 'Sumubok ng bagong mahahawakan', 'Humawak ako ng bagong bagay at naging matapang ako.', 90),
  ('00000000-0000-4d00-8000-000000000010', 'sensory', 2, 'Used a calm-down tool', 'I used my calm-down tool when my feelings were big.', 'Gumamit ng pampakalma', 'Ginamit ko ang aking pampakalma noong malakas ang aking damdamin.', 100),
  ('00000000-0000-4d00-8000-000000000011', 'sensory', 1, 'Stayed with the activity', 'I stayed with the activity until the end.', 'Tinapos ang gawain', 'Nanatili ako sa gawain hanggang matapos.', 110),
  ('00000000-0000-4d00-8000-000000000012', 'sensory', 2, 'Calm with a loud sound', 'I stayed calm when there was a loud sound.', 'Kalmado sa malakas na tunog', 'Nanatili akong kalmado nang may malakas na tunog.', 120),
  ('00000000-0000-4d00-8000-000000000013', 'self_care', 2, 'Zipped my jacket', 'I pulled the zipper all the way up by myself.', 'Isinara ang zipper', 'Ako mismo ang nagsara ng zipper ng aking jacket.', 130),
  ('00000000-0000-4d00-8000-000000000014', 'self_care', 1, 'Did up a button', 'I did up a button on my own.', 'Nagbutones', 'Ako mismo ang nagbutones.', 140),
  ('00000000-0000-4d00-8000-000000000015', 'self_care', 1, 'Washed my hands', 'I washed and dried my hands, step by step.', 'Naghugas ng kamay', 'Naghugas at nagpunas ako ng kamay, hakbang-hakbang.', 150),
  ('00000000-0000-4d00-8000-000000000016', 'self_care', 1, 'Ate with a spoon', 'I used my spoon without spilling.', 'Kumain gamit ang kutsara', 'Gumamit ako ng kutsara nang hindi natatapon.', 160),
  ('00000000-0000-4d00-8000-000000000017', 'handwriting', 1, 'Traced my name', 'I traced the letters of my name.', 'Sinundan ang aking pangalan', 'Sinundan ko ang mga titik ng aking pangalan.', 170),
  ('00000000-0000-4d00-8000-000000000018', 'handwriting', 2, 'Wrote a letter', 'I wrote a letter all by myself.', 'Sumulat ng titik', 'Ako mismo ang sumulat ng isang titik.', 180),
  ('00000000-0000-4d00-8000-000000000019', 'handwriting', 1, 'Good pencil grip', 'I held my pencil the right way.', 'Tamang hawak sa lapis', 'Tama ang hawak ko sa lapis.', 190),
  ('00000000-0000-4d00-8000-000000000020', 'handwriting', 1, 'Coloured inside the lines', 'I coloured my picture inside the lines.', 'Nagkulay sa loob ng linya', 'Kinulayan ko ang larawan sa loob ng linya.', 200),
  ('00000000-0000-4d00-8000-000000000021', 'play_social', 2, 'Took turns', 'I waited for my turn and shared the game.', 'Naghintay ng turno', 'Naghintay ako ng aking turno at nakibahagi sa laro.', 210),
  ('00000000-0000-4d00-8000-000000000022', 'play_social', 1, 'Followed two steps', 'I listened and did two steps in a row.', 'Sumunod sa dalawang hakbang', 'Nakinig ako at ginawa ang dalawang hakbang nang sunod-sunod.', 220),
  ('00000000-0000-4d00-8000-000000000023', 'play_social', 1, 'Said hello', 'I greeted my therapist with a hello.', 'Bumati', 'Binati ko ang aking therapist.', 230),
  ('00000000-0000-4d00-8000-000000000024', 'play_social', 2, 'Asked for help', 'I asked for help when I needed it.', 'Humingi ng tulong', 'Humingi ako ng tulong noong kailangan ko.', 240)
on conflict (id) do nothing;
