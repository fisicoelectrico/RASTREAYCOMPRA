// Alertas de precio: decide, con lo que había antes y lo que se acaba de leer, si hay que avisar.
// Función pura (sin base de datos ni red) para poder probarla sola. La usa revisar-precios.
//
// Tres motivos, en orden de importancia (si se cumplen varios, se manda solo el primero):
//   objetivo     el precio final cruzó el precio objetivo (antes estaba por encima, ahora no)
//   bajada       bajó al menos BAJADA_MINIMA respecto a la revisión anterior
//   vuelve_stock estaba agotado y volvió a estar disponible
// "Cruzar" en vez de "estar por debajo" evita mandar el mismo aviso cada 6 horas.

export const BAJADA_MINIMA = 0.05;

export type TipoAlerta = "objetivo" | "bajada" | "vuelve_stock";

export interface Lectura {
  precioFinal: number;
  disponible: boolean;
}

export interface Alerta {
  tipo: TipoAlerta;
  titulo: string;
  cuerpo: string;
}

const cop = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");

export function decidirAlerta(
  antes: Lectura,
  ahora: Lectura,
  objetivo: number,
  nombre: string,
  tienda: string,
): Alerta | null {
  if (!ahora.disponible) return null;

  if (antes.precioFinal > objetivo && ahora.precioFinal <= objetivo) {
    return {
      tipo: "objetivo",
      titulo: `🎯 ${nombre} llegó a tu precio`,
      cuerpo: `${cop(ahora.precioFinal)} en ${tienda} (tu objetivo: ${cop(objetivo)})`,
    };
  }

  const caida = antes.precioFinal > 0 ? 1 - ahora.precioFinal / antes.precioFinal : 0;
  if (caida >= BAJADA_MINIMA - 1e-9) {
    return {
      tipo: "bajada",
      titulo: `↓ ${Math.round(caida * 100)} % en ${nombre}`,
      cuerpo: `${cop(antes.precioFinal)} → ${cop(ahora.precioFinal)} en ${tienda}`,
    };
  }

  if (!antes.disponible) {
    return {
      tipo: "vuelve_stock",
      titulo: `${nombre} volvió a estar disponible`,
      cuerpo: `${cop(ahora.precioFinal)} en ${tienda}`,
    };
  }
  return null;
}
