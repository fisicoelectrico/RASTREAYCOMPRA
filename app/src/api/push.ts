// Parte del navegador de Web Push: permiso, service worker y suscripción.
// El service worker lo genera vite-plugin-pwa e importa public/push-sw.js.
import type { EstadoNotificaciones } from "./tipos.ts";

const soportado = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function estadoPush(): Promise<EstadoNotificaciones> {
  if (!soportado()) return "no-soportado";
  if (Notification.permission === "denied") return "bloqueadas";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "activas" : "inactivas";
}

/** Llave VAPID en base64url → bytes, como la pide pushManager.subscribe. */
function bytesDeLlave(b64: string): Uint8Array<ArrayBuffer> {
  const relleno = "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + relleno).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function suscribirPush(llavePublica: string): Promise<PushSubscription> {
  if (!soportado()) throw new Error("Este navegador no permite notificaciones. Abre la app instalada o Chrome.");
  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") throw new Error("No diste permiso de notificaciones. Puedes activarlo en los ajustes del sitio.");
  const reg = await navigator.serviceWorker.ready;
  const previa = await reg.pushManager.getSubscription();
  // Si la suscripción vieja se hizo con otra llave, hay que rehacerla.
  if (previa) {
    const llave = previa.options.applicationServerKey;
    const igual = llave && btoa(String.fromCharCode(...new Uint8Array(llave))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === llavePublica;
    if (igual) return previa;
    await previa.unsubscribe();
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesDeLlave(llavePublica) });
}
