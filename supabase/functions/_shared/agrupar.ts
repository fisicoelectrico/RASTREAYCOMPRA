// Agrupación de ofertas por modelo.
//
// Problema: "rtx 5060" devuelve decenas de publicaciones que describen el mismo
// producto con palabras distintas ("Tarjeta De Video Msi Geforce Rtx 5060 Ventus 2x Oc 8gb"
// en MercadoLibre, "MSI GeForce RTX 5060 8GB Ventus 2X OC" en Éxito), y además
// cosas que contienen la búsqueda pero son otro producto (un portátil con esa
// tarjeta, la versión Ti).
//
// Solución en 4 pasos, sin IA ni dependencias, para que sea predecible:
//   1. Normalizar el título: minúsculas, sin tildes, "8 GB" → "8gb", sin palabras genéricas.
//   2. Descartar lo que no contiene todas las palabras buscadas.
//   3. Marcar ruido: variantes (Ti, Super, Pro...) y otras categorías (portátil, accesorio).
//   4. Agrupar por similitud de palabras (Jaccard) con dos candados (poka-yoke):
//      misma marca, y ningún número en conflicto (8gb ≠ 16gb, 5060 ≠ 5070, 2x ≠ 3x).

import type { Grupo, Oferta } from "./tipos.ts";

const UNIDADES = "gb|tb|mb|w|kw|v|hz|mah|mm|cm|m|kg|g|l|ml|in|pulgadas|btu|a|ah|wh|rpm|mp|x";

/** Palabras que no ayudan a distinguir un modelo de otro. */
const GENERICAS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "y",
  "e",
  "en",
  "con",
  "sin",
  "por",
  "un",
  "una",
  "the",
  "and",
  "with",
  "nuevo",
  "nueva",
  "nuevos",
  "original",
  "originales",
  "oferta",
  "envio",
  "gratis",
  "garantia",
  "factura",
  "tarjeta",
  "video",
  "grafica",
  "graficas",
  "nvidia",
  "geforce",
  "amd",
  "radeon",
  "gpu",
  "color",
  "negro",
  "negra",
  "blanco",
  "blanca",
  "unidad",
  "und",
  "pack",
]);

/** Sufijos que cambian el modelo cuando van justo después del número buscado. */
const VARIANTES: Record<string, string> = {
  ti: "Ti",
  super: "Super",
  xt: "XT",
  xtx: "XTX",
  pro: "Pro",
  max: "Max",
  plus: "Plus",
  ultra: "Ultra",
  mini: "Mini",
  lite: "Lite",
  fe: "Founders Edition",
};

/** Palabras que, al inicio del título, indican otra categoría de producto. */
const CATEGORIAS: [RegExp, string][] = [
  [
    /^(portatil|laptop|notebook|computador|computadora|pc|torre|equipo|all in one)$/,
    "Es un equipo completo que incluye ese componente",
  ],
  [
    /^(funda|estuche|forro|protector|vidrio|mica|cable|soporte|base|repuesto|adaptador|cargador|backplate|sticker|caja)$/,
    "Parece un accesorio, no el producto",
  ],
];

const MARCAS = new Set([
  "msi",
  "asus",
  "gigabyte",
  "zotac",
  "pny",
  "evga",
  "galax",
  "palit",
  "inno3d",
  "xfx",
  "sapphire",
  "powercolor",
  "asrock",
  "gainward",
  "colorful",
  "maxsun",
  "samsung",
  "lg",
  "sony",
  "xiaomi",
  "apple",
  "lenovo",
  "hp",
  "dell",
  "acer",
  "huawei",
  "motorola",
  "hoymiles",
  "growatt",
  "huawei",
  "fronius",
  "victron",
  "fluke",
  "uni-t",
  "dewalt",
  "bosch",
  "makita",
  "black+decker",
  "stanley",
  "truper",
  "philips",
  "kalley",
  "challenger",
  "haceb",
  "logitech",
  "corsair",
  "kingston",
  "crucial",
  "western",
  "seagate",
  "intel",
  "ryzen",
  "redragon",
  "hyperx",
  "razer",
  "aoc",
  "benq",
  "viewsonic",
  "tp-link",
  "mercusys",
]);

export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^a-z0-9.+\- ]+/g, " ")
    .replace(/(^|\s)[.\-+]+|[.\-+]+(?=\s|$)/g, " ")
    .replace(new RegExp(`(\\d)\\s+(${UNIDADES})\\b`, "g"), "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

export const palabras = (texto: string): string[] => normalizar(texto).split(" ").filter(Boolean);
const utiles = (ws: string[]) => ws.filter((w) => !GENERICAS.has(w));
const tieneDigito = (w: string) => /\d/.test(w);
/** "8gb" → "#gb", "5060" → "#", "2x" → "#x": la "clase" del número, para detectar conflictos. */
const clase = (w: string) => w.replace(/\d+(\.\d+)?/g, "#");

/** ¿El título contiene todas las palabras buscadas? Tolera "rtx5060" vs "rtx 5060". */
export function coincide(titulo: string, consulta: string): boolean {
  const t = palabras(titulo);
  const compacto = t.join("");
  return utiles(palabras(consulta)).every((q) => t.includes(q) || compacto.includes(q));
}

/** Devuelve por qué una oferta parece otra cosa, o null si es lo que se buscó. */
export function motivoRuido(titulo: string, consulta: string): string | null {
  const t = palabras(titulo);
  const q = new Set(palabras(consulta));

  // a) Variante: el sufijo va justo después de un número de la búsqueda ("5060 ti").
  for (const n of [...q].filter(tieneDigito)) {
    const i = t.indexOf(n);
    const sig = i >= 0 ? t[i + 1] : undefined;
    if (sig && VARIANTES[sig] && !q.has(sig)) return `Es la versión ${VARIANTES[sig]}`;
  }

  // b) Otra categoría: las primeras palabras dicen qué es el producto.
  for (const w of t.slice(0, 3)) {
    if (q.has(w)) break;
    for (const [re, motivo] of CATEGORIAS) if (re.test(w)) return motivo;
  }

  // c) "... para RTX 5060": todo lo buscado aparece después de "para".
  const iPara = t.indexOf("para");
  if (iPara >= 0 && !q.has("para")) {
    const antes = t.slice(0, iPara).join("");
    if (utiles([...q]).every((w) => !antes.includes(w))) return "Parece un accesorio para ese producto";
  }
  return null;
}

function marcaDe(o: Oferta, ws: string[]): string | null {
  if (o.marca) return normalizar(o.marca).split(" ")[0] || null;
  return ws.find((w) => MARCAS.has(w)) ?? null;
}

interface Ficha {
  o: Oferta;
  tokens: Set<string>;
  marca: string | null;
  numeros: Map<string, Set<string>>; // clase → valores
}

function ficha(o: Oferta): Ficha {
  const ws = utiles(palabras(`${o.titulo} ${o.modelo ?? ""}`));
  const marca = marcaDe(o, ws);
  const numeros = new Map<string, Set<string>>();
  for (const w of ws.filter(tieneDigito)) {
    const c = clase(w);
    if (!numeros.has(c)) numeros.set(c, new Set());
    numeros.get(c)!.add(w);
  }
  return { o, tokens: new Set(ws.filter((w) => w !== marca)), marca, numeros };
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/** Poka-yoke: dos ofertas con números distintos de la misma clase NO son el mismo modelo
 *  (8gb vs 16gb, 5060 vs 5070, 2x vs 3x). */
function numerosEnConflicto(a: Ficha, b: Ficha): boolean {
  for (const [c, va] of a.numeros) {
    const vb = b.numeros.get(c);
    if (!vb) continue;
    // Si uno contiene al otro ({8gb} ⊂ {8gb, 16gb}) es solo un título más detallado.
    const aEnB = [...va].every((x) => vb.has(x));
    const bEnA = [...vb].every((x) => va.has(x));
    if (!aEnB && !bEnA) return true;
  }
  return false;
}

export const UMBRAL_SIMILITUD = 0.5;

function mismoModelo(a: Ficha, b: Ficha): boolean {
  if (a.o.idCatalogo && a.o.idCatalogo === b.o.idCatalogo) return true;
  if (a.marca && b.marca && a.marca !== b.marca) return false;
  if (numerosEnConflicto(a, b)) return false;
  return jaccard(a.tokens, b.tokens) >= UMBRAL_SIMILITUD;
}

function nombreDelGrupo(fichas: Ficha[]): string {
  // Preferimos el título de una cadena (suelen ser más limpios que los de marketplace)
  // y, entre esos, el más corto que conserve la marca.
  const orden = [...fichas].sort((a, b) => {
    const ta = a.o.conector === "mercadolibre" ? 1 : 0;
    const tb = b.o.conector === "mercadolibre" ? 1 : 0;
    return ta - tb || a.o.titulo.length - b.o.titulo.length;
  });
  return orden[0].o.titulo.replace(/\s+/g, " ").trim();
}

function claveDelGrupo(fichas: Ficha[]): string {
  // Palabras presentes en la mayoría del grupo: estable aunque cambie el orden de llegada.
  const cuenta = new Map<string, number>();
  for (const f of fichas) for (const t of f.tokens) cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
  const comunes = [...cuenta].filter(([, n]) => n * 2 >= fichas.length).map(([t]) => t).sort();
  return `${fichas[0].marca ?? "sin-marca"}|${comunes.join(" ")}`;
}

function agruparFichas(fichas: Ficha[]): Ficha[][] {
  const grupos: Ficha[][] = [];
  for (const f of fichas) {
    let mejor: Ficha[] | null = null;
    let mejorScore = -1;
    for (const g of grupos) {
      if (!g.every((m) => !numerosEnConflicto(m, f))) continue;
      const score = Math.max(...g.map((m) => (mismoModelo(m, f) ? jaccard(m.tokens, f.tokens) + 1 : -1)));
      if (score > mejorScore && score >= 0) {
        mejor = g;
        mejorScore = score;
      }
    }
    if (mejor) mejor.push(f);
    else grupos.push([f]);
  }
  return grupos;
}

const minimo = (g: Grupo) => Math.min(...g.ofertas.map((o) => o.precioFinal));

/** Punto de entrada: ofertas crudas de todas las tiendas → grupos por modelo. */
export function agrupar(ofertas: Oferta[], consulta: string): Grupo[] {
  const validas = ofertas.filter((o) => o.precioFinal > 0 && coincide(o.titulo, consulta));
  const conRuido = new Map<Oferta, string | null>(validas.map((o) => [o, motivoRuido(o.titulo, consulta)]));

  const salida: Grupo[] = [];
  for (const esRuido of [false, true]) {
    const fichas = validas.filter((o) => !!conRuido.get(o) === esRuido).map(ficha);
    for (const g of agruparFichas(fichas)) {
      const ofs = g.map((f) => f.o).sort((a, b) => a.precioFinal - b.precioFinal);
      salida.push({
        clave: claveDelGrupo(g),
        nombre: nombreDelGrupo(g),
        marca: g[0].marca,
        imagen: ofs.find((o) => o.imagen)?.imagen ?? null,
        ruido: esRuido ? conRuido.get(g[0].o) ?? null : null,
        ofertas: ofs,
      });
    }
  }
  // Primero lo que coincide; dentro, los modelos con más ofertas y luego el más barato.
  return salida.sort((a, b) =>
    Number(!!a.ruido) - Number(!!b.ruido) || b.ofertas.length - a.ofertas.length || minimo(a) - minimo(b)
  );
}

// ---------------------------------------------------------------------------
// Seguir el modelo: reencontrar "el mismo grupo" en una búsqueda nueva.
// ---------------------------------------------------------------------------

/** Similitud mínima entre claves para considerar que dos grupos son el mismo modelo. */
export const UMBRAL_MISMO_GRUPO = 0.6;

const partesClave = (clave: string) => {
  const [marca, resto = ""] = clave.split("|");
  return { marca, tokens: new Set(resto.split(" ").filter(Boolean)) };
};

/**
 * Busca, entre los grupos de una búsqueda nueva, el que corresponde a un modelo vigilado.
 * Orden de confianza:
 *   1. Un grupo que contenga un producto de catálogo de MercadoLibre ya conocido (exacto).
 *   2. La misma clave.
 *   3. La clave más parecida (Jaccard ≥ 0,6), con la misma marca y sin números en conflicto.
 * Nunca devuelve un grupo marcado como ruido.
 */
export function encontrarGrupo(grupos: Grupo[], clave: string, idsCatalogo: string[] = []): Grupo | null {
  const candidatos = grupos.filter((g) => !g.ruido);
  if (idsCatalogo.length) {
    const porCatalogo = candidatos.find((g) =>
      g.ofertas.some((o) => o.idCatalogo && idsCatalogo.includes(o.idCatalogo))
    );
    if (porCatalogo) return porCatalogo;
  }
  const exacto = candidatos.find((g) => g.clave === clave);
  if (exacto) return exacto;

  const buscada = partesClave(clave);
  const numeros = (ts: Set<string>) => {
    const m = new Map<string, Set<string>>();
    for (const t of ts) {
      if (!tieneDigito(t)) continue;
      const c = clase(t);
      if (!m.has(c)) m.set(c, new Set());
      m.get(c)!.add(t);
    }
    return m;
  };
  const numBuscada = numeros(buscada.tokens);
  let mejor: Grupo | null = null;
  let mejorScore = 0;
  for (const g of candidatos) {
    const p = partesClave(g.clave);
    if (p.marca !== buscada.marca) continue;
    const numG = numeros(p.tokens);
    let conflicto = false;
    for (const [c, va] of numBuscada) {
      const vb = numG.get(c);
      if (vb && ![...va].every((x) => vb.has(x)) && ![...vb].every((x) => va.has(x))) conflicto = true;
    }
    if (conflicto) continue;
    const s = jaccard(buscada.tokens, p.tokens);
    if (s >= UMBRAL_MISMO_GRUPO && s > mejorScore) {
      mejor = g;
      mejorScore = s;
    }
  }
  return mejor;
}

/** Ofertas del grupo que todavía no se siguen ni fueron descartadas por el usuario. */
export function ofertasNuevas(
  grupo: Grupo,
  yaSeguidas: Set<string>, // "conector:idExterno"
  descartadas: Set<string>,
  filtro: "nueva" | "usada" | "ambas",
  maximo = 10,
): Grupo["ofertas"] {
  return grupo.ofertas
    .filter((o) => filtro === "ambas" || o.condicion === filtro)
    .filter((o) => o.disponible)
    .filter((o) => {
      const k = `${o.conector}:${o.idExterno}`;
      return !yaSeguidas.has(k) && !descartadas.has(k);
    })
    .slice(0, maximo); // ya vienen ordenadas por precio: si hay muchas, entran las más baratas
}
