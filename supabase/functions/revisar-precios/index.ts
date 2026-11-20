// Edge Function "revisar-precios"
//
// La llama pg_cron cada 6 horas (cabecera x-cron-secret) para revisar TODAS las
// ofertas activas, o un usuario desde la app ("Revisar ahora") para revisar solo
// las suyas. Por cada oferta:
//   - pide el precio actual a su tienda (en lotes, un conector a la vez),
//   - guarda una fila en historial_precios,
//   - actualiza el precio actual en ofertas.
// Si una oferta no aparece 3 revisiones seguidas, queda como no disponible.
import { createClient } from "npm:@supabase/supabase-js@2";
import { conectoresActivos, conTiempoLimite } from "../_shared/conectores.ts";
import { CORS, error, json } from "../_shared/http.ts";
import type { Revision } from "../_shared/tipos.ts";

interface FilaOferta {
  id: string;
  conector: string;
  id_externo: string;
  precio_final: number;
  errores_seguidos: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return error("Usa POST", 405);

  // Cliente de servicio: salta RLS. Solo vive dentro de la función.
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ¿Quién llama? pg_cron (todo) o un usuario (solo lo suyo).
  let soloUsuario: string | null = null;
  const secreto = Deno.env.get("CRON_SECRET");
  if (secreto && req.headers.get("x-cron-secret") === secreto) {
    soloUsuario = null;
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return error("No autorizado", 401);
    soloUsuario = user.id;
  }

  let q = admin
    .from("ofertas")
    .select("id, conector, id_externo, precio_final, errores_seguidos, vigilados!inner(activo)")
    .eq("vigilados.activo", true);
  if (soloUsuario) q = q.eq("user_id", soloUsuario);
  const { data: filas, error: errLectura } = await q;
  if (errLectura) return error(errLectura.message, 500);

  const ahora = new Date().toISOString();
  const resumen = { revisadas: 0, cambiaron: 0, sin_respuesta: 0, errores: [] as string[] };

  for (const c of conectoresActivos()) {
    const suyas = (filas as FilaOferta[]).filter((f) => f.conector === c.id);
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

  return json({ origen: soloUsuario ? "usuario" : "pg_cron", ...resumen });
});
