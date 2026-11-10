-- Little Ocean of Achievements: step 2 of the Supabase setup.
-- Run this AFTER schema.sql. It adds the functions the web app calls, plus fixes found while connecting it.
-- Safe to run more than once.

-- Built-in themes ('christmas', ...) may be picked without a row in public.themes, so this reference can't be a foreign key.
alter table public.app_settings drop constraint if exists app_settings_manual_theme_id_fkey;

-- The share-safe fish list also says whether the family consented to sharing milestone details (no details themselves).
create or replace view public.public_fish as
  select f.id, f.nickname, f.species, f.palette, f.personality, f.sort_order,
         1 + coalesce(sum(a.units) filter (where a.status = 'active'), 0)::int / 10 as level,
         coalesce(sum(a.units) filter (where a.status = 'active'), 0)::int % 10 as current_units,
         coalesce(sum(a.units) filter (where a.status = 'active'), 0)::int as lifetime_units,
         c.share_consent and c.archived_at is null as sharing
  from public.fish f
  join public.clients c on c.id = f.client_id
  left join public.achievements a on a.fish_id = f.id
  where f.archived_at is null
  group by f.id, c.id;
grant select on public.public_fish to anon, authenticated;

create or replace function public.my_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.staff where user_id = auth.uid();
$$;

create or replace function public.create_fish(p_label text, p_consent boolean, p_nickname text, p_species text, p_palette jsonb, p_personality text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_fish uuid;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into clients (private_label, share_consent, consent_updated_at) values (btrim(p_label), coalesce(p_consent, false), now()) returning id into v_client;
  insert into fish (client_id, nickname, species, palette, personality) values (v_client, btrim(p_nickname), p_species, p_palette, p_personality) returning id into v_fish;
  insert into audit_events (action, entity, entity_id, fish_id, summary, after)
  values ('fish.created', 'fish', v_fish, v_fish, 'Added ' || btrim(p_nickname),
          jsonb_build_object('nickname', btrim(p_nickname), 'species', p_species, 'persona', p_personality, 'sharing', coalesce(p_consent, false)));
  return v_fish;
end $$;

create or replace function public.update_fish(p_fish uuid, p_label text, p_consent boolean, p_nickname text, p_species text, p_palette jsonb, p_personality text)
returns void language plpgsql security definer set search_path = public as $$
declare f fish; c clients; v_before jsonb; v_after jsonb;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into f from fish where id = p_fish for update;
  if f.id is null then raise exception 'fish not found'; end if;
  select * into c from clients where id = f.client_id for update;
  v_before := jsonb_build_object('label', c.private_label, 'sharing', c.share_consent, 'nickname', f.nickname, 'species', f.species, 'persona', f.personality, 'palette', f.palette);
  v_after  := jsonb_build_object('label', btrim(p_label), 'sharing', coalesce(p_consent, false), 'nickname', btrim(p_nickname), 'species', p_species, 'persona', p_personality, 'palette', p_palette);
  if v_before = v_after then return; end if;
  update clients set private_label = btrim(p_label), share_consent = coalesce(p_consent, false),
         consent_updated_at = case when share_consent is distinct from coalesce(p_consent, false) then now() else consent_updated_at end
   where id = c.id;
  update fish set nickname = btrim(p_nickname), species = p_species, palette = p_palette, personality = p_personality, updated_at = now() where id = p_fish;
  insert into audit_events (action, entity, entity_id, fish_id, summary, before, after)
  values ('fish.updated', 'fish', p_fish, p_fish, 'Updated ' || btrim(p_nickname), v_before, v_after);
end $$;

create or replace function public.set_fish_archived(p_fish uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
declare f fish;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  update fish set archived_at = case when p_archived then now() end, updated_at = now() where id = p_fish returning * into f;
  if f.id is null then raise exception 'fish not found'; end if;
  update clients set archived_at = case when p_archived then now() end where id = f.client_id;
  insert into audit_events (action, entity, entity_id, fish_id, summary)
  values (case when p_archived then 'fish.archived' else 'fish.restored' end, 'fish', p_fish, p_fish, (case when p_archived then 'Archived ' else 'Restored ' end) || f.nickname);
end $$;

create or replace function public.edit_achievement(p_id uuid, p_title text, p_public_description text, p_private_note text,
  p_achieved_at date, p_public_visible boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare a achievements; v_before jsonb := '{}'; v_after jsonb := '{}';
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required'; end if;
  if p_achieved_at > (now() at time zone 'Asia/Manila')::date then raise exception 'achieved_at cannot be in the future'; end if;
  select * into a from achievements where id = p_id and status = 'active' for update;
  if a.id is null then raise exception 'achievement is not active'; end if;
  if a.title is distinct from btrim(p_title) then v_before := v_before || jsonb_build_object('title', a.title); v_after := v_after || jsonb_build_object('title', btrim(p_title)); end if;
  if a.public_description is distinct from btrim(p_public_description) then v_before := v_before || jsonb_build_object('publicDescription', a.public_description); v_after := v_after || jsonb_build_object('publicDescription', btrim(p_public_description)); end if;
  if a.private_note is distinct from coalesce(btrim(p_private_note), '') then v_before := v_before || jsonb_build_object('privateNote', a.private_note); v_after := v_after || jsonb_build_object('privateNote', coalesce(btrim(p_private_note), '')); end if;
  if a.achieved_at is distinct from p_achieved_at then v_before := v_before || jsonb_build_object('achievedAt', a.achieved_at); v_after := v_after || jsonb_build_object('achievedAt', p_achieved_at); end if;
  if a.public_visible is distinct from p_public_visible then v_before := v_before || jsonb_build_object('publicVisible', a.public_visible); v_after := v_after || jsonb_build_object('publicVisible', p_public_visible); end if;
  if v_after = '{}'::jsonb then raise exception 'nothing changed'; end if;
  update achievements set title = btrim(p_title), public_description = btrim(p_public_description), private_note = coalesce(btrim(p_private_note), ''),
         achieved_at = p_achieved_at, public_visible = p_public_visible
   where id = p_id;
  insert into audit_events (action, entity, entity_id, fish_id, summary, reason, before, after)
  values ('achievement.edited', 'achievement', p_id, a.fish_id, 'Edited “' || a.title || '”', btrim(p_reason), v_before, v_after);
  perform sync_fish(a.fish_id);
end $$;

create or replace function public.save_theme(p_id text, p_custom boolean, p_name text, p_enabled boolean, p_priority int, p_config jsonb, p_schedules jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_id text := coalesce(nullif(btrim(p_id), ''), 'th_' || replace(gen_random_uuid()::text, '-', '')); v_new boolean;
begin
  if not is_therapist() then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_schedules, '[]')) <> 'array' or jsonb_array_length(coalesce(p_schedules, '[]')) > 24 then raise exception 'too many date ranges'; end if;
  if jsonb_typeof(coalesce(p_config, '{}')) <> 'object' then raise exception 'config must be an object'; end if;
  v_new := not exists (select 1 from themes where id = v_id);
  insert into themes (id, is_custom, name, enabled, priority, config, updated_at)
  values (v_id, coalesce(p_custom, false), btrim(p_name), coalesce(p_enabled, true), p_priority, coalesce(p_config, '{}'), now())
  on conflict (id) do update set name = excluded.name, enabled = excluded.enabled, priority = excluded.priority, config = excluded.config, updated_at = now();
  delete from theme_schedules where theme_id = v_id;
  insert into theme_schedules (theme_id, start_date, end_date, enabled)
  select v_id, (x ->> 'start')::date, (x ->> 'end')::date, coalesce((x ->> 'enabled')::boolean, true)
  from jsonb_array_elements(coalesce(p_schedules, '[]')) x;
  insert into audit_events (action, entity, summary, after)
  values (case when v_new and coalesce(p_custom, false) then 'theme.created' else 'theme.updated' end, 'theme',
          (case when v_new and coalesce(p_custom, false) then 'Created custom theme ' else 'Updated theme ' end) || btrim(p_name),
          jsonb_build_object('id', v_id, 'name', btrim(p_name), 'enabled', coalesce(p_enabled, true), 'priority', p_priority, 'schedules', coalesce(p_schedules, '[]')));
  return v_id;
end $$;

create or replace function public.delete_theme(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not is_therapist() then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from themes where id = p_id and is_custom returning name into v_name;
  if v_name is null then raise exception 'only custom themes can be deleted'; end if;
  update app_settings set theme_mode = 'auto', manual_theme_id = null, updated_at = now() where manual_theme_id = p_id;
  insert into audit_events (action, entity, summary, after) values ('theme.deleted', 'theme', 'Deleted custom theme ' || v_name, jsonb_build_object('id', p_id));
end $$;

create or replace function public.save_settings(p_patch jsonb, p_action text, p_summary text)
returns void language plpgsql security definer set search_path = public as $$
declare s app_settings;
begin
  if not is_therapist() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_action not in ('theme.mode', 'settings.updated') then raise exception 'unknown settings action'; end if;
  if p_patch ? 'defaults' and jsonb_typeof(p_patch -> 'defaults') <> 'object' then raise exception 'defaults must be an object'; end if;
  select * into s from app_settings where id = 1 for update;
  update app_settings
     set defaults = coalesce(p_patch -> 'defaults', defaults),
         theme_mode = coalesce(p_patch -> 'theme' ->> 'mode', theme_mode),
         manual_theme_id = case when p_patch ? 'theme' then nullif(p_patch -> 'theme' ->> 'manualThemeId', '') else manual_theme_id end,
         updated_at = now()
   where id = 1;
  insert into audit_events (action, entity, summary, before, after)
  values (p_action, 'settings', left(coalesce(p_summary, ''), 200),
          jsonb_build_object('defaults', s.defaults, 'theme', jsonb_build_object('mode', s.theme_mode, 'manualThemeId', s.manual_theme_id)), p_patch);
end $$;

-- The device-lock PIN hash (PBKDF2, computed in the browser). Any staff member may set the first PIN; only therapists change it.
create or replace function public.set_pin_hash(p_hash text, p_action text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_hash !~ '^pbkdf2-sha256\$[0-9]+\$[A-Za-z0-9_-]+\$[0-9a-f]{64}$' then raise exception 'invalid PIN hash'; end if;
  select pin_hash into v_old from app_settings where id = 1 for update;
  if v_old is not null and not is_therapist() then raise exception 'not allowed' using errcode = '42501'; end if;
  update app_settings set pin_hash = p_hash, updated_at = now() where id = 1;
  if p_action is not null then
    insert into audit_events (action, entity, summary) values (p_action, 'settings', case when p_action = 'admin.pin_changed' then 'Changed the therapist-area PIN' else 'Set the therapist-area PIN' end);
  end if;
end $$;

-- Removes only the fictional sample fish loaded by 003_sample_data.sql (client labels "Sample client X (fictional)").
create or replace function public.remove_sample_data()
returns int language plpgsql security definer set search_path = public as $$
declare v_fish uuid[];
begin
  if not is_therapist() then raise exception 'not allowed' using errcode = '42501'; end if;
  select array_agg(f.id) into v_fish from fish f join clients c on c.id = f.client_id where c.private_label ~ '^Sample client [A-Z] \(fictional\)$';
  if v_fish is null then return 0; end if;
  delete from evolutions where fish_id = any (v_fish);
  update achievements set correction_of = null where fish_id = any (v_fish);
  delete from achievements where fish_id = any (v_fish);
  delete from fish where id = any (v_fish);
  delete from clients c where c.private_label ~ '^Sample client [A-Z] \(fictional\)$' and not exists (select 1 from fish where client_id = c.id);
  insert into audit_events (action, entity, summary) values ('sample.removed', 'settings', 'Removed the fictional sample data (' || cardinality(v_fish) || ' fish)');
  return cardinality(v_fish);
end $$;

-- Only signed-in users may call the app functions; each function checks the staff role itself.
revoke execute on function public.create_fish, public.update_fish, public.set_fish_archived, public.edit_achievement, public.save_theme,
  public.delete_theme, public.save_settings, public.set_pin_hash, public.remove_sample_data, public.my_role from public, anon;
grant execute on function public.create_fish, public.update_fish, public.set_fish_archived, public.edit_achievement, public.save_theme,
  public.delete_theme, public.save_settings, public.set_pin_hash, public.remove_sample_data, public.my_role to authenticated;
revoke execute on function public.sync_fish from authenticated;
