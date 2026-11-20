// Registro de conectores activos. Agregar una tienda = agregar una línea aquí.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Conector } from "./tipos.ts";
import { crearConectorML } from "./mercadolibre.ts";
import { type Almacen, proveedorTokenML } from "./ml_token.ts";
import { crearConectorVtex, EXITO } from "./vtex.ts";

/** `admin` es un cliente con service role: lo necesita el token de MercadoLibre. */
export function conectoresActivos(admin: SupabaseClient): Conector[] {
  const token = proveedorTokenML(almacenSupabase(admin), {
    clientId: Deno.env.get("ML_CLIENT_ID") ?? undefined,
    clientSecret: Deno.env.get("ML_CLIENT_SECRET") ?? undefined,
  });
  return [crearConectorML({ token }), crearConectorVtex(EXITO)];
}

/** Credenciales de MercadoLibre en la tabla ml_credenciales (una sola fila, solo service role). */
export function almacenSupabase(admin: SupabaseClient): Almacen {
  return {
    async leer() {
      const { data } = await admin.from("ml_credenciales").select("*").eq("id", 1).maybeSingle();
      if (!data) return null;
      return {
        mlUserId: data.ml_user_id,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        venceEn: Date.parse(data.vence_en),
      };
    },
    async reemplazar(c, refreshAnterior) {
      const fila = {
        id: 1,
        ml_user_id: c.mlUserId,
        access_token: c.accessToken,
        refresh_token: c.refreshToken,
        vence_en: new Date(c.venceEn).toISOString(),
        actualizado_en: new Date().toISOString(),
      };
      if (refreshAnterior === null) {
        const { error } = await admin.from("ml_credenciales").insert(fila);
        return !error;
      }
      const { data, error } = await admin.from("ml_credenciales").update(fila)
        .eq("id", 1).eq("refresh_token", refreshAnterior).select("id");
      return !error && (data?.length ?? 0) === 1;
    },
  };
}

/** Ejecuta una promesa con límite de tiempo, para que una tienda lenta no frene a las demás. */
export function conTiempoLimite<T>(p: Promise<T>, ms: number, quien: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rechazar) => setTimeout(() => rechazar(new Error(`${quien} tardó más de ${ms / 1000} s`)), ms)),
  ]);
}
