// Token de MercadoLibre: OAuth "authorization_code" + "refresh_token".
//
//   1. Una persona autoriza la app una vez (función ml-autorizar) → access_token + refresh_token.
//   2. El access_token dura ~6 h. Antes de que venza se pide otro con el refresh_token.
//   3. El refresh_token es de UN SOLO USO: cada renovación entrega uno nuevo que hay que guardar.
//
// Poka-yoke contra carreras (dos funciones renovando a la vez): se guarda con
// "update ... where refresh_token = el_anterior". Si otra función ya renovó, MercadoLibre
// rechaza el refresh viejo (invalid_grant) y aquí se relee el token que la otra dejó guardado.

const API = "https://api.mercadolibre.com";
const MARGEN_MS = 5 * 60_000; // renovar 5 min antes de que venza

export interface Credenciales {
  mlUserId: number;
  accessToken: string;
  refreshToken: string;
  venceEn: number; // epoch ms
}

/** Dónde se guardan las credenciales. En producción, la tabla ml_credenciales. */
export interface Almacen {
  leer(): Promise<Credenciales | null>;
  /** Guarda solo si el refresh_token guardado sigue siendo `refreshAnterior`. Devuelve si guardó. */
  reemplazar(nuevas: Credenciales, refreshAnterior: string | null): Promise<boolean>;
}

// deno-lint-ignore no-explicit-any
type Json = any;

async function pedirToken(cuerpo: Record<string, string>, f: typeof fetch): Promise<Json> {
  const r = await f(`${API}/oauth/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`MercadoLibre rechazó el token: ${j.error ?? r.status}`);
  return j;
}

const aCredenciales = (j: Json): Credenciales => ({
  mlUserId: Number(j.user_id),
  accessToken: j.access_token,
  refreshToken: j.refresh_token,
  venceEn: Date.now() + Number(j.expires_in ?? 21600) * 1000,
});

/** Canjea el `code` que MercadoLibre envía al redirect_uri tras autorizar. */
export async function canjearCodigo(
  code: string,
  op: { clientId: string; clientSecret: string; redirectUri: string; fetch?: typeof fetch },
): Promise<Credenciales> {
  const j = await pedirToken({
    grant_type: "authorization_code",
    client_id: op.clientId,
    client_secret: op.clientSecret,
    code,
    redirect_uri: op.redirectUri,
  }, op.fetch ?? fetch);
  return aCredenciales(j);
}

/**
 * Devuelve una función que entrega un access_token válido (renovándolo si hace falta),
 * o null si nadie ha autorizado la app todavía (el conector intenta entonces sin token).
 */
export function proveedorTokenML(
  almacen: Almacen,
  op: { clientId?: string; clientSecret?: string; fetch?: typeof fetch },
): () => Promise<string | null> {
  const f = op.fetch ?? fetch;
  let cache: Credenciales | null = null;

  return async () => {
    if (cache && cache.venceEn - MARGEN_MS > Date.now()) return cache.accessToken;
    const guardadas = await almacen.leer();
    if (!guardadas) return null;
    if (guardadas.venceEn - MARGEN_MS > Date.now()) {
      cache = guardadas;
      return guardadas.accessToken;
    }
    if (!op.clientId || !op.clientSecret) {
      throw new Error("Faltan ML_CLIENT_ID / ML_CLIENT_SECRET para renovar el token");
    }
    try {
      const nuevas = aCredenciales(
        await pedirToken({
          grant_type: "refresh_token",
          client_id: op.clientId,
          client_secret: op.clientSecret,
          refresh_token: guardadas.refreshToken,
        }, f),
      );
      nuevas.mlUserId = guardadas.mlUserId;
      if (await almacen.reemplazar(nuevas, guardadas.refreshToken)) {
        cache = nuevas;
        return nuevas.accessToken;
      }
    } catch (_) {
      // Puede que otra función haya renovado primero: abajo se relee.
    }
    const releidas = await almacen.leer();
    if (releidas && releidas.venceEn - MARGEN_MS > Date.now()) {
      cache = releidas;
      return releidas.accessToken;
    }
    throw new Error("El acceso a MercadoLibre venció: hay que autorizar la app otra vez");
  };
}
