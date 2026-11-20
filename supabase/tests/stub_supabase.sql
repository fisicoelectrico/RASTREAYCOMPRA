-- Imitación mínima de lo que Supabase ya trae (roles, auth, cron, net, vault),
-- para probar la migración en un PostgreSQL normal. NO se aplica en Supabase.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema cron;
create table cron.job (jobname text, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as
  $$ insert into cron.job values (n, s, c); select 1::bigint $$;
create schema vault;
create view vault.decrypted_secrets as select 'x'::text as name, 'y'::text as decrypted_secret;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
