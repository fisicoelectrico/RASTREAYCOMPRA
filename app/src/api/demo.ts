// MODO DEMO: sin Supabase. Usa respuestas grabadas de MercadoLibre y Éxito
// (las mismas de las pruebas) y la MISMA función agrupar() de las Edge Functions,
// así lo que ves en la demo es lo que hará la app real con datos reales.
// El historial de precios es simulado. Se guarda en localStorage de este navegador.
import { agrupar } from "../../../supabase/functions/_shared/agrupar.ts";
import { resultadoAOferta } from "../../../supabase/functions/_shared/mercadolibre.ts";
import { EXITO, productoAOfertas } from "../../../supabase/functions/_shared/vtex.ts";
import ml from "../../../supabase/functions/_shared/fixtures/ml_rtx5060.json";
import exito from "../../../supabase/functions/_shared/fixtures/vtex_exito_rtx5060.json";
import { leerPagina } from "../../../supabase/functions/_shared/homecenter.ts";
import { actualizar, AREAS, bajada, diaColombia } from "../../../supabase/functions/_shared/censo.ts";
import hcTaladros from "../../../supabase/functions/_shared/fixtures/homecenter_taladros.json";
import type { Api, AreaCenso, BaseCenso, Oferta, OfertaCenso, PuntoHistorial, Vigilado } from "./tipos.ts";

const extra = (tienda: string, id: string, titulo: string, precio: number, cond: "nueva" | "usada" = "nueva", marca: string | null = null): Oferta => ({
  tienda, conector: tienda === "MercadoLibre" ? "mercadolibre" : "vtex:exito", idExterno: id, titulo,
  url: tienda === "MercadoLibre" ? "https://www.mercadolibre.com.co" : "https://www.exito.com", imagen: null,
  condicion: cond, vendedor: null, marca, modelo: null, idCatalogo: null, precio, precioAntes: null,
  envio: tienda === "MercadoLibre" ? 0 : null, precioFinal: precio, disponible: true,
  nota: tienda === "MercadoLibre" ? (cond === "usada" ? "Envío gratis · Usada" : "Envío gratis") : "Envío por calcular",
});

const CATALOGO: Oferta[] = [
  ...(ml.results.map(resultadoAOferta).filter(Boolean) as Oferta[]),
  ...exito.flatMap((p) => productoAOfertas(p, EXITO)),
  extra("MercadoLibre", "MCO-F1", "Multímetro Fluke 117 True Rms Original", 1249000, "nueva", "Fluke"),
  extra("MercadoLibre", "MCO-F2", "Multimetro Fluke 117 Usado Calibrado 2025", 820000, "usada", "Fluke"),
  extra("Éxito", "EX-F1", "Multímetro Digital Fluke 117 True RMS", 1399900, "nueva", "Fluke"),
  extra("MercadoLibre", "MCO-H1", "Microinversor Hoymiles Hms-800w-2t Wifi", 1120000, "nueva", "Hoymiles"),
  extra("MercadoLibre", "MCO-H2", "Microinversor Hoymiles HMS 800W 2T Monofásico 220V", 1165000, "nueva", "Hoymiles"),
  extra("MercadoLibre", "MCO-H3", "Microinversor Hoymiles Hms-1600w-4t", 1890000, "nueva", "Hoymiles"),
  ...leerPagina(hcTaladros).ofertas,
];

/**
 * Censo simulado: los taladros grabados de Homecenter con 30 días de historia inventada,
 * pasados por la MISMA función actualizar() del servidor. Unos bajaron de verdad, otros no.
 */
function censoDemo(): (OfertaCenso & { normal: number; anterior: number | null })[] {
  const hoy = diaColombia();
  return leerPagina(hcTaladros).ofertas.map((o, i) => {
    const normal = o.precioAntes ?? o.precioFinal;
    // Historia: 2 de cada 3 estuvieron 30 días al precio normal (bajada real); el resto ya estaba así.
    const antes = i % 3 !== 2 ? normal : o.precioFinal;
    const prev = { precio: antes, precios30d: Array(29).fill(antes), ultimoDia: "2000-01-01", precioAnterior: null };
    const a = actualizar(prev, o.precioFinal, o.precioAntes, hoy);
    return {
      id: i + 1, tienda: o.tienda, titulo: o.titulo, marca: o.marca, url: o.url, imagen: o.imagen,
      areas: ["homecenter:herramientas"], precio: a.precio, referencia: a.precioRef, base: a.baseRef,
      bajada: bajada(a.precio, a.precioRef), precios30d: a.precios30d, normal, anterior: a.precioAnterior,
    };
  });
}

const CLAVE = "rastreaycompra-demo-v1";
interface Estado { vigilados: Vigilado[]; recientes: string[]; areas?: string[] }
const leer = (): Estado => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE) ?? "") as Estado;
  } catch {
    return { vigilados: [], recientes: [] };
  }
};
const guardar = (e: Estado) => {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(e));
  } catch { /* modo privado: la demo sigue en memoria */ }
};
let estado = leer();

/** Historial simulado: 90 días, un punto cada 6 h, con bajadas y subidas ocasionales. */
function historialSimulado(semilla: number, final: number): PuntoHistorial[] {
  let s = semilla;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const n = 90 * 4;
  let p = final * (1.05 + r() * 0.08);
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = r();
    if (x < 0.012) p *= 0.95 + r() * 0.03;
    else if (x < 0.022) p *= 1.02 + r() * 0.03;
    vals.push(p);
  }
  const k = final / vals[n - 1];
  const ahora = Date.now();
  return vals.map((v, i) => ({
    t: ahora - (n - 1 - i) * 6 * 3600e3,
    precio: i === n - 1 ? final : Math.round((v * k) / 100) * 100,
    disponible: true,
  }));
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function crearApiDemo(): Api {
  return {
    modo: "demo",
    async usuario() {
      return { email: "demo@rastreaycompra" };
    },
    async entrar() {},
    async salir() {},

    async buscar(consulta, filtro) {
      await espera(450); // simula la consulta a las tiendas
      const ofertas = CATALOGO.filter((o) => filtro === "ambas" || o.condicion === filtro);
      const grupos = agrupar(ofertas, consulta);
      estado.recientes = [consulta.toLowerCase(), ...estado.recientes.filter((x) => x !== consulta.toLowerCase())].slice(0, 6);
      guardar(estado);
      return { consulta, filtro, grupos, errores: [] };
    },

    async recientes() {
      return estado.recientes.length ? estado.recientes : ["rtx 5060", "fluke 117", "hoymiles hms-800w"];
    },

    async rastrear(grupo, ofertas, precioObjetivo) {
      const id = `demo-${grupo.clave}`;
      const previo = estado.vigilados.find((v) => v.id === id);
      const nuevo: Vigilado = {
        id,
        nombre: grupo.nombre,
        imagen: grupo.imagen,
        precioObjetivo,
        seguirModelo: true,
        ultimaRevision: new Date(Date.now() - 38 * 60e3).toISOString(),
        ofertas: ofertas.map((o, i) => ({
          id: `${o.conector}:${o.idExterno}`,
          clave: `${o.conector}:${o.idExterno}`,
          descubierta: false,
          tienda: o.tienda,
          titulo: o.titulo,
          url: o.url,
          vendedor: o.vendedor,
          condicion: o.condicion,
          precioFinal: o.precioFinal,
          envio: o.envio,
          disponible: o.disponible,
          revisadaEn: new Date().toISOString(),
          historial: historialSimulado(o.idExterno.length * 977 + i * 131 + o.precio % 9973, o.precioFinal),
        })),
      };
      estado.vigilados = [nuevo, ...estado.vigilados.filter((v) => v !== previo)];
      guardar(estado);
    },

    async vigilados() {
      return estado.vigilados;
    },
    async cambiarObjetivo(id, precio) {
      estado.vigilados = estado.vigilados.map((v) => (v.id === id ? { ...v, precioObjetivo: precio } : v));
      guardar(estado);
    },
    async dejarDeRastrear(id) {
      estado.vigilados = estado.vigilados.filter((v) => v.id !== id);
      guardar(estado);
    },
    async cambiarSeguimiento(id, seguir) {
      estado.vigilados = estado.vigilados.map((v) => (v.id === id ? { ...v, seguirModelo: seguir } : v));
      guardar(estado);
    },
    async quitarOferta(vigiladoId, oferta) {
      estado.vigilados = estado.vigilados.map((v) =>
        v.id === vigiladoId ? { ...v, ofertas: v.ofertas.filter((o) => o.id !== oferta.id) } : v
      );
      guardar(estado);
    },
    async revisarAhora() {
      await espera(600);
      estado.vigilados = estado.vigilados.map((v) => ({ ...v, ultimaRevision: new Date().toISOString() }));
      guardar(estado);
      return { revisadas: estado.vigilados.reduce((n, v) => n + v.ofertas.length, 0), cambiaron: 0 };
    },

    async areasCenso(): Promise<AreaCenso[]> {
      await espera(200);
      const mias = new Set(estado.areas ?? ["homecenter:herramientas"]);
      return AREAS.map((a) => ({
        id: a.id, conector: a.conector, tienda: a.tienda, nombre: a.nombre,
        nProductos: a.id === "homecenter:herramientas" ? 6 : 0, truncada: false,
        ultimaPasada: a.id === "homecenter:herramientas" ? new Date().toISOString() : null,
        interesa: mias.has(a.id),
      }));
    },

    async cambiarInteres(areaId, interesa) {
      const mias = new Set(estado.areas ?? ["homecenter:herramientas"]);
      if (interesa) mias.add(areaId);
      else mias.delete(areaId);
      estado.areas = [...mias];
      guardar(estado);
    },

    async ofertasCenso({ areas, umbral, base }: { areas: string[]; umbral: number; base: BaseCenso }) {
      await espera(300);
      return censoDemo()
        .filter((o) => o.areas.some((a) => areas.includes(a)))
        .map((o) => {
          const ref = base === "normal" ? o.normal : base === "anterior" ? o.anterior : o.referencia;
          return { ...o, referencia: ref ?? 0, base: base === "mediana" ? o.base : base, bajada: bajada(o.precio, ref) };
        })
        .filter((o) => o.referencia > 0 && o.bajada >= umbral)
        .sort((a, b) => b.bajada - a.bajada);
    },
  };
}

export function reiniciarDemo() {
  estado = { vigilados: [], recientes: [] };
  guardar(estado);
}
