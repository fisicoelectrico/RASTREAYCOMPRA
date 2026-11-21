// Tipos de la app. Los de búsqueda se comparten con las Edge Functions.
export type { Condicion, FiltroCondicion, Grupo, Oferta, ResultadoBusqueda } from "../../../supabase/functions/_shared/tipos.ts";
import type { Condicion, FiltroCondicion, Grupo, Oferta, ResultadoBusqueda } from "../../../supabase/functions/_shared/tipos.ts";

export interface PuntoHistorial {
  t: number; // epoch ms
  precio: number; // precio final
  disponible: boolean;
}

export interface OfertaVigilada {
  id: string;
  clave: string; // "conector:idExterno", para descartarla sin que vuelva a aparecer
  descubierta: boolean; // la encontró la app sola (seguir modelo)
  tienda: string;
  titulo: string;
  url: string;
  vendedor: string | null;
  condicion: Condicion;
  precioFinal: number;
  envio: number | null;
  disponible: boolean;
  revisadaEn: string;
  historial: PuntoHistorial[];
}

export interface Vigilado {
  id: string;
  nombre: string;
  imagen: string | null;
  precioObjetivo: number;
  seguirModelo: boolean;
  ofertas: OfertaVigilada[];
  ultimaRevision: string | null;
}

/** Contra qué se mide la bajada en el censo. */
export type BaseCenso = "mediana" | "anterior" | "normal";

export interface AreaCenso {
  id: string; // "homecenter:electricidad"
  conector: string;
  tienda: string;
  nombre: string;
  nProductos: number;
  truncada: boolean;
  ultimaPasada: string | null;
  interesa: boolean; // el usuario la eligió
}

export interface OfertaCenso {
  id: number;
  tienda: string;
  titulo: string;
  marca: string | null;
  url: string;
  imagen: string | null;
  areas: string[];
  precio: number;
  referencia: number;
  base: BaseCenso;
  bajada: number; // 0,15 = bajó 15 %
  precios30d: number[];
}

export interface AlertaPrecio {
  id: number;
  tipo: "objetivo" | "bajada" | "vuelve_stock" | "prueba";
  titulo: string;
  cuerpo: string;
  url: string | null;
  creadaEn: string;
  leida: boolean;
}

/** Estado de las notificaciones en este navegador/celular. */
export type EstadoNotificaciones = "no-soportado" | "bloqueadas" | "inactivas" | "activas";

export interface Api {
  modo: "supabase" | "demo";
  usuario(): Promise<{ email: string } | null>;
  entrar(email: string, clave: string, crear: boolean): Promise<void>;
  salir(): Promise<void>;
  buscar(consulta: string, filtro: FiltroCondicion): Promise<ResultadoBusqueda>;
  recientes(): Promise<string[]>;
  rastrear(grupo: Grupo, ofertas: Oferta[], precioObjetivo: number, consulta: string, filtro: FiltroCondicion): Promise<void>;
  vigilados(): Promise<Vigilado[]>;
  cambiarObjetivo(id: string, precio: number): Promise<void>;
  dejarDeRastrear(id: string): Promise<void>;
  cambiarSeguimiento(id: string, seguir: boolean): Promise<void>;
  /** Quita una oferta y la recuerda como descartada para que "seguir modelo" no la vuelva a sumar. */
  quitarOferta(vigiladoId: string, oferta: OfertaVigilada): Promise<void>;
  revisarAhora(): Promise<{ revisadas: number; cambiaron: number }>;
  areasCenso(): Promise<AreaCenso[]>;
  cambiarInteres(areaId: string, interesa: boolean): Promise<void>;
  ofertasCenso(o: { areas: string[]; umbral: number; base: BaseCenso }): Promise<OfertaCenso[]>;
  alertas(): Promise<AlertaPrecio[]>;
  marcarLeidas(): Promise<void>;
  notificaciones(): Promise<EstadoNotificaciones>;
  /** Pide permiso, suscribe el navegador (Web Push) y guarda la suscripción. */
  activarNotificaciones(): Promise<EstadoNotificaciones>;
  /** Crea una alerta de prueba y la manda a los celulares de la cuenta. */
  probarNotificacion(): Promise<{ entregas: number }>;
}

export const TIENDA_DE_CONECTOR: Record<string, string> = {
  homecenter: "Homecenter",
  "vtex:exito": "Éxito",
  mercadolibre: "MercadoLibre",
};
