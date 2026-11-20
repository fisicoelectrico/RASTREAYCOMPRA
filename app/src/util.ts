import type { OfertaVigilada, PuntoHistorial, Vigilado } from "./api/index.ts";

export const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
export const pct = (n: number) => Math.abs(n).toFixed(1).replace(".", ",") + " %";

const COLORES: Record<string, string> = {
  MercadoLibre: "var(--s1)", Alkosto: "var(--s2)", Ktronix: "var(--s3)", "Éxito": "var(--s4)",
  Homecenter: "var(--s5)", Easy: "var(--s5)", Amazon: "var(--s6)",
};
export const colorTienda = (t: string) => COLORES[t] ?? "var(--s6)";

export function haceCuanto(iso: string | null): string {
  if (!iso) return "sin revisar";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60e3);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export const mejorOferta = (v: Vigilado): OfertaVigilada | null => {
  const disp = v.ofertas.filter((o) => o.disponible);
  const pool = disp.length ? disp : v.ofertas;
  return pool.length ? pool.reduce((a, b) => (b.precioFinal < a.precioFinal ? b : a)) : null;
};

/** Precio de una oferta en el instante t (último punto conocido antes de t). */
function precioEn(h: PuntoHistorial[], t: number): number | null {
  let p: number | null = null;
  for (const x of h) {
    if (x.t > t) break;
    if (x.disponible) p = x.precio;
  }
  return p;
}

/** Serie del mejor precio entre todas las ofertas, muestreada en `n` puntos de los últimos `dias`. */
export function serieMejor(v: Vigilado, dias: number, n = 60): { t: number; precio: number }[] {
  const fin = Date.now();
  const ini = fin - dias * 864e5;
  const salida: { t: number; precio: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = ini + ((fin - ini) * i) / (n - 1);
    const ps = v.ofertas.map((o) => precioEn(o.historial, t)).filter((p): p is number => p !== null);
    if (ps.length) salida.push({ t, precio: Math.min(...ps) });
  }
  return salida;
}

/** Variación del mejor precio en los últimos `dias` (negativo = bajó). */
export function variacion(v: Vigilado, dias = 30): number {
  const s = serieMejor(v, dias, 30);
  if (s.length < 2) return 0;
  return ((s[s.length - 1].precio - s[0].precio) / s[0].precio) * 100;
}

export function pasoBonito(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
