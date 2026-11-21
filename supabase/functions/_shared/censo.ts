// Censo de ofertas: recorrer cada día las áreas (categorías) de una tienda, guardar el precio de
// todo lo que aparece y detectar lo que bajó de verdad.
//
// ¿Contra qué se mide "bajó"? (decisión de diseño, ver README sección 3b)
//   - mediana: la mediana de los precios diarios de los últimos 30 días, SIN contar el de hoy.
//     No se deja engañar por "subo el precio una semana y luego lo rebajo". Mientras no haya
//     7 días de historia se usa el precio normal (tachado) que declara la tienda.
//   - anterior: el último precio distinto que se vio (útil para ver qué cambió hoy).
//   - normal: el precio tachado de la tienda.
// Se guardan los tres; la consulta de ofertas elige la base.
//
// Poka-yoke del volumen (Supabase Free = 500 MB):
//   - censo_productos guarda UNA fila por producto con los últimos 30 precios diarios en un arreglo.
//   - censo_precios guarda historia larga SOLO cuando el precio cambia.

import type { Oferta } from "./tipos.ts";

export interface Area {
  id: string; // "homecenter:electricidad"
  conector: "homecenter" | "vtex:exito";
  tienda: string;
  nombre: string;
  /** Homecenter: ids "catNNN". VTEX: rutas de categoría "/34185084/34185124/". */
  categorias: string[];
}

const hc = (slug: string, nombre: string, categorias: string[]): Area => ({
  id: `homecenter:${slug}`,
  conector: "homecenter",
  tienda: "Homecenter",
  nombre,
  categorias,
});
const ex = (slug: string, nombre: string, padre: string, hijos: string[]): Area => ({
  id: `exito:${slug}`,
  conector: "vtex:exito",
  tienda: "Éxito",
  nombre,
  categorias: hijos.map((h) => `/${padre}/${h}/`),
});

/**
 * Áreas disponibles. Homecenter corta la paginación en 9.900 productos por categoría y VTEX en
 * 2.500, así que las áreas grandes se definen con sus subcategorías principales.
 * Ids tomados del menú de cada tienda el 2026-11-21.
 */
export const AREAS: Area[] = [
  hc("energia-solar", "Energía solar", ["cat510001"]),
  hc("electricidad", "Electricidad", ["cat10676"]),
  hc("electrohogar", "Electrodomésticos y tecnología", [
    "cat870002", "cat10850", "cat440005", "cat11308", "cat450001", "cat740116", "cat370014", "cat10388",
    "cat1850003", "cat10396", "cat4230012", "cat7030001", "cat370015", "cat910126",
  ]),
  hc("herramientas", "Herramientas y maquinaria", [
    "cat290012", "cat300003", "cat300005", "cat300008", "cat300009", "cat300010", "cat300017", "cat300031",
    "cat300075", "cat300077", "cat300056", "cat300065", "cat1670375", "cat1670401",
  ]),
  hc("plomeria", "Plomería", ["cat10796"]),
  hc("pinturas", "Pinturas", ["cat10462"]),
  hc("pisos", "Pisos y paredes", ["cat660001"]),
  hc("construccion", "Construcción y maderas", ["cat5510023", "cat10586"]),
  hc("bano-cocina", "Baño y cocina", ["cat70028", "cat70024", "cat740070", "cat40683672", "cat90040"]),
  hc("muebles", "Muebles y colchones", ["cat10334", "cat10344", "cat10310", "cat10320", "cat210003", "cat1660049"]),
  hc("jardin", "Jardín, asados y mascotas", ["cat10030", "cat5730001", "cat10018", "cat1670033"]),
  hc("autos", "Autos", ["cat2950023", "cat10638", "cat10642"]),
  ex("tecnologia", "Tecnología", "34185084", [
    "34185121", "34185122", "34185123", "34185124", "34185125", "34185440", "34185451", "34602478",
    "345008843", "347828138", "347828142", "347828143",
  ]),
  ex("electrodomesticos", "Electrodomésticos", "34185087", [
    "34511595", "34511607", "34511612", "34533761", "34533778", "34533785", "34533787", "348092348",
  ]),
  ex("herramientas", "Herramientas y ferretería", "34185091", [
    "34185165", "34185174", "34185637", "34185638", "348701086", "348701092", "348701093",
  ]),
];

export const DIAS_HISTORIA = 30;
export const DIAS_MINIMOS_MEDIANA = 7;

export function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Día calendario en Colombia (UTC-5, sin horario de verano). */
export function diaColombia(d = new Date()): string {
  return new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 10);
}

/** Estado guardado de un producto del censo (lo que importa para calcular). */
export interface EstadoCenso {
  precio: number;
  precios30d: number[]; // un precio por día, el último es el del día `ultimoDia`
  ultimoDia: string;
  precioAnterior: number | null;
}

export interface Actualizacion {
  precio: number;
  precioNormal: number | null;
  precios30d: number[];
  ultimoDia: string;
  precioAnterior: number | null;
  precioRef: number; // base "mediana" (o el normal mientras no hay 7 días)
  baseRef: "mediana" | "normal";
  cambio: boolean; // el precio cambió respecto a lo guardado → fila en censo_precios
}

/**
 * Combina lo guardado con el precio visto hoy. Pura: sin base de datos, para poder probarla.
 * - Si ya había precio de hoy, se reemplaza (una sola muestra por día).
 * - La mediana de referencia se calcula SIN el día de hoy.
 */
export function actualizar(prev: EstadoCenso | null, precio: number, precioNormal: number | null, hoy: string): Actualizacion {
  let dias = prev ? [...prev.precios30d] : [];
  if (prev && prev.ultimoDia === hoy) dias = dias.slice(0, -1); // reemplazar la muestra de hoy
  const historia = dias.slice(-DIAS_HISTORIA); // días anteriores a hoy
  const med = historia.length >= DIAS_MINIMOS_MEDIANA ? mediana(historia) : null;
  const normal = precioNormal && precioNormal > 0 ? precioNormal : null;
  const precioRef = med ?? Math.max(normal ?? precio, precio);
  const cambio = !prev || prev.precio !== precio;
  return {
    precio,
    precioNormal: normal,
    precios30d: [...historia, precio].slice(-DIAS_HISTORIA),
    ultimoDia: hoy,
    precioAnterior: cambio ? (prev?.precio ?? null) : (prev?.precioAnterior ?? null),
    precioRef,
    baseRef: med !== null ? "mediana" : "normal",
    cambio,
  };
}

/** Porcentaje que bajó respecto a una referencia (0,15 = 15 %). Negativo si subió. */
export const bajada = (precio: number, ref: number | null) => (ref && ref > 0 ? 1 - precio / ref : 0);

/** Lo que el censo guarda de una oferta: el precio normal sale de precioAntes. */
export function datosCenso(o: Oferta) {
  return {
    conector: o.conector,
    id_externo: o.idExterno,
    titulo: o.titulo,
    marca: o.marca,
    url: o.url,
    imagen: o.imagen,
    precio: o.precioFinal,
    precio_normal: o.precioAntes ?? o.precioFinal,
    disponible: o.disponible,
  };
}
