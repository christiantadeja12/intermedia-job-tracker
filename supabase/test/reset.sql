-- Resets the local integration-test database to the fictional sample state.
truncate public.evolutions, public.achievements, public.fish, public.clients, public.audit_events, public.theme_schedules, public.themes restart identity cascade;
update public.app_settings set defaults = default, theme_mode = 'auto', manual_theme_id = null, pin_hash = null where id = 1;
-- Phase 4D: back to the 24 starter templates
delete from public.milestone_templates where id::text not like '00000000-0000-4d00-8000-%';
update public.milestone_templates set archived_at = null;
-- Categories: back to the six defaults, with their starting names
update public.achievements set goal_area = null where goal_area is not null and goal_area not in ('fine_motor','gross_motor','sensory','self_care','handwriting','play_social');
delete from public.goal_areas where id not in ('fine_motor','gross_motor','sensory','self_care','handwriting','play_social');
update public.goal_areas g set archived_at = null, name_en = d.en, name_fil = d.fil, sort = d.s from (values
  ('fine_motor','Fine motor','Pinong galaw',10),('gross_motor','Gross motor','Malaking galaw',20),('sensory','Sensory regulation','Pandama at pagkalma',30),
  ('self_care','Self-care','Pag-aalaga sa sarili',40),('handwriting','Handwriting','Pagsulat',50),('play_social','Play and social','Laro at pakikisama',60)) d(id, en, fil, s) where g.id = d.id;
\i supabase/003_sample_data.sql
