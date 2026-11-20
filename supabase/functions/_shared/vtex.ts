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
  dominio: string; // "www.exito.com"
}

export const EXITO: TiendaVtex = { id: "exito", nombre: "Éxito", dominio: "www.exito.com" };

export function crearConectorVtex(t: TiendaVtex, op: { fetch?: typeof fetch } = {}): Conector {
  const f = op.fetch ?? fetch;
  const base = `https://${t.dominio}/api/catalog_system/pub/products/search`;

  async function getJson(url: string): Promise<Json> {
    const r = await f(url, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (RastreaYCompra; +seguimiento de precios)" },
    });
    // VTEX responde 206 (Partial Content) cuando hay más resultados: también es éxito.
    if (!r.ok) throw new Error(`${t.nombre} respondió ${r.status}`);
    return r.json();
  }

  return {
    id: `vtex:${t.id}`,
    tienda: t.nombre,

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
function mejorSeller(item: Json): { precio: number; disponible: boolean; nombre: string | null } | null {
  const sellers: Json[] = item.sellers ?? [];
  const conPrecio = sellers.filter((s) => (s.commertialOffer?.Price ?? 0) > 0);
  if (!conPrecio.length) return null;
  const conStock = conPrecio.filter((s) => (s.commertialOffer.AvailableQuantity ?? 0) > 0);
  const pool = conStock.length ? conStock : conPrecio.filter((s) => s.sellerDefault).concat(conPrecio).slice(0, 1);
  const s = pool.reduce((a, b) => (b.commertialOffer.Price < a.commertialOffer.Price ? b : a));
  return {
    precio: Math.round(s.commertialOffer.Price),
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
    const antes = Math.round(item.sellers?.[0]?.commertialOffer?.ListPrice ?? 0);
    const tituloSku = items.length > 1 && item.name && !String(pr.productName).includes(item.name)
      ? `${pr.productName} ${item.name}`
      : pr.productName;
    const vendedorExterno = s.nombre && !/exito|éxito/i.test(s.nombre) ? s.nombre : null;
    salida.push({
      tienda: t.nombre,
      conector: `vtex:${t.id}`,
      idExterno: String(item.itemId),
      titulo: tituloSku,
      url: pr.link ?? `https://${t.dominio}/${pr.linkText}/p`,
      imagen: item.images?.[0]?.imageUrl ?? null,
      condicion: "nueva",
      vendedor: s.nombre,
      marca: pr.brand ?? null,
      modelo: null,
      idCatalogo: null,
      precio: s.precio,
      precioAntes: antes > s.precio ? antes : null,
      envio: null,
      precioFinal: precioFinal(s.precio, null),
      disponible: s.disponible,
      nota: [vendedorExterno ? `Vendido por ${vendedorExterno}` : null, s.disponible ? "Envío por calcular" : "Agotado"]
        .filter(Boolean).join(" · "),
    });
  }
  return salida;
}
