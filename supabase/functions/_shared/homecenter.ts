// Conector de Homecenter Colombia (Sodimac). No es VTEX: usa la API JSON de su propio buscador,
// la misma que llama la página web. Responde a servidores sin token (comprobado 2026-11-21).
//
//   Buscar:     GET https://www.homecenter.com.co/s/search/v1/soco?q=<texto>&page=1
//   Categoría:  GET https://www.homecenter.com.co/s/search/v1/soco/category/products?categoryId=cat10676&page=N
//   Revisar:    la misma búsqueda con el SKU como texto (q=874670) devuelve ese producto.
//
// 40 productos por página. La paginación se corta en 9.900 resultados por consulta,
// así que las áreas grandes se recorren por subcategorías (ver censo.ts).
//
// Precios: cada producto trae una lista "prices" con tipos NORMAL, INTERNET y CMR.
//   - Precio final = el menor entre NORMAL e INTERNET (lo que paga cualquiera).
//   - CMR exige la tarjeta de Falabella: se muestra en la nota, no se usa como precio final.
//   - NORMAL, si es mayor que el precio final, es el precio "antes" (tachado).

import type { Conector, FiltroCondicion, Oferta, Revision } from "./tipos.ts";
import { precioFinal } from "./tipos.ts";

const BASE = "https://www.homecenter.com.co";
const API = `${BASE}/s/search/v1/soco`;

// deno-lint-ignore no-explicit-any
type Json = any;

export interface PaginaCategoria {
  ofertas: Oferta[];
  /** Total que informa la tienda (máx. 9.900). */
  total: number;
  porPagina: number;
}

export function crearConectorHomecenter(op: { fetch?: typeof fetch } = {}) {
  const f = op.fetch ?? fetch;

  async function getJson(url: string): Promise<Json> {
    const r = await f(url, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (RastreaYCompra; +seguimiento de precios)" },
    });
    if (!r.ok) throw new Error(`Homecenter respondió ${r.status}`);
    return r.json();
  }

  async function categoria(categoryId: string, pagina = 1): Promise<PaginaCategoria> {
    const p = new URLSearchParams({ categoryId, page: String(pagina) });
    const j = await getJson(`${API}/category/products?${p}`);
    return leerPagina(j);
  }

  const conector: Conector & { categoria: typeof categoria } = {
    id: "homecenter",
    tienda: "Homecenter",
    categoria,

    async buscar(consulta: string, filtro: FiltroCondicion): Promise<Oferta[]> {
      if (filtro === "usada") return []; // Homecenter solo vende nuevo
      const j = await getJson(`${API}?${new URLSearchParams({ q: consulta, page: "1" })}`);
      // Algunas búsquedas ("taladro") no traen resultados sino una redirección a su categoría.
      const redir: string | undefined = j?.data?.redirectUrl;
      const cat = redir?.match(/\/category\/(cat\d+)/)?.[1];
      if (cat) return (await categoria(cat, 1)).ofertas;
      return leerPagina(j).ofertas;
    },

    async revisar(ids: string[]): Promise<Revision[]> {
      // No hay consulta por lote: una búsqueda por SKU, de a 5 en paralelo.
      const salida: Revision[] = [];
      for (let i = 0; i < ids.length; i += 5) {
        const lote = ids.slice(i, i + 5);
        const res = await Promise.allSettled(lote.map(async (id) => {
          const j = await getJson(`${API}?${new URLSearchParams({ q: id, page: "1" })}`);
          const o = leerPagina(j).ofertas.find((x) => x.idExterno === id);
          return o ? aRevision(o) : null;
        }));
        for (const r of res) if (r.status === "fulfilled" && r.value) salida.push(r.value);
      }
      return salida;
    },
  };
  return conector;
}

const aRevision = (o: Oferta): Revision => ({
  idExterno: o.idExterno,
  precio: o.precio,
  envio: o.envio,
  precioFinal: o.precioFinal,
  disponible: o.disponible,
});

/** Respuesta de la API → ofertas + paginación. Exportado para pruebas. */
export function leerPagina(j: Json): PaginaCategoria {
  const resultados: Json[] = j?.data?.results ?? [];
  const pag = j?.data?.pagination ?? {};
  return {
    ofertas: resultados.map(productoAOferta).filter((o): o is Oferta => !!o),
    total: Number(pag.count ?? resultados.length),
    porPagina: Number(pag.perPage ?? 40),
  };
}

/** Un producto de Homecenter → Oferta. Exportado para pruebas. */
export function productoAOferta(p: Json): Oferta | null {
  const precios = preciosDe(p);
  if (!precios) return null;
  const { final, normal, tarjeta } = precios;
  const id = String(p.skuId ?? p.productId);
  const nota = [
    tarjeta && tarjeta < final ? `Con tarjeta CMR: $${tarjeta.toLocaleString("es-CO")}` : null,
    "Envío por calcular",
  ].filter(Boolean).join(" · ");
  return {
    tienda: "Homecenter",
    conector: "homecenter",
    idExterno: id,
    titulo: String(p.displayName ?? "").trim(),
    url: `${BASE}/homecenter-co/product/${encodeURIComponent(String(p.productId ?? id))}/`,
    imagen: (Array.isArray(p.mediaUrls) ? p.mediaUrls[0] : p.mediaUrls) ?? null,
    condicion: "nueva",
    vendedor: "Homecenter",
    marca: p.brand ?? null,
    modelo: p.model ?? null,
    idCatalogo: null,
    precio: final,
    precioAntes: normal > final ? normal : null,
    envio: null,
    precioFinal: precioFinal(final, null),
    disponible: true, // la API de listado solo muestra lo que se puede comprar
    nota,
  };
}

/** Lee la lista "prices": final (sin tarjeta), normal y CMR. Exportado para el censo. */
export function preciosDe(p: Json): { final: number; normal: number; tarjeta: number | null } | null {
  const lista: Json[] = Array.isArray(p?.prices) ? p.prices : [];
  const valor = (tipo: string) => {
    const x = lista.find((q) => q.type === tipo);
    const n = Number(x?.priceWithoutFormatting);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const normal = valor("NORMAL");
  const internet = valor("INTERNET");
  const sinTarjeta = [normal, internet].filter((n): n is number => n !== null);
  if (!sinTarjeta.length) return null;
  const final = Math.min(...sinTarjeta);
  return { final, normal: normal ?? final, tarjeta: valor("CMR") };
}
