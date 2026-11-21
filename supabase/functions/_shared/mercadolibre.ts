// Conector de MercadoLibre Colombia (sitio MCO) usando su API pública.
//
//   Buscar:  GET https://api.mercadolibre.com/sites/MCO/search?q=...&condition=new|used&limit=50
//   Revisar: GET https://api.mercadolibre.com/items?ids=MCO1,MCO2,...   (hasta 20 por llamada)
//
// MercadoLibre responde 403 a llamadas anónimas desde servidores (comprobado 2026-11-20).
// El token sale del flujo OAuth (autorizar una vez + refresh_token): ver ml_token.ts.

import type { Conector, FiltroCondicion, Oferta, Revision } from "./tipos.ts";
import { precioFinal } from "./tipos.ts";

const API = "https://api.mercadolibre.com";

// deno-lint-ignore no-explicit-any
type Json = any;

export interface OpcionesML {
  /** Entrega un access_token válido o null (sin autorizar todavía). Ver ml_token.ts. */
  token?: () => Promise<string | null>;
  fetch?: typeof fetch; // inyectable para pruebas
}

export function crearConectorML(op: OpcionesML = {}): Conector {
  const f = op.fetch ?? fetch;

  async function cabeceras(): Promise<HeadersInit> {
    const h: Record<string, string> = { Accept: "application/json" };
    const t = op.token ? await op.token() : null;
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  }

  async function getJson(url: string): Promise<Json> {
    const r = await f(url, { headers: await cabeceras() });
    if (r.status === 401 || r.status === 403) {
      throw new Error(`MercadoLibre respondió ${r.status}: falta autorizar la app (ver README, sección 8)`);
    }
    if (!r.ok) throw new Error(`MercadoLibre respondió ${r.status}`);
    return r.json();
  }

  return {
    id: "mercadolibre",
    tienda: "MercadoLibre",

    async buscar(consulta: string, filtro: FiltroCondicion): Promise<Oferta[]> {
      const p = new URLSearchParams({ q: consulta, limit: "50" });
      if (filtro === "nueva") p.set("condition", "new");
      if (filtro === "usada") p.set("condition", "used");
      const j = await getJson(`${API}/sites/MCO/search?${p}`);
      return (j.results ?? []).map(resultadoAOferta).filter((o: Oferta | null): o is Oferta => !!o);
    },

    async revisar(ids: string[]): Promise<Revision[]> {
      const salida: Revision[] = [];
      for (let i = 0; i < ids.length; i += 20) {
        const lote = ids.slice(i, i + 20);
        const j: Json[] = await getJson(
          `${API}/items?ids=${lote.join(",")}&attributes=id,price,status,available_quantity,shipping`,
        );
        for (const x of j) {
          if (x.code !== 200 || !x.body) continue;
          salida.push(itemARevision(x.body));
        }
      }
      return salida;
    },
  };
}

const atributo = (r: Json, id: string): string | null =>
  r.attributes?.find((a: Json) => a.id === id)?.value_name ?? null;

/** Convierte un resultado de /sites/MCO/search en Oferta. Exportado para pruebas. */
export function resultadoAOferta(r: Json): Oferta | null {
  if (r?.currency_id && r.currency_id !== "COP") return null; // evita precios en USD
  if (typeof r?.price !== "number") return null;
  const gratis = r.shipping?.free_shipping === true;
  const envio = gratis ? 0 : null;
  const vendedor = r.official_store_name ?? r.seller?.nickname ?? null;
  const nota = [
    gratis ? "Envío gratis" : "Envío por calcular",
    vendedor,
    r.condition === "used" ? "Usada" : null,
  ].filter(Boolean).join(" · ");
  return {
    tienda: "MercadoLibre",
    conector: "mercadolibre",
    idExterno: r.id,
    titulo: r.title,
    url: r.permalink,
    imagen: r.thumbnail ? String(r.thumbnail).replace(/^http:/, "https:") : null,
    condicion: r.condition === "used" ? "usada" : "nueva",
    vendedor,
    marca: atributo(r, "BRAND"),
    modelo: atributo(r, "MODEL"),
    idCatalogo: r.catalog_product_id ?? null,
    precio: Math.round(r.price),
    precioAntes: r.original_price ? Math.round(r.original_price) : null,
    envio,
    precioFinal: precioFinal(r.price, envio),
    disponible: (r.available_quantity ?? 1) > 0,
    nota,
  };
}

export function itemARevision(b: Json): Revision {
  const envio = b.shipping?.free_shipping === true ? 0 : null;
  return {
    idExterno: b.id,
    precio: Math.round(b.price),
    envio,
    precioFinal: precioFinal(b.price, envio),
    disponible: b.status === "active" && (b.available_quantity ?? 1) > 0,
  };
}
