-- Prueba de alertas y dispositivos. Correr después de prueba_rls.sql (usuarios A y B).
\set ON_ERROR_STOP on
reset role;
insert into public.alertas (user_id, tipo, titulo, cuerpo) values
  ('00000000-0000-0000-0000-00000000000a', 'prueba', 'Hola A', 'x'),
  ('00000000-0000-0000-0000-00000000000b', 'prueba', 'Hola B', 'x');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select 'A ve solo su alerta' as caso, count(*) = 1 and min(titulo) = 'Hola A' as ok from public.alertas;
update public.alertas set leida = true;
select 'A marca como leída' as caso, bool_and(leida) as ok from public.alertas;
do $$ begin
  update public.alertas set titulo = 'hack';
  raise exception 'FALLO: A cambió el título';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.alertas (user_id, tipo, titulo, cuerpo) values (auth.uid(), 'prueba', 'x', 'x');
  raise exception 'FALLO: A creó una alerta';
exception when insufficient_privilege then null; end $$;
insert into public.dispositivos (canal, token) values ('fcm', 'token-a');
select 'A registra su celular' as caso, count(*) = 1 as ok from public.dispositivos;

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'B no ve el celular de A' as caso, count(*) = 0 as ok from public.dispositivos;
select 'B no ve que A leyó' as caso, bool_and(not leida) as ok from public.alertas;
reset role;
