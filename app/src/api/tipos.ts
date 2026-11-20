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
  rastrear(grupo: Grupo, ofertas: Oferta[], precioObjetivo: number, consulta: string): Promise<void>;
  vigilados(): Promise<Vigilado[]>;
  cambiarObjetivo(id: string, precio: number): Promise<void>;
  dejarDeRastrear(id: string): Promise<void>;
  revisarAhora(): Promise<{ revisadas: number; cambiaron: number }>;
}
