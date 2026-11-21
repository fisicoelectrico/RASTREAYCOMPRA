-- Seguir el MODELO, no solo las publicaciones elegidas.
-- Cada 6 h, revisar-precios repite la búsqueda guardada, reagrupa y, si en el mismo
-- grupo aparece un vendedor nuevo, lo agrega como oferta "descubierta".

alter table public.vigilados
  add column filtro           public.filtro_condicion not null default 'ambas', -- respeta nueva/usada elegido
  add column seguir_modelo    boolean not null default true,                     -- interruptor en la app
  add column ids_catalogo     text[]  not null default '{}',                      -- productos de catálogo de MercadoLibre
  add column ids_descartados  text[]  not null default '{}';                      -- "conector:id" que el usuario quitó: no volver a sumarlos

alter table public.ofertas
  add column descubierta boolean not null default false; -- true = la encontró la app sola, no el usuario
