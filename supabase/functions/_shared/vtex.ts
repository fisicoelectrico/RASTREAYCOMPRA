// Conector genérico para tiendas montadas en VTEX (Éxito, Carulla, Jumbo, Metro...).
// Todas exponen el mismo endpoint JSON del catálogo:
//
//   Buscar:  GET https://<dominio>/api/catalog_system/pub/products/search?ft=<texto>&_from=0&_to=49
//   Revisar: GET https://<dominio>/api/catalog_system/pub/products/search?fq=skuId:<id>&fq=skuId:<id>...
//
// En VTEX un "producto" tiene varios "items" (SKU: color, capacidad...). Cada SKU
// se vende por uno o más "sellers" con su commertialOffer (precio y stock).
// Guardamos el skuId porque es lo que identifica exactamente lo que se compra.

import type { Conector, FiltroCondicion, Oferta, Revision } from "./tipos.ts";
import { precioFinal } from "./tipos.ts";

// deno-lint-ignore no-explicit-any
type Json = any;

export interface TiendaVtex {
  id: string; // "exito"
  nombre: string; // "Éxito"
  dominio: string; // "www.exito.com": dominio público, para los enlaces
  /** Host de la API. El dominio público suele estar detrás de Cloudflare y bloquea
   *  servidores; el host nativo de VTEX ({cuenta}.vtexcommercestable.com.br) responde igual. */
  api?: string;
}

export const EXITO: TiendaVtex = {
  id: "exito",
  nombre: "Éxito",
  dominio: "www.exito.com",
  api: "exitocol.vtexcommercestable.com.br", // comprobado desde Supabase el 2026-11-20
};

/** Página de una categoría para el censo. VTEX no deja pasar de _from=2500. */
export interface PaginaVtex {
  ofertas: Oferta[];
  total: number; // del encabezado "resources: 0-49/1234"
  porPagina: number;
}
export const VTEX_POR_PAGINA = 50;
export const VTEX_MAX_RESULTADOS = 2500;

export function crearConectorVtex(
  t: TiendaVtex,
  op: { fetch?: typeof fetch } = {},
): Conector & { categoria(ruta: string, pagina: number): Promise<PaginaVtex> } {
  const f = op.fetch ?? fetch;
  const base = `https://${t.api ?? t.dominio}/api/catalog_system/pub/products/search`;

  async function pedir(url: string): Promise<Response> {
    const r = await f(url, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (RastreaYCompra; +seguimiento de precios)" },
    });
    // VTEX responde 206 (Partial Content) cuando hay más resultados: también es éxito.
    if (!r.ok) throw new Error(`${t.nombre} respondió ${r.status}`);
    return r;
  }
  const getJson = async (url: string): Promise<Json> => (await pedir(url)).json();

  return {
    id: `vtex:${t.id}`,
    tienda: t.nombre,

    async categoria(ruta: string, pagina: number): Promise<PaginaVtex> {
      const desde = (pagina - 1) * VTEX_POR_PAGINA;
      if (desde >= VTEX_MAX_RESULTADOS) return { ofertas: [], total: VTEX_MAX_RESULTADOS, porPagina: VTEX_POR_PAGINA };
      const p = new URLSearchParams({ fq: `C:${ruta}`, _from: String(desde), _to: String(desde + VTEX_POR_PAGINA - 1) });
      const r = await pedir(`${base}?${p}`);
      const productos: Json[] = await r.json();
      const total = Number(r.headers.get("resources")?.split("/")[1] ?? productos.length);
      return {
        ofertas: productos.flatMap((pr) => productoAOfertas(pr, t)),
        total: Math.min(total, VTEX_MAX_RESULTADOS),
        porPagina: VTEX_POR_PAGINA,
      };
    },

    async buscar(consulta: string, filtro: FiltroCondicion): Promise<Oferta[]> {
      if (filtro === "usada") return []; // las cadenas VTEX solo venden nuevo
      const p = new URLSearchParams({ ft: consulta, _from: "0", _to: "49" });
      const productos: Json[] = await getJson(`${base}?${p}`);
      return productos.flatMap((pr) => productoAOfertas(pr, t));
    },

    async revisar(ids: string[]): Promise<Revision[]> {
      const salida: Revision[] = [];
      for (let i = 0; i < ids.length; i += 25) {
        const lote = ids.slice(i, i + 25);
        const q = lote.map((id) => `fq=${encodeURIComponent(`skuId:${id}`)}`).join("&");
        const productos: Json[] = await getJson(`${base}?${q}`);
        for (const pr of productos) {
          for (const item of pr.items ?? []) {
            if (!lote.includes(String(item.itemId))) continue;
            const s = mejorSeller(item);
            if (!s) continue;
            salida.push({
              idExterno: String(item.itemId),
              precio: s.precio,
              envio: null,
              precioFinal: precioFinal(s.precio, null),
              disponible: s.disponible,
            });
          }
        }
      }
      return salida;
    },
  };
}

/** Elige el seller con stock y menor precio (o el predeterminado si nadie tiene stock). */
function mejorSeller(
  item: Json,
): { precio: number; precioLista: number; disponible: boolean; nombre: string | null } | null {
  const sellers: Json[] = item.sellers ?? [];
  const conPrecio = sellers.filter((s) => (s.commertialOffer?.Price ?? 0) > 0);
  if (!conPrecio.length) return null;
  const conStock = conPrecio.filter((s) => (s.commertialOffer.AvailableQuantity ?? 0) > 0);
  const pool = conStock.length ? conStock : conPrecio.filter((s) => s.sellerDefault).concat(conPrecio).slice(0, 1);
  const s = pool.reduce((a, b) => (b.commertialOffer.Price < a.commertialOffer.Price ? b : a));
  return {
    precio: Math.round(s.commertialOffer.Price),
    precioLista: Math.round(s.commertialOffer.ListPrice ?? 0),
    disponible: conStock.length > 0,
    nombre: s.sellerName ?? null,
  };
}

/** Un producto VTEX → una oferta por SKU. Exportado para pruebas. */
export function productoAOfertas(pr: Json, t: TiendaVtex): Oferta[] {
  const salida: Oferta[] = [];
  const items: Json[] = pr.items ?? [];
  for (const item of items) {
    const s = mejorSeller(item);
    if (!s) continue;
    const tituloSku = items.length > 1 && item.name && !String(pr.productName).includes(item.name)
      ? `${pr.productName} ${item.name}`
      : pr.productName;
    const vendedorExterno = s.nombre && !/exito|éxito/i.test(s.nombre) ? s.nombre : null;
    salida.push({
      tienda: t.nombre,
      conector: `vtex:${t.id}`,
      idExterno: String(item.itemId),
      titulo: tituloSku,
      url: enlacePublico(pr, t),
      imagen: item.images?.[0]?.imageUrl ?? null,
      condicion: "nueva",
      vendedor: s.nombre,
      marca: pr.brand ?? null,
      modelo: null,
      idCatalogo: null,
      precio: s.precio,
      precioAntes: s.precioLista > s.precio ? s.precioLista : null,
      envio: null,
      precioFinal: precioFinal(s.precio, null),
      disponible: s.disponible,
      nota: [vendedorExterno ? `Vendido por ${vendedorExterno}` : null, s.disponible ? "Envío por calcular" : "Agotado"]
        .filter(Boolean).join(" · "),
    });
  }
  return salida;
}

/** El enlace que devuelve la API apunta al host técnico; lo llevamos al dominio público de la tienda. */
function enlacePublico(pr: Json, t: TiendaVtex): string {
  if (pr.linkText) return `https://${t.dominio}/${pr.linkText}/p`;
  return String(pr.link ?? `https://${t.dominio}`).replace(/^https?:\/\/[^/]+/, `https://${t.dominio}`);
}
