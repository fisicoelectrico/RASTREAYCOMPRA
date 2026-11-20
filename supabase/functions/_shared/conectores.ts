// Registro de conectores activos. Agregar una tienda = agregar una línea aquí.
import type { Conector } from "./tipos.ts";
import { crearConectorML } from "./mercadolibre.ts";
import { crearConectorVtex, EXITO } from "./vtex.ts";

export function conectoresActivos(): Conector[] {
  return [
    crearConectorML({
      clientId: Deno.env.get("ML_CLIENT_ID") ?? undefined,
      clientSecret: Deno.env.get("ML_CLIENT_SECRET") ?? undefined,
    }),
    crearConectorVtex(EXITO),
  ];
}

/** Ejecuta una promesa con límite de tiempo, para que una tienda lenta no frene a las demás. */
export function conTiempoLimite<T>(p: Promise<T>, ms: number, quien: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rechazar) => setTimeout(() => rechazar(new Error(`${quien} tardó más de ${ms / 1000} s`)), ms)),
  ]);
}
