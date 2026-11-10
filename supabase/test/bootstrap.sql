-- Local integration-test database only: recreates the parts of Supabase that the app's SQL depends on.
-- Never run this on the real Supabase project (it already has all of this).
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login password 'authenticator' noinherit;
grant anon, authenticated, service_role to authenticator;

create schema auth;
create table auth.users (id uuid primary key, email text unique);
-- Same behaviour as Supabase: read the signed-in user and claims from the JWT that PostgREST verified.
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants table access broadly and relies on row-level security; copy that so tests catch missing policies.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'therapist@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'helper@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'parent@example.test');
