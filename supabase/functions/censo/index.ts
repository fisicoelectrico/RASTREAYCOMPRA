// Edge Function "censo": recorre por tandas las áreas que algún usuario eligió.
//
// pg_cron la llama cada 5 minutos. En cada llamada:
//   1. Sincroniza el catálogo de áreas (AREAS en _shared/censo.ts → tabla censo_areas).
//   2. Si hoy (hora Colombia) aún no hay cursores para las áreas activas, los crea: una pasada por día.
//   3. Pide páginas pendientes (4 en paralelo) hasta ~100 s o 40 páginas, y guarda precios.
//   4. Si un área terminó, anota cuántos productos vio y la hora.
// Si no hay trabajo, sale en milisegundos.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { actualizar, AREAS, type Area, datosCenso, diaColombia, type EstadoCenso } from "../_shared/censo.ts";
import { crearConectorHomecenter } from "../_shared/homecenter.ts";
import { CORS, error, json } from "../_shared/http.ts";
import type { Oferta } from "../_shared/tipos.ts";
import { crearConectorVtex, EXITO } from "../_shared/vtex.ts";

const PRESUPUESTO_MS = 100_000;
const MAX_PAGINAS = 40;
const PARALELO = 4;

interface Pagina {
  ofertas: Oferta[];
  total: number;
  porPagina: number;
}
type Fuente = (categoria: string, pagina: number) => Promise<Pagina>;

const homecenter = crearConectorHomecenter();
const exito = crearConectorVtex(EXITO);
const FUENTES: Record<Area["conector"], Fuente> = {
  homecenter: (c, p) => homecenter.categoria(c, p),
  "vtex:exito": (c, p) => exito.categoria(c, p),
};
const TOPE: Record<Area["conector"], number> = { homecenter: 9900, "vtex:exito": 2500 };

interface Cursor {
  area_id: string;
  categoria: string;
  dia: string;
  pagina: number;
  paginas: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const inicio = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const secreto = req.headers.get("x-cron-secret");
  const { data: esCron } = secreto ? await admin.rpc("cron_secreto_valido", { secreto }) : { data: false };
  if (esCron !== true) return error("No autorizado", 401);

  const hoy = diaColombia();
  const errores: string[] = [];

  // 1. Catálogo de áreas.
  const { error: eSync } = await admin.from("censo_areas").upsert(
    AREAS.map((a, i) => ({ id: a.id, conector: a.conector, tienda: a.tienda, nombre: a.nombre, categorias: a.categorias, orden: i })),
    { onConflict: "id" },
  );
  if (eSync) return error(`sync áreas: ${eSync.message}`, 500);

  // 2. Cursores de hoy para las áreas activas.
  const { data: intereses } = await admin.from("censo_intereses").select("area_id");
  const activas = new Set((intereses ?? []).map((x) => x.area_id as string));
  const cursoresNuevos = AREAS.filter((a) => activas.has(a.id))
    .flatMap((a) => a.categorias.map((categoria) => ({ area_id: a.id, categoria, dia: hoy })));
  if (cursoresNuevos.length) {
    await admin.from("censo_cursor").upsert(cursoresNuevos, { onConflict: "area_id,categoria,dia", ignoreDuplicates: true });
  }
  await admin.from("censo_cursor").delete().lt("dia", restarDias(hoy, 3));

  // 3. Páginas pendientes.
  let paginas = 0;
  let productos = 0;
  const tocadas = new Set<string>();
  while (Date.now() - inicio < PRESUPUESTO_MS && paginas < MAX_PAGINAS) {
    const { data: pendientes } = await admin.from("censo_cursor")
      .select("area_id, categoria, dia, pagina, paginas")
      .eq("dia", hoy).eq("terminado", false).lt("errores", 3)
      .order("area_id").limit(PARALELO);
    if (!pendientes?.length) break;

    await Promise.all((pendientes as Cursor[]).map(async (c) => {
      const area = AREAS.find((a) => a.id === c.area_id);
      if (!area) return;
      tocadas.add(area.id);
      try {
        const pag = await FUENTES[area.conector](c.categoria, c.pagina);
        productos += await guardar(admin, pag.ofertas, area.id, hoy);
        const total = Math.ceil(pag.total / pag.porPagina);
        await admin.from("censo_cursor").update({
          pagina: c.pagina + 1,
          paginas: total,
          truncada: pag.total >= TOPE[area.conector],
          terminado: c.pagina >= total || pag.ofertas.length === 0,
        }).match({ area_id: c.area_id, categoria: c.categoria, dia: c.dia });
      } catch (e) {
        errores.push(`${c.area_id} ${c.categoria} p${c.pagina}: ${(e as Error).message}`);
        await admin.rpc("censo_sumar_error", { p_area: c.area_id, p_categoria: c.categoria, p_dia: c.dia });
      }
    }));
    paginas += pendientes.length;
  }

  // 4. Áreas que terminaron hoy.
  for (const id of tocadas) {
    const { data: falta } = await admin.from("censo_cursor").select("categoria")
      .eq("area_id", id).eq("dia", hoy).eq("terminado", false).lt("errores", 3).limit(1);
    if (falta?.length) continue;
    const { count } = await admin.from("censo_productos").select("id", { count: "exact", head: true })
      .contains("areas", [id]).eq("ultimo_dia", hoy);
    const { data: trunc } = await admin.from("censo_cursor").select("categoria").eq("area_id", id).eq("dia", hoy)
      .eq("truncada", true).limit(1);
    await admin.from("censo_areas").update({
      n_productos: count ?? 0,
      truncada: !!trunc?.length,
      ultima_pasada: new Date().toISOString(),
    }).eq("id", id);
  }

  return json({ dia: hoy, areas_activas: activas.size, paginas, productos, errores, ms: Date.now() - inicio });
});

/** Guarda una página de productos: estado de hoy + historia solo si cambió. */
async function guardar(admin: SupabaseClient, ofertas: Oferta[], areaId: string, hoy: string): Promise<number> {
  const unicas = [...new Map(ofertas.map((o) => [o.idExterno, o])).values()];
  if (!unicas.length) return 0;
  const conector = unicas[0].conector;
  const { data: previos, error: e1 } = await admin.from("censo_productos")
    .select("id_externo, precio, precios_30d, ultimo_dia, precio_anterior, areas")
    .eq("conector", conector).in("id_externo", unicas.map((o) => o.idExterno));
  if (e1) throw new Error(e1.message);
  const porId = new Map((previos ?? []).map((p) => [p.id_externo as string, p]));

  const ahora = new Date().toISOString();
  const cambiaron = new Set<string>();
  const filas = unicas.map((o) => {
    const d = datosCenso(o);
    const p = porId.get(o.idExterno);
    const prev: EstadoCenso | null = p
      ? { precio: p.precio, precios30d: p.precios_30d ?? [], ultimoDia: p.ultimo_dia, precioAnterior: p.precio_anterior }
      : null;
    const a = actualizar(prev, d.precio, d.precio_normal, hoy);
    if (a.cambio) cambiaron.add(o.idExterno);
    return {
      ...d,
      areas: [...new Set([...(p?.areas ?? []), areaId])],
      precio_normal: a.precioNormal,
      precio_anterior: a.precioAnterior,
      precio_ref: a.precioRef,
      base_ref: a.baseRef,
      precios_30d: a.precios30d,
      ultimo_dia: a.ultimoDia,
      visto_en: ahora,
    };
  });
  const { data: guardadas, error: e2 } = await admin.from("censo_productos")
    .upsert(filas, { onConflict: "conector,id_externo" }).select("id, id_externo, precio");
  if (e2) throw new Error(e2.message);

  const historia = (guardadas ?? []).filter((g) => cambiaron.has(g.id_externo))
    .map((g) => ({ producto_id: g.id, dia: hoy, precio: g.precio }));
  if (historia.length) {
    const { error: e3 } = await admin.from("censo_precios").upsert(historia, { onConflict: "producto_id,dia" });
    if (e3) throw new Error(e3.message);
  }
  return unicas.length;
}

function restarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
