-- Alertas de precio (ver _shared/alertas.ts) y dispositivos a los que se envían.
--
-- alertas       una fila por aviso; la escribe revisar-precios. enviada_en queda null hasta
--               que algún canal (push) la entrega. El usuario solo lee y marca como leída.
-- dispositivos  suscripciones Web Push (VAPID) de cada usuario; las registra la app al activar
--               las notificaciones y las borra el envío cuando el servicio responde 404/410.

create table public.alertas (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users on delete cascade,
  vigilado_id uuid references public.vigilados on delete cascade,
  oferta_id   uuid references public.ofertas on delete cascade,
  tipo        text not null check (tipo in ('objetivo', 'bajada', 'vuelve_stock', 'prueba')),
  titulo      text not null,
  cuerpo      text not null,
  url         text,
  precio      bigint,
  creada_en   timestamptz not null default now(),
  enviada_en  timestamptz,
  leida       boolean not null default false
);
create index alertas_usuario on public.alertas (user_id, creada_en desc);
create index alertas_pendientes on public.alertas (creada_en) where enviada_en is null;

create table public.dispositivos (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint   text not null unique,              -- URL del servicio push del navegador (Web Push)
  p256dh     text not null,                     -- llave pública del navegador para cifrar
  auth       text not null,                     -- secreto de autenticación del navegador
  agente     text,                              -- "Android · Chrome", para reconocerlo en la lista
  creado_en  timestamptz not null default now(),
  fallos     int not null default 0             -- envíos fallidos seguidos (no 404/410, esos se borran)
);
create index dispositivos_usuario on public.dispositivos (user_id);

alter table public.alertas      enable row level security;
alter table public.dispositivos enable row level security;

create policy "mis alertas" on public.alertas for select to authenticated
  using (user_id = (select auth.uid()));
create policy "marcar leídas" on public.alertas for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "mis dispositivos" on public.dispositivos for select to authenticated
  using (user_id = (select auth.uid()));
create policy "borrar mis dispositivos" on public.dispositivos for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.alertas, public.dispositivos from anon, authenticated;
grant select on public.alertas to authenticated;
grant update (leida) on public.alertas to authenticated;
grant select, delete on public.dispositivos to authenticated;
grant select, insert, update, delete on public.alertas, public.dispositivos to service_role;
grant usage, select on sequence public.alertas_id_seq, public.dispositivos_id_seq to service_role;

-- Registrar el celular: si el mismo navegador ya estaba suscrito (aunque fuera con otra cuenta),
-- la suscripción pasa a la cuenta actual. Por eso es security definer y no un insert directo.
create or replace function public.registrar_dispositivo(p_endpoint text, p_p256dh text, p_auth text, p_agente text default null)
returns void language sql security definer set search_path = ''
as $$
  insert into public.dispositivos (user_id, endpoint, p256dh, auth, agente)
  values ((select auth.uid()), p_endpoint, p_p256dh, p_auth, p_agente)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        agente = excluded.agente, fallos = 0
  where (select auth.uid()) is not null
$$;
revoke execute on function public.registrar_dispositivo from public, anon;
grant execute on function public.registrar_dispositivo to authenticated;
