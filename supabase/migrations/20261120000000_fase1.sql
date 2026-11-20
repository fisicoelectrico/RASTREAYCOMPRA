-- =====================================================================
-- RastreaYCompra · Fase 1
-- Esquema: búsquedas, productos vigilados, ofertas e historial de precios.
-- Todo precio guardado es PRECIO FINAL en pesos colombianos (COP, enteros):
--   precio_final = precio publicado (ya trae IVA) + envío (si se conoce).
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.condicion as enum ('nueva', 'usada');
create type public.filtro_condicion as enum ('nueva', 'usada', 'ambas');

-- ---------------------------------------------------------------------
-- busquedas: lo que el usuario escribió (alimenta "búsquedas recientes")
-- ---------------------------------------------------------------------
create table public.busquedas (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  consulta      text not null check (length(consulta) between 2 and 120),
  condicion     public.filtro_condicion not null default 'ambas',
  n_grupos      int not null default 0,
  n_ofertas     int not null default 0,
  creada_en     timestamptz not null default now()
);
create index busquedas_user_fecha on public.busquedas (user_id, creada_en desc);

-- ---------------------------------------------------------------------
-- vigilados: un "modelo" que el usuario decidió rastrear
-- ---------------------------------------------------------------------
create table public.vigilados (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nombre           text not null,
  clave_modelo     text not null,             -- firma del grupo (ver agrupar.ts)
  imagen           text,
  consulta         text,                      -- búsqueda con la que se encontró
  precio_objetivo  bigint not null check (precio_objetivo > 0),
  activo           boolean not null default true,
  creado_en        timestamptz not null default now(),
  unique (user_id, clave_modelo)
);

-- ---------------------------------------------------------------------
-- ofertas: una publicación concreta en una tienda (lo que se revisa)
-- ---------------------------------------------------------------------
create table public.ofertas (
  id               uuid primary key default gen_random_uuid(),
  vigilado_id      uuid not null references public.vigilados (id) on delete cascade,
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tienda           text not null,             -- 'MercadoLibre', 'Éxito', ...
  conector         text not null,             -- 'mercadolibre' | 'vtex:exito'
  id_externo       text not null,             -- MLA/MCO id o skuId VTEX
  titulo           text not null,
  url              text not null,
  vendedor         text,
  condicion        public.condicion not null,
  precio           bigint not null,           -- precio publicado (con IVA)
  envio            bigint,                    -- null = envío no informado por la tienda
  precio_final     bigint not null,
  disponible       boolean not null default true,
  revisada_en      timestamptz not null default now(),
  errores_seguidos int not null default 0,    -- para detectar publicaciones caídas
  creada_en        timestamptz not null default now(),
  unique (vigilado_id, conector, id_externo)
);
create index ofertas_vigilado on public.ofertas (vigilado_id);
create index ofertas_revision on public.ofertas (revisada_en);

-- ---------------------------------------------------------------------
-- historial_precios: una fila por oferta y por revisión (cada 6 h)
-- Solo lo escriben el trigger y la Edge Function (service role).
-- ---------------------------------------------------------------------
create table public.historial_precios (
  id            bigint generated always as identity primary key,
  oferta_id     uuid not null references public.ofertas (id) on delete cascade,
  precio        bigint not null,
  envio         bigint,
  precio_final  bigint not null,
  disponible    boolean not null,
  capturado_en  timestamptz not null default now()
);
create index historial_oferta_fecha on public.historial_precios (oferta_id, capturado_en);

-- Al crear una oferta, su precio actual es el primer punto del historial.
create or replace function public.historial_inicial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.historial_precios (oferta_id, precio, envio, precio_final, disponible, capturado_en)
  values (new.id, new.precio, new.envio, new.precio_final, new.disponible, new.revisada_en);
  return new;
end;
$$;

create trigger ofertas_historial_inicial
after insert on public.ofertas
for each row execute function public.historial_inicial();

-- Una oferta debe pertenecer al mismo usuario que su vigilado (poka-yoke a nivel de datos).
create or replace function public.oferta_mismo_dueno()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.vigilados v where v.id = new.vigilado_id and v.user_id = new.user_id) then
    raise exception 'La oferta no pertenece al mismo usuario que el producto vigilado';
  end if;
  return new;
end;
$$;

create trigger ofertas_mismo_dueno
before insert or update of vigilado_id, user_id on public.ofertas
for each row execute function public.oferta_mismo_dueno();

-- ---------------------------------------------------------------------
-- Seguridad: Row Level Security. Cada quien ve y toca solo lo suyo.
-- ---------------------------------------------------------------------
alter table public.busquedas         enable row level security;
alter table public.vigilados         enable row level security;
alter table public.ofertas           enable row level security;
alter table public.historial_precios enable row level security;

create policy "busquedas: dueño lee"   on public.busquedas for select to authenticated using (user_id = (select auth.uid()));
create policy "busquedas: dueño crea"  on public.busquedas for insert to authenticated with check (user_id = (select auth.uid()));
create policy "busquedas: dueño borra" on public.busquedas for delete to authenticated using (user_id = (select auth.uid()));

create policy "vigilados: dueño todo" on public.vigilados for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- El usuario puede crear y borrar sus ofertas, pero no reescribir precios:
-- los precios solo los actualiza la Edge Function con service role.
create policy "ofertas: dueño lee"   on public.ofertas for select to authenticated using (user_id = (select auth.uid()));
create policy "ofertas: dueño crea"  on public.ofertas for insert to authenticated with check (user_id = (select auth.uid()));
create policy "ofertas: dueño borra" on public.ofertas for delete to authenticated using (user_id = (select auth.uid()));

create policy "historial: dueño lee" on public.historial_precios for select to authenticated
  using (exists (select 1 from public.ofertas o where o.id = oferta_id and o.user_id = (select auth.uid())));

revoke update on public.ofertas from authenticated, anon;
revoke insert, update, delete on public.historial_precios from authenticated, anon;

-- ---------------------------------------------------------------------
-- Vista de apoyo para la lista de vigilados: mejor precio actual por modelo.
-- security_invoker = respeta el RLS del usuario que consulta.
-- ---------------------------------------------------------------------
create view public.vigilados_resumen
with (security_invoker = true) as
select
  v.id,
  v.nombre,
  v.imagen,
  v.precio_objetivo,
  v.activo,
  v.creado_en,
  count(o.id)                                                   as n_ofertas,
  min(o.precio_final) filter (where o.disponible)               as mejor_precio,
  max(o.revisada_en)                                            as ultima_revision
from public.vigilados v
left join public.ofertas o on o.vigilado_id = v.id
group by v.id;

-- ---------------------------------------------------------------------
-- pg_cron: revisar precios cada 6 horas (00:00, 06:00, 12:00, 18:00 UTC).
-- Llama la Edge Function "revisar-precios" con pg_net.
-- La URL del proyecto y el secreto se leen de Vault (se crean a mano, ver README):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<un-secreto-largo>', 'cron_secret');
-- ---------------------------------------------------------------------
select cron.schedule(
  'revisar-precios-cada-6h',
  '0 */6 * * *',
  $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/revisar-precios',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{"origen":"pg_cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
