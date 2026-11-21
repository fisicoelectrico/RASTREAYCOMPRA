-- Censo de ofertas: precios diarios de áreas completas de cada tienda (ver _shared/censo.ts).
--
-- censo_areas      catálogo de áreas (lo sincroniza la función "censo" desde AREAS en censo.ts)
-- censo_intereses  qué áreas quiere cada usuario; un área se recorre solo si alguien la eligió
-- censo_productos  una fila por producto: precio de hoy, últimos 30 precios diarios y referencias
-- censo_precios    historia larga, solo cuando el precio cambia (ahorra disco)
-- censo_cursor     por dónde va el recorrido de hoy en cada categoría (tandas cada 5 min)

create table public.censo_areas (
  id            text primary key,              -- "homecenter:electricidad"
  conector      text not null,                 -- "homecenter", "vtex:exito"
  tienda        text not null,
  nombre        text not null,
  categorias    text[] not null,
  orden         int not null default 0,
  n_productos   int not null default 0,        -- vistos en la última pasada completa
  truncada      boolean not null default false,-- alguna categoría tocó el tope de la tienda
  ultima_pasada timestamptz
);

create table public.censo_intereses (
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  area_id   text not null references public.censo_areas on delete cascade,
  creado_en timestamptz not null default now(),
  primary key (user_id, area_id)
);

create table public.censo_productos (
  id              bigint generated always as identity primary key,
  conector        text not null,
  id_externo      text not null,
  areas           text[] not null default '{}',
  titulo          text not null,
  marca           text,
  url             text not null,
  imagen          text,
  precio          int not null,                -- precio final de hoy (sin tarjetas de la tienda)
  precio_normal   int,                         -- tachado que declara la tienda
  precio_anterior int,                         -- último precio distinto visto
  precio_ref      int not null,                -- mediana 30 días sin hoy (o el normal si hay < 7 días)
  base_ref        text not null check (base_ref in ('mediana', 'normal')),
  precios_30d     int[] not null default '{}', -- un precio por día, el último es el de ultimo_dia
  ultimo_dia      date not null,
  disponible      boolean not null default true,
  primer_visto    timestamptz not null default now(),
  visto_en        timestamptz not null default now(),
  unique (conector, id_externo)
);
create index censo_productos_areas on public.censo_productos using gin (areas);
create index censo_productos_dia on public.censo_productos (ultimo_dia);

create table public.censo_precios (
  producto_id bigint not null references public.censo_productos on delete cascade,
  dia         date not null,
  precio      int not null,
  primary key (producto_id, dia)
);

create table public.censo_cursor (
  area_id   text not null references public.censo_areas on delete cascade,
  categoria text not null,
  dia       date not null,
  pagina    int not null default 1,            -- próxima página por pedir
  paginas   int,                               -- total, conocido tras la primera
  truncada  boolean not null default false,
  terminado boolean not null default false,
  errores   int not null default 0,
  primary key (area_id, categoria, dia)
);

-- Seguridad: el catálogo y los precios son públicos para usuarios con sesión (son precios de
-- tiendas, no datos personales). Los intereses son de cada quien. El cursor, solo el servidor.
alter table public.censo_areas     enable row level security;
alter table public.censo_intereses enable row level security;
alter table public.censo_productos enable row level security;
alter table public.censo_precios   enable row level security;
alter table public.censo_cursor    enable row level security;

create policy "leer áreas"     on public.censo_areas     for select to authenticated using (true);
create policy "leer productos" on public.censo_productos for select to authenticated using (true);
create policy "leer precios"   on public.censo_precios   for select to authenticated using (true);
create policy "mis intereses"  on public.censo_intereses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.censo_areas, public.censo_intereses, public.censo_productos,
              public.censo_precios, public.censo_cursor from anon, authenticated;
grant select on public.censo_areas, public.censo_productos, public.censo_precios to authenticated;
grant select, insert, delete on public.censo_intereses to authenticated;
grant select, insert, update, delete on public.censo_areas, public.censo_intereses, public.censo_productos,
              public.censo_precios, public.censo_cursor to service_role;
grant usage, select on sequence public.censo_productos_id_seq to service_role;

-- Ofertas del censo. p_base: 'mediana' (recomendado), 'anterior' o 'normal'.
-- Solo productos vistos hoy o ayer (si desaparecieron, no se ofrecen).
create or replace function public.ofertas_censo(
  p_areas      text[]  default null,
  p_conectores text[]  default null,
  p_umbral     numeric default 0.10,
  p_base       text    default 'mediana',
  p_limite     int     default 200
)
returns table (
  id bigint, conector text, id_externo text, titulo text, marca text, url text, imagen text,
  areas text[], precio int, referencia int, base text, bajada numeric, precios_30d int[], visto_en timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  with base as (
    select p.*,
      case p_base
        when 'anterior' then p.precio_anterior
        when 'normal'   then p.precio_normal
        else p.precio_ref
      end as ref,
      case p_base when 'mediana' then p.base_ref else p_base end as base_usada
    from public.censo_productos p
    where p.disponible
      and p.ultimo_dia >= (now() at time zone 'America/Bogota')::date - 1
      and (p_areas is null or p.areas && p_areas)
      and (p_conectores is null or p.conector = any (p_conectores))
  )
  select b.id, b.conector, b.id_externo, b.titulo, b.marca, b.url, b.imagen, b.areas, b.precio,
         b.ref, b.base_usada, round(1 - b.precio::numeric / b.ref, 4), b.precios_30d, b.visto_en
  from base b
  where b.ref > 0 and b.precio <= b.ref * (1 - p_umbral)
  order by 1 - b.precio::numeric / b.ref desc
  limit least(greatest(p_limite, 1), 500)
$$;
revoke execute on function public.ofertas_censo from public, anon;
grant execute on function public.ofertas_censo to authenticated, service_role;

-- Suma un error al cursor sin leerlo antes (tras 3 errores la categoría se salta hasta mañana).
create or replace function public.censo_sumar_error(p_area text, p_categoria text, p_dia date)
returns void language sql security invoker set search_path = ''
as $$
  update public.censo_cursor set errores = errores + 1
  where area_id = p_area and categoria = p_categoria and dia = p_dia
$$;
revoke execute on function public.censo_sumar_error from public, anon, authenticated;
grant execute on function public.censo_sumar_error to service_role;

-- Tandas cada 5 minutos: la función decide si hay trabajo (sale enseguida si no).
select cron.schedule(
  'censo-cada-5min',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/censo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $cron$
);
