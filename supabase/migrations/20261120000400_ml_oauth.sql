-- Token de MercadoLibre (OAuth authorization_code + refresh_token).
-- MercadoLibre exige que una persona autorice la app una vez. Después, el refresh_token
-- (de un solo uso: cada renovación entrega uno nuevo) permite renovar el acceso sin intervención.
-- Una sola fila. Solo el servidor (service role) la lee o escribe: ni la app ni la API pública.
create table public.ml_credenciales (
  id             int primary key default 1 check (id = 1),   -- poka-yoke: imposible tener dos
  ml_user_id     bigint not null,                             -- la cuenta que autorizó queda fijada
  access_token   text not null,
  refresh_token  text not null,
  vence_en       timestamptz not null,
  actualizado_en timestamptz not null default now()
);
alter table public.ml_credenciales enable row level security;   -- sin políticas: nadie por la API
revoke all on public.ml_credenciales from anon, authenticated;
grant select, insert, update on public.ml_credenciales to service_role;
