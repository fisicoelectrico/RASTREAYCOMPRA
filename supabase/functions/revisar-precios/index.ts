// Edge Function "revisar-precios"
//
// La llama pg_cron cada 6 horas (cabecera x-cron-secret) para revisar TODAS las
// ofertas activas, o un usuario desde la app ("Revisar ahora") para revisar solo
// las suyas. Por cada oferta:
//   - pide el precio actual a su tienda (en lotes, un conector a la vez),
//   - guarda una fila en historial_precios,
//   - actualiza el precio actual en ofertas.
//   - decide si hay que avisar (ver _shared/alertas.ts) y guarda la alerta.
// Al final manda por Web Push las alertas pendientes (ver _shared/push.ts).
// Si una oferta no aparece 3 revisiones seguidas, queda como no disponible.
// Después, para cada modelo con "seguir modelo" activo, repite la búsqueda guardada
// y suma los vendedores nuevos del mismo grupo (ver descubrir()).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decidirAlerta } from "../_shared/alertas.ts";
import { enviarPendientes } from "../_shared/push.ts";
import { agrupar, encontrarGrupo, ofertasNuevas } from "../_shared/agrupar.ts";
import { conectoresActivos, conTiempoLimite } from "../_shared/conectores.ts";
import { CORS, error, json } from "../_shared/http.ts";
import type { FiltroCondicion, Grupo, Oferta, Revision } from "../_shared/tipos.ts";

interface FilaOferta {
  id: string;
  user_id: string;
  vigilado_id: string;
  conector: string;
  tienda: string;
  id_externo: string;
  url: string;
  precio_final: number;
  disponible: boolean;
  errores_seguidos: number;
  vigilados: { activo: boolean; nombre: string; precio_objetivo: number };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return error("Usa POST", 405);

  // Cliente de servicio: salta RLS. Solo vive dentro de la función.
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ¿Quién llama? pg_cron (todo) o un usuario (solo lo suyo).
  // El secreto de pg_cron vive solo en Vault; la base de datos lo compara (cron_secreto_valido).
  let soloUsuario: string | null = null;
  const secreto = req.headers.get("x-cron-secret");
  const { data: esCron } = secreto ? await admin.rpc("cron_secreto_valido", { secreto }) : { data: false };
  if (esCron === true) {
    soloUsuario = null;
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return error("No autorizado", 401);
    soloUsuario = user.id;
  }

  let q = admin
    .from("ofertas")
    .select("id, user_id, vigilado_id, conector, tienda, id_externo, url, precio_final, disponible, errores_seguidos, vigilados!inner(activo, nombre, precio_objetivo)")
    .eq("vigilados.activo", true);
  if (soloUsuario) q = q.eq("user_id", soloUsuario);
  const { data: filas, error: errLectura } = await q;
  if (errLectura) return error(errLectura.message, 500);

  const ahora = new Date().toISOString();
  const resumen = { revisadas: 0, cambiaron: 0, sin_respuesta: 0, alertas: 0, errores: [] as string[] };
  const alertas = [];

  for (const c of conectoresActivos(admin)) {
    const suyas = (filas as unknown as FilaOferta[]).filter((f) => f.conector === c.id);
    if (!suyas.length) continue;

    let revisiones: Revision[];
    try {
      const ids = [...new Set(suyas.map((f) => f.id_externo))];
      revisiones = await conTiempoLimite(c.revisar(ids), 60_000, c.tienda);
    } catch (e) {
      resumen.errores.push(`${c.tienda}: ${(e as Error).message}`);
      continue; // si la tienda falla, no tocamos sus ofertas: se reintenta en 6 h
    }
    const porId = new Map(revisiones.map((r) => [r.idExterno, r]));

    const historial = [];
    for (const f of suyas) {
      const r = porId.get(f.id_externo);
      if (!r) {
        resumen.sin_respuesta++;
        const fallos = f.errores_seguidos + 1;
        await admin.from("ofertas").update({
          errores_seguidos: fallos,
          ...(fallos >= 3 ? { disponible: false } : {}),
        }).eq("id", f.id);
        continue;
      }
      historial.push({
        oferta_id: f.id,
        precio: r.precio,
        envio: r.envio,
        precio_final: r.precioFinal,
        disponible: r.disponible,
        capturado_en: ahora,
      });
      if (f.precio_final !== r.precioFinal) resumen.cambiaron++;
      const a = decidirAlerta(
        { precioFinal: f.precio_final, disponible: f.disponible },
        { precioFinal: r.precioFinal, disponible: r.disponible },
        f.vigilados.precio_objetivo,
        f.vigilados.nombre,
        f.tienda,
      );
      if (a) {
        alertas.push({
          user_id: f.user_id, vigilado_id: f.vigilado_id, oferta_id: f.id,
          tipo: a.tipo, titulo: a.titulo, cuerpo: a.cuerpo, url: f.url, precio: r.precioFinal,
        });
      }
      await admin.from("ofertas").update({
        precio: r.precio,
        envio: r.envio,
        precio_final: r.precioFinal,
        disponible: r.disponible,
        revisada_en: ahora,
        errores_seguidos: 0,
      }).eq("id", f.id);
      resumen.revisadas++;
    }
    if (historial.length) {
      const { error: errH } = await admin.from("historial_precios").insert(historial);
      if (errH) resumen.errores.push(`historial ${c.tienda}: ${errH.message}`);
    }
  }

  if (alertas.length) {
    const { error: errA } = await admin.from("alertas").insert(alertas);
    if (errA) resumen.errores.push(`alertas: ${errA.message}`);
    else resumen.alertas = alertas.length;
  }

  const descubiertas = await descubrir(admin, soloUsuario, resumen.errores);
  const push = await enviarPendientes(admin, soloUsuario);

  return json({ origen: soloUsuario ? "usuario" : "pg_cron", ...resumen, descubiertas, push });
});

interface FilaVigilado {
  id: string;
  user_id: string;
  clave_modelo: string;
  consulta: string;
  filtro: FiltroCondicion;
  ids_catalogo: string[];
  ids_descartados: string[];
  ofertas: { conector: string; id_externo: string }[];
}

/**
 * Seguir el modelo: repite cada búsqueda guardada (una sola vez por consulta+filtro aunque
 * varios modelos la compartan), reagrupa y suma las ofertas nuevas del mismo grupo.
 * Candados: solo grupos que no son ruido, mismo filtro nueva/usada, nunca lo que el usuario
 * descartó, y como máximo 10 ofertas nuevas por modelo y por revisión.
 */
async function descubrir(admin: SupabaseClient, soloUsuario: string | null, errores: string[]): Promise<number> {
  let q = admin
    .from("vigilados")
    .select("id, user_id, clave_modelo, consulta, filtro, ids_catalogo, ids_descartados, ofertas(conector, id_externo)")
    .eq("activo", true)
    .eq("seguir_modelo", true)
    .not("consulta", "is", null);
  if (soloUsuario) q = q.eq("user_id", soloUsuario);
  const { data, error: e } = await q;
  if (e) {
    errores.push(`descubrir: ${e.message}`);
    return 0;
  }
  const vigilados = (data ?? []) as FilaVigilado[];

  // Una búsqueda por consulta+filtro.
  const busquedas = new Map<string, { consulta: string; filtro: FiltroCondicion }>();
  for (const v of vigilados) {
    busquedas.set(`${v.consulta.toLowerCase()}|${v.filtro}`, { consulta: v.consulta, filtro: v.filtro });
  }

  const resultados = new Map<string, Grupo[]>();
  const conectores = conectoresActivos(admin);
  for (const [k, b] of busquedas) {
    const r = await Promise.allSettled(
      conectores.map((c) => conTiempoLimite(c.buscar(b.consulta, b.filtro), 12_000, c.tienda)),
    );
    const ofertas: Oferta[] = r.flatMap((x) => (x.status === "fulfilled" ? x.value : []));
    resultados.set(k, agrupar(ofertas, b.consulta));
  }

  let total = 0;
  for (const v of vigilados) {
    const grupos = resultados.get(`${v.consulta.toLowerCase()}|${v.filtro}`) ?? [];
    const g = encontrarGrupo(grupos, v.clave_modelo, v.ids_catalogo);
    if (!g) continue;
    const seguidas = new Set(v.ofertas.map((o) => `${o.conector}:${o.id_externo}`));
    const nuevas = ofertasNuevas(g, seguidas, new Set(v.ids_descartados), v.filtro);
    if (nuevas.length) {
      const { error: errIns } = await admin.from("ofertas").upsert(
        nuevas.map((o) => ({
          vigilado_id: v.id,
          user_id: v.user_id,
          tienda: o.tienda,
          conector: o.conector,
          id_externo: o.idExterno,
          titulo: o.titulo,
          url: o.url,
          vendedor: o.vendedor,
          condicion: o.condicion,
          precio: o.precio,
          envio: o.envio,
          precio_final: o.precioFinal,
          disponible: o.disponible,
          descubierta: true,
        })),
        { onConflict: "vigilado_id,conector,id_externo", ignoreDuplicates: true },
      );
      if (errIns) errores.push(`descubrir ${v.id}: ${errIns.message}`);
      else total += nuevas.length;
    }
    // Recordar los productos de catálogo de MercadoLibre del grupo: la próxima vez la coincidencia es exacta.
    const catalogo = [
      ...new Set([...v.ids_catalogo, ...g.ofertas.map((o) => o.idCatalogo).filter((x): x is string => !!x)]),
    ];
    if (catalogo.length !== v.ids_catalogo.length) {
      await admin.from("vigilados").update({ ids_catalogo: catalogo }).eq("id", v.id);
    }
  }
  return total;
}
