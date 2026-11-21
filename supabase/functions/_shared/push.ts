// Envío de notificaciones Web Push (estándar, llaves VAPID, sin Firebase).
//
// Cada alerta pendiente (alertas.enviada_en null, de las últimas 24 h) se cifra para cada
// suscripción del usuario y se manda al servicio push de su navegador. Detalles:
//   - Urgency: high, para que Android no la retrase en ahorro de batería.
//   - 404/410 = la suscripción ya no existe (desinstaló, borró datos): se borra.
//   - Otros errores suman un fallo; a los 5 seguidos la suscripción se borra.
//   - La alerta queda enviada si llegó al menos a un dispositivo.
// Llaves en los secretos de la función: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface Suscripcion {
  id: number;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  fallos: number;
}

export interface AlertaPush {
  id: number;
  user_id: string;
  titulo: string;
  cuerpo: string;
  url: string | null;
}

export type Resultado = "ok" | "borrar" | "fallo";

/** Qué hacer con la suscripción según la respuesta del servicio push. */
export function clasificar(status: number): Resultado {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 410) return "borrar";
  return "fallo";
}

/** Lo que recibe el service worker (public/push-sw.js). */
export function cargaUtil(a: AlertaPush): string {
  return JSON.stringify({ titulo: a.titulo, cuerpo: a.cuerpo, url: a.url, tag: `alerta-${a.id}` });
}

export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function vapidDelEntorno(): Vapid | null {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return null;
  // El "subject" lo ve el servicio push si necesita contactar al remitente: la URL del proyecto basta.
  return { publicKey, privateKey, subject: Deno.env.get("SUPABASE_URL") ?? "https://rastreaycompra.app" };
}

export async function enviarUna(
  s: Suscripcion,
  carga: string,
  vapid: Vapid,
  f: typeof fetch = fetch,
): Promise<Resultado> {
  const d = webpush.generateRequestDetails(
    { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
    carga,
    { vapidDetails: vapid, TTL: 24 * 3600, urgency: "high" },
  );
  const r = await f(d.endpoint, { method: d.method, headers: d.headers as Record<string, string>, body: d.body });
  await r.body?.cancel();
  return clasificar(r.status);
}

export interface ResumenPush {
  alertas: number;
  entregas: number;
  borradas: number;
  fallos: number;
  sinDispositivo: number;
  error?: string;
}

/** Manda las alertas pendientes (de todos, o de un usuario). */
export async function enviarPendientes(
  admin: SupabaseClient,
  soloUsuario: string | null = null,
  f: typeof fetch = fetch,
): Promise<ResumenPush> {
  const resumen: ResumenPush = { alertas: 0, entregas: 0, borradas: 0, fallos: 0, sinDispositivo: 0 };
  const vapid = vapidDelEntorno();
  if (!vapid) return { ...resumen, error: "faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY" };

  let q = admin.from("alertas").select("id, user_id, titulo, cuerpo, url")
    .is("enviada_en", null).gte("creada_en", new Date(Date.now() - 86_400_000).toISOString())
    .order("creada_en").limit(200);
  if (soloUsuario) q = q.eq("user_id", soloUsuario);
  const { data: alertas, error: e1 } = await q;
  if (e1) return { ...resumen, error: e1.message };
  if (!alertas?.length) return resumen;
  resumen.alertas = alertas.length;

  const usuarios = [...new Set(alertas.map((a) => a.user_id as string))];
  const { data: subs, error: e2 } = await admin.from("dispositivos")
    .select("id, user_id, endpoint, p256dh, auth, fallos").in("user_id", usuarios);
  if (e2) return { ...resumen, error: e2.message };

  const porUsuario = new Map<string, Suscripcion[]>();
  for (const s of (subs ?? []) as Suscripcion[]) porUsuario.set(s.user_id, [...(porUsuario.get(s.user_id) ?? []), s]);

  const enviadas: number[] = [];
  const borrar = new Set<number>();
  const fallos = new Map<number, number>();
  for (const a of alertas as AlertaPush[]) {
    const suyas = (porUsuario.get(a.user_id) ?? []).filter((s) => !borrar.has(s.id));
    if (!suyas.length) {
      resumen.sinDispositivo++;
      continue;
    }
    const carga = cargaUtil(a);
    const r = await Promise.all(suyas.map((s) => enviarUna(s, carga, vapid, f).catch(() => "fallo" as const)));
    r.forEach((x, i) => {
      const s = suyas[i];
      if (x === "ok") resumen.entregas++;
      else if (x === "borrar") borrar.add(s.id);
      else fallos.set(s.id, (fallos.get(s.id) ?? s.fallos) + 1);
    });
    if (r.includes("ok")) enviadas.push(a.id);
  }

  if (enviadas.length) await admin.from("alertas").update({ enviada_en: new Date().toISOString() }).in("id", enviadas);
  for (const [id, n] of fallos) {
    if (n >= 5) borrar.add(id);
    else await admin.from("dispositivos").update({ fallos: n }).eq("id", id);
  }
  if (borrar.size) await admin.from("dispositivos").delete().in("id", [...borrar]);
  // Un envío que salió bien reinicia el contador de fallos.
  resumen.borradas = borrar.size;
  resumen.fallos = fallos.size;
  return resumen;
}
