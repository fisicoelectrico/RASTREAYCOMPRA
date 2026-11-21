-- El secreto con que pg_cron llama "revisar-precios" vive SOLO en Vault.
-- La Edge Function no lo guarda: le pregunta a la base de datos si el que recibió es válido.
-- Así hay una sola fuente de verdad y nadie tiene que copiar el secreto a mano (poka-yoke).
create or replace function public.cron_secreto_valido(secreto text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'cron_secret' and decrypted_secret = secreto and length(secreto) >= 32
  );
$$;
revoke execute on function public.cron_secreto_valido(text) from public, anon, authenticated;
grant execute on function public.cron_secreto_valido(text) to service_role;

-- Una sola vez por proyecto (no va en la migración para no versionar secretos):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret');
