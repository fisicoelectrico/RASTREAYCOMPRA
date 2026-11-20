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
}
