// Pruebas del envío Web Push sin red: un fetch falso hace de servicio push.
import { assert, assertEquals } from "jsr:@std/assert@1";
import webpush from "npm:web-push@3.6.7";
import { cargaUtil, clasificar, enviarUna } from "./push.ts";

Deno.test("Push: 2xx entrega, 404/410 borra, el resto es fallo", () => {
  assertEquals(clasificar(201), "ok");
  assertEquals(clasificar(404), "borrar");
  assertEquals(clasificar(410), "borrar");
  assertEquals(clasificar(429), "fallo");
  assertEquals(clasificar(500), "fallo");
});

Deno.test("Push: el mensaje va cifrado, con urgencia alta y firma VAPID", async () => {
  const vapid = { ...webpush.generateVAPIDKeys(), subject: "https://ejemplo.co" };
  const ecdh = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", ecdh.publicKey));
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sub = {
    id: 1, user_id: "u", fallos: 0, endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    p256dh: b64(raw), auth: b64(crypto.getRandomValues(new Uint8Array(16))),
  };
  let pedido: { url: string; headers: Record<string, string>; body: Uint8Array } | null = null;
  const falso = ((url: string, init: RequestInit) => {
    pedido = { url, headers: init.headers as Record<string, string>, body: init.body as Uint8Array };
    return Promise.resolve(new Response(null, { status: 410 }));
  }) as unknown as typeof fetch;
  const carga = cargaUtil({ id: 7, user_id: "u", titulo: "🎯 Llegó", cuerpo: "$1", url: null });
  assertEquals(await enviarUna(sub, carga, vapid, falso), "borrar");
  assertEquals(pedido!.url, sub.endpoint);
  assertEquals(pedido!.headers["Urgency"], "high");
  assertEquals(pedido!.headers["Content-Encoding"], "aes128gcm");
  assert(pedido!.headers["Authorization"].startsWith("vapid t="));
  assert(!new TextDecoder().decode(pedido!.body).includes("Llegó")); // no viaja en claro
  assertEquals(JSON.parse(carga).tag, "alerta-7");
});
