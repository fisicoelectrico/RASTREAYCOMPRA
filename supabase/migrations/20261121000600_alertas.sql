-- Alertas de precio (ver _shared/alertas.ts) y dispositivos a los que se envían.
--
-- alertas       una fila por aviso; la escribe revisar-precios. enviada_en queda null hasta
--               que algún canal (push) la entrega. El usuario solo lee y marca como leída.
-- dispositivos  token del celular de cada usuario (Firebase u otro canal), lo registra la app.

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
  canal      text not null check (canal in ('fcm', 'ntfy')),
  token      text not null,
  creado_en  timestamptz not null default now(),
  visto_en   timestamptz not null default now(),
  unique (canal, token)
);

alter table public.alertas      enable row level security;
alter table public.dispositivos enable row level security;

create policy "mis alertas" on public.alertas for select to authenticated
  using (user_id = (select auth.uid()));
create policy "marcar leídas" on public.alertas for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "mis dispositivos" on public.dispositivos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.alertas, public.dispositivos from anon, authenticated;
grant select on public.alertas to authenticated;
grant update (leida) on public.alertas to authenticated;
grant select, insert, update, delete on public.dispositivos to authenticated;
grant select, insert, update, delete on public.alertas, public.dispositivos to service_role;
grant usage, select on sequence public.alertas_id_seq, public.dispositivos_id_seq to service_role;
grant usage, select on sequence public.dispositivos_id_seq to authenticated;
