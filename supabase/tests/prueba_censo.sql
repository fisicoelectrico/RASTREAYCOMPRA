-- Prueba del censo: catálogo legible, intereses privados, ofertas según la base elegida.
-- Correr después de prueba_rls.sql (usa los mismos usuarios A y B).
\set ON_ERROR_STOP on
reset role;
insert into public.censo_areas (id, conector, tienda, nombre, categorias) values
  ('homecenter:energia-solar', 'homecenter', 'Homecenter', 'Energía solar', '{cat510001}');
-- Panel: mediana 30 d = 1.000.000, hoy 850.000 (bajó 15 %). Inversor: tachado inflado, mediana igual a hoy.
insert into public.censo_productos (conector, id_externo, areas, titulo, url, precio, precio_normal, precio_anterior,
  precio_ref, base_ref, precios_30d, ultimo_dia) values
  ('homecenter', '1', '{homecenter:energia-solar}', 'Panel 550 W', 'https://x', 850000, 1000000, 1000000, 1000000, 'mediana',
   '{1000000,1000000,1000000,1000000,1000000,1000000,1000000,850000}', (now() at time zone 'America/Bogota')::date),
  ('homecenter', '2', '{homecenter:energia-solar}', 'Inversor 3 kW', 'https://x', 2000000, 2600000, 2000000, 2000000, 'mediana',
   '{2000000,2000000,2000000,2000000,2000000,2000000,2000000,2000000}', (now() at time zone 'America/Bogota')::date),
  ('homecenter', '3', '{homecenter:energia-solar}', 'Viejo', 'https://x', 1, 100, 100, 100, 'mediana', '{1}', '2020-01-01');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select 'A ve el catálogo de áreas' as caso, count(*) = 1 as ok from public.censo_areas;
insert into public.censo_intereses (area_id) values ('homecenter:energia-solar');
select 'mediana: solo el panel (15 %)' as caso, array_agg(id_externo) = '{1}' and min(bajada) = 0.15 as ok
  from public.ofertas_censo(array['homecenter:energia-solar'], null, 0.10, 'mediana');
select 'normal: el tachado inflado engaña (inversor 23 %)' as caso, count(*) = 2 as ok
  from public.ofertas_censo(null, array['homecenter'], 0.10, 'normal');
select 'umbral 20 %: nada con mediana' as caso, count(*) = 0 as ok from public.ofertas_censo(null, null, 0.20);
select 'no ofrece productos que no se ven desde hace días' as caso,
  not exists (select 1 from public.ofertas_censo(null, null, 0.0, 'normal') where id_externo = '3') as ok;
do $$ begin
  insert into public.censo_productos (conector, id_externo, titulo, url, precio, precio_ref, base_ref, ultimo_dia)
    values ('x', 'x', 'x', 'x', 1, 1, 'normal', now());
  raise exception 'A no debería poder escribir productos';
exception when insufficient_privilege then raise notice 'ok: A no escribe productos'; end $$;
do $$ begin
  perform 1 from public.censo_cursor;
  raise exception 'A no debería leer el cursor';
exception when insufficient_privilege then raise notice 'ok: A no lee el cursor'; end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'B no ve los intereses de A' as caso, count(*) = 0 as ok from public.censo_intereses;
do $$ begin
  insert into public.censo_intereses (user_id, area_id) values ('00000000-0000-0000-0000-00000000000a', 'homecenter:energia-solar');
  raise exception 'B no debería crear intereses para A';
exception when insufficient_privilege or check_violation then raise notice 'ok: B no escribe por A'; end $$;

set role anon;
do $$ begin
  perform 1 from public.ofertas_censo();
  raise exception 'anon no debería consultar ofertas';
exception when insufficient_privilege then raise notice 'ok: anon sin acceso'; end $$;
reset role;
