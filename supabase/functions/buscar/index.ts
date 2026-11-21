// Edge Function "buscar"
// POST { consulta: "rtx 5060", filtro: "nueva" | "usada" | "ambas" }
// → { consulta, filtro, grupos: Grupo[], errores: [] }
//
// 1. Consulta todas las tiendas en paralelo (cada una con 12 s de límite).
// 2. Junta las ofertas y las agrupa por modelo (ver _shared/agrupar.ts).
// 3. Guarda la búsqueda en "busquedas" para mostrar las recientes.
import { createClient } from "npm:@supabase/supabase-js@2";
import { agrupar } from "../_shared/agrupar.ts";
import { conectoresActivos, conTiempoLimite } from "../_shared/conectores.ts";
import { CORS, error, json } from "../_shared/http.ts";
import type { FiltroCondicion, Oferta, ResultadoBusqueda } from "../_shared/tipos.ts";

const FILTROS: FiltroCondicion[] = ["nueva", "usada", "ambas"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return error("Usa POST", 405);

  // Cliente con el token del usuario: el insert en "busquedas" pasa por RLS.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return error("Inicia sesión para buscar", 401);

  let cuerpo: { consulta?: string; filtro?: string };
  try {
    cuerpo = await req.json();
  } catch {
    return error("Cuerpo JSON inválido");
  }
  const consulta = (cuerpo.consulta ?? "").trim().replace(/\s+/g, " ");
  const filtro = (FILTROS.includes(cuerpo.filtro as FiltroCondicion) ? cuerpo.filtro : "ambas") as FiltroCondicion;
  if (consulta.length < 2 || consulta.length > 120) return error("Escribe entre 2 y 120 caracteres");

  // Cliente de servicio: solo para leer/renovar el token de MercadoLibre.
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const conectores = conectoresActivos(admin);
  const respuestas = await Promise.allSettled(
    conectores.map((c) => conTiempoLimite(c.buscar(consulta, filtro), 12_000, c.tienda)),
  );

  const ofertas: Oferta[] = [];
  const errores: ResultadoBusqueda["errores"] = [];
  respuestas.forEach((r, i) => {
    if (r.status === "fulfilled") ofertas.push(...r.value);
    else errores.push({ tienda: conectores[i].tienda, mensaje: String(r.reason?.message ?? r.reason) });
  });

  const grupos = agrupar(ofertas, consulta);
  const buenos = grupos.filter((g) => !g.ruido);

  await supabase.from("busquedas").insert({
    consulta,
    condicion: filtro,
    n_grupos: buenos.length,
    n_ofertas: buenos.reduce((n, g) => n + g.ofertas.length, 0),
  });

  const resultado: ResultadoBusqueda = { consulta, filtro, grupos, errores };
  return json(resultado);
});
