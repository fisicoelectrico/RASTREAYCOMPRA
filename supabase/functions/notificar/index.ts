// Edge Function "notificar": envío de notificaciones Web Push.
//
//   POST {"accion":"llave"}   → la llave pública VAPID, para que la app suscriba el navegador.
//   POST {"accion":"prueba"}  → crea una alerta de prueba para quien llama y se la envía ya.
//   POST {} con x-cron-secret → manda todas las alertas pendientes (respaldo si un envío falló).
// revisar-precios también llama enviarPendientes() al terminar, así que normalmente no hace falta.
import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS, error, json } from "../_shared/http.ts";
import { enviarPendientes, vapidDelEntorno } from "../_shared/push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return error("Usa POST", 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const cuerpo = await req.json().catch(() => ({})) as { accion?: string };

  const secreto = req.headers.get("x-cron-secret");
  const { data: esCron } = secreto ? await admin.rpc("cron_secreto_valido", { secreto }) : { data: false };
  if (esCron === true) return json(await enviarPendientes(admin));

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return error("No autorizado", 401);

  if (cuerpo.accion === "llave") {
    const v = vapidDelEntorno();
    return v ? json({ llave: v.publicKey }) : error("Las notificaciones no están configuradas en el servidor", 503);
  }

  if (cuerpo.accion === "prueba") {
    const { count } = await admin.from("dispositivos").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    if (!count) return error("Este usuario no tiene ningún celular con notificaciones activadas", 409);
    const { error: e } = await admin.from("alertas").insert({
      user_id: user.id, tipo: "prueba",
      titulo: "🔔 Notificación de prueba",
      cuerpo: "Si ves esto, las alertas de precio te van a llegar a este celular.",
    });
    if (e) return error(e.message, 500);
    return json(await enviarPendientes(admin, user.id));
  }

  return error("Acción desconocida");
});
