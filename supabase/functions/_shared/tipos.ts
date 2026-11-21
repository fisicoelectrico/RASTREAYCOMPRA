// Tipos comunes a todos los conectores.
// Un conector traduce la respuesta de una tienda a `Oferta`, siempre en COP y
// con el precio final ya calculado. Todo lo demás (agrupar, guardar) no sabe
// de qué tienda vino la oferta.

export type Condicion = "nueva" | "usada";
export type FiltroCondicion = Condicion | "ambas";

export interface Oferta {
  tienda: string; // nombre visible: "MercadoLibre", "Éxito"
  conector: string; // identificador técnico: "mercadolibre", "vtex:exito"
  idExterno: string; // con esto se vuelve a consultar el precio
  titulo: string;
  url: string;
  imagen: string | null;
  condicion: Condicion;
  vendedor: string | null;
  marca: string | null;
  modelo: string | null; // si la tienda lo informa (atributo MODEL de MercadoLibre)
  idCatalogo: string | null; // producto de catálogo (MercadoLibre); une publicaciones del mismo producto
  precio: number; // precio publicado, con IVA
  precioAntes: number | null; // precio tachado, si lo hay
  envio: number | null; // 0 = gratis, null = la tienda no lo informa en la búsqueda
  precioFinal: number; // precio + envío conocido
  disponible: boolean;
  nota: string; // texto corto para la tarjeta: "Envío gratis · TecnoMarket"
}

/** Lo que devuelve una revisión de precio de una oferta ya guardada. */
export interface Revision {
  idExterno: string;
  precio: number;
  envio: number | null;
  precioFinal: number;
  disponible: boolean;
}

export interface Conector {
  id: string;
  tienda: string;
  buscar(consulta: string, filtro: FiltroCondicion): Promise<Oferta[]>;
  /** Vuelve a consultar el precio de varias ofertas. Las que no aparecen se consideran caídas. */
  revisar(idsExternos: string[]): Promise<Revision[]>;
}

export interface Grupo {
  clave: string; // firma estable del modelo; se guarda en vigilados.clave_modelo
  nombre: string;
  marca: string | null;
  imagen: string | null;
  ruido: string | null; // null = coincide; texto = por qué parece otra cosa
  ofertas: Oferta[];
}

export interface ResultadoBusqueda {
  consulta: string;
  filtro: FiltroCondicion;
  grupos: Grupo[];
  /** Tiendas que fallaron; la búsqueda sigue con las demás. */
  errores: { tienda: string; mensaje: string }[];
}

export const precioFinal = (precio: number, envio: number | null) => Math.round(precio + (envio ?? 0));
