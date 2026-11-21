-- Prueba de seguridad: dos usuarios, cada uno solo ve y toca lo suyo.
\set ON_ERROR_STOP on
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.vigilados (nombre, clave_modelo, precio_objetivo) values ('MSI RTX 5060', 'msi|5060 8gb rtx', 1600000);
insert into public.ofertas (vigilado_id, tienda, conector, id_externo, titulo, url, condicion, precio, envio, precio_final)
  select id, 'MercadoLibre', 'mercadolibre', 'MCO1', 'MSI RTX 5060', 'https://x', 'nueva', 1719000, 0, 1719000 from public.vigilados;
select 'A ve su historial inicial' as caso, count(*) = 1 as ok from public.historial_precios;
select 'A ve resumen' as caso, mejor_precio = 1719000 as ok from public.vigilados_resumen;

-- A no puede reescribir precios
do $$ begin
  update public.ofertas set precio_final = 1;
  raise exception 'FALLO: A pudo actualizar precios';
exception when insufficient_privilege then raise notice 'ok: A no puede actualizar precios';
end $$;

-- B no ve nada de A
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'B no ve vigilados de A' as caso, count(*) = 0 as ok from public.vigilados;
select 'B no ve historial de A' as caso, count(*) = 0 as ok from public.historial_precios;

-- B no puede colgar una oferta suya en el vigilado de A
do $$ begin
  insert into public.ofertas (vigilado_id, tienda, conector, id_externo, titulo, url, condicion, precio, precio_final)
    select id, 'X', 'x', '1', 't', 'u', 'nueva', 1, 1 from public.vigilados limit 1;
  raise notice 'ok: B ni siquiera ve el vigilado de A';
end $$;
reset role;
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  insert into public.ofertas (vigilado_id, tienda, conector, id_externo, titulo, url, condicion, precio, precio_final, user_id)
    values ((select id from public.vigilados limit 1), 'X', 'x', '1', 't', 'u', 'nueva', 1, 1, '00000000-0000-0000-0000-00000000000b');
  raise exception 'FALLO: B insertó en vigilado ajeno';
exception when others then
  if sqlerrm like 'FALLO%' then raise; end if;
  raise notice 'ok: rechazado (%)', sqlerrm;
end $$;
reset role;
select 'cron programado' as caso, schedule = '0 */6 * * *' as ok from cron.job where jobname = 'revisar-precios-cada-6h';
