-- Permisos explícitos por tabla. Los proyectos Supabase recientes ya no dan
-- SELECT/INSERT/UPDATE/DELETE automáticos a los roles de la API sobre tablas nuevas,
-- así que se declaran aquí, a la medida (mínimo privilegio). RLS sigue filtrando las filas.

-- Servidor (Edge Functions con service role): todo.
grant select, insert, update, delete on public.busquedas, public.vigilados, public.ofertas, public.historial_precios to service_role;
grant select on public.vigilados_resumen to service_role;
grant usage, select on sequence public.busquedas_id_seq, public.historial_precios_id_seq to service_role;

-- Usuario con sesión: solo lo que la app necesita.
grant select, insert, delete         on public.busquedas         to authenticated;
grant select, insert, update, delete on public.vigilados         to authenticated;
grant select, insert, delete         on public.ofertas           to authenticated;  -- sin UPDATE: los precios los escribe el servidor
grant select                         on public.historial_precios to authenticated;
grant select                         on public.vigilados_resumen to authenticated;
grant usage, select on sequence public.busquedas_id_seq to authenticated;

-- Visitante sin sesión: nada.
revoke all on public.busquedas, public.vigilados, public.ofertas, public.historial_precios, public.vigilados_resumen from anon;

-- Las funciones de trigger no deben poder llamarse por la API (/rest/v1/rpc/...).
revoke execute on function public.historial_inicial() from public, anon, authenticated;
revoke execute on function public.oferta_mismo_dueno() from public, anon, authenticated;
