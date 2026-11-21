// Edge Function "ml-autorizar": autorizar la app en MercadoLibre UNA vez.
//
//   GET /functions/v1/ml-autorizar            → redirige a MercadoLibre para dar "Autorizar"
//   GET /functions/v1/ml-autorizar?code=...   → MercadoLibre vuelve aquí; se canjea el code
//                                                por access_token + refresh_token y se guardan.
//
// Esta misma URL es la "URI de redirect" configurada en la app de MercadoLibre.
// Poka-yoke: la primera cuenta que autoriza queda fijada; otra cuenta no puede reemplazarla.
import { createClient } from "npm:@supabase/supabase-js@2";
import { almacenSupabase } from "../_shared/conectores.ts";
import { canjearCodigo } from "../_shared/ml_token.ts";

const pagina = (titulo: string, texto: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title><body style="font-family:system-ui;max-width:420px;margin:15vh auto;padding:0 16px;color:#13202a">
<h1 style="font-size:24px">${titulo}</h1><p style="color:#5a6874;line-height:1.5">${texto}</p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

Deno.serve(async (req) => {
  const clientId = Deno.env.get("ML_CLIENT_ID");
  const clientSecret = Deno.env.get("ML_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return pagina(
      "Falta configurar",
      "Guarda ML_CLIENT_ID y ML_CLIENT_SECRET en los secretos de las Edge Functions.",
      500,
    );
  }
  const redirectUri = Deno.env.get("ML_REDIRECT_URI") ??
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/ml-autorizar`;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (!code) {
    const auth = new URL("https://auth.mercadolibre.com.co/authorization");
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("redirect_uri", redirectUri);
    return Response.redirect(auth.toString(), 302);
  }

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const almacen = almacenSupabase(admin);
    const nuevas = await canjearCodigo(code, { clientId, clientSecret, redirectUri });
    const actuales = await almacen.leer();
    if (actuales && actuales.mlUserId !== nuevas.mlUserId) {
      return pagina(
        "Cuenta distinta",
        "La app ya está autorizada con otra cuenta de MercadoLibre. No se cambió nada.",
        409,
      );
    }
    const ok = await almacen.reemplazar(nuevas, actuales ? actuales.refreshToken : null);
    if (!ok) return pagina("No se pudo guardar", "Intenta autorizar otra vez en un minuto.", 500);
    return pagina(
      "¡Listo!",
      "RastreaYCompra ya puede consultar MercadoLibre. El acceso se renovará solo; puedes cerrar esta pestaña.",
    );
  } catch (e) {
    return pagina("No se pudo autorizar", String((e as Error).message), 400);
  }
});
