// Implementación real: habla con Supabase (tablas con RLS + Edge Functions).
import { createClient } from "@supabase/supabase-js";
import { estadoPush, suscribirPush } from "./push.ts";
import { type Api, type BaseCenso, TIENDA_DE_CONECTOR, type Vigilado } from "./tipos.ts";

export function crearApiSupabase(url: string, anonKey: string): Api {
  const sb = createClient(url, anonKey);

  const falla = (e: { message: string } | null) => {
    if (e) throw new Error(e.message);
  };

  /** Llama una Edge Function y, si falla, muestra el mensaje que devolvió (no el genérico). */
  const invocar = async <T,>(nombre: string, body: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.functions.invoke(nombre, { body });
    if (error) {
      const r = (error as { context?: Response }).context;
      const detalle = r ? await r.json().then((j) => j.error as string).catch(() => null) : null;
      throw new Error(detalle ?? error.message);
    }
    return data as T;
  };

  return {
    modo: "supabase",

    async usuario() {
      const { data } = await sb.auth.getUser();
      return data.user ? { email: data.user.email ?? "" } : null;
    },

    async entrar(email, clave, crear) {
      const r = crear
        ? await sb.auth.signUp({ email, password: clave })
        : await sb.auth.signInWithPassword({ email, password: clave });
      falla(r.error);
    },

    async salir() {
      await sb.auth.signOut();
    },

    async buscar(consulta, filtro) {
      const { data, error } = await sb.functions.invoke("buscar", { body: { consulta, filtro } });
      falla(error);
      return data;
    },

    async recientes() {
      const { data } = await sb.from("busquedas").select("consulta").order("creada_en", { ascending: false }).limit(30);
      return [...new Set((data ?? []).map((r) => r.consulta.toLowerCase()))].slice(0, 6);
    },

    async rastrear(grupo, ofertas, precioObjetivo, consulta, filtro) {
      const idsCatalogo = [...new Set(grupo.ofertas.map((o) => o.idCatalogo).filter((x): x is string => !!x))];
      // upsert por (user_id, clave_modelo): rastrear el mismo modelo otra vez actualiza el objetivo.
      const { data: v, error } = await sb
        .from("vigilados")
        .upsert(
          {
            nombre: grupo.nombre,
            clave_modelo: grupo.clave,
            imagen: grupo.imagen,
            consulta,
            filtro,
            ids_catalogo: idsCatalogo,
            precio_objetivo: precioObjetivo,
            activo: true,
          },
          { onConflict: "user_id,clave_modelo" },
        )
        .select("id")
        .single();
      falla(error);
      const filas = ofertas.map((o) => ({
        vigilado_id: v!.id,
        tienda: o.tienda,
        conector: o.conector,
        id_externo: o.idExterno,
        titulo: o.titulo,
        url: o.url,
        vendedor: o.vendedor,
        condicion: o.condicion,
        precio: o.precio,
        envio: o.envio,
        precio_final: o.precioFinal,
        disponible: o.disponible,
      }));
      const r = await sb.from("ofertas").upsert(filas, { onConflict: "vigilado_id,conector,id_externo", ignoreDuplicates: true });
      falla(r.error);
    },

    async vigilados() {
      const desde = new Date(Date.now() - 90 * 864e5).toISOString();
      const { data, error } = await sb
        .from("vigilados")
        .select(`id, nombre, imagen, precio_objetivo, seguir_modelo, creado_en,
          ofertas ( id, conector, id_externo, descubierta, tienda, titulo, url, vendedor, condicion, precio_final, envio, disponible, revisada_en,
            historial_precios ( precio_final, disponible, capturado_en ) )`)
        .eq("activo", true)
        .gte("ofertas.historial_precios.capturado_en", desde)
        .order("creado_en", { ascending: false });
      falla(error);
      // deno-lint-ignore no-explicit-any
      return (data ?? []).map((v: any): Vigilado => ({
        id: v.id,
        nombre: v.nombre,
        imagen: v.imagen,
        precioObjetivo: v.precio_objetivo,
        seguirModelo: v.seguir_modelo,
        ultimaRevision: v.ofertas.map((o: { revisada_en: string }) => o.revisada_en).sort().at(-1) ?? null,
        // deno-lint-ignore no-explicit-any
        ofertas: v.ofertas.map((o: any) => ({
          id: o.id,
          clave: `${o.conector}:${o.id_externo}`,
          descubierta: o.descubierta,
          tienda: o.tienda,
          titulo: o.titulo,
          url: o.url,
          vendedor: o.vendedor,
          condicion: o.condicion,
          precioFinal: o.precio_final,
          envio: o.envio,
          disponible: o.disponible,
          revisadaEn: o.revisada_en,
          historial: o.historial_precios
            .map((h: { precio_final: number; disponible: boolean; capturado_en: string }) => ({
              t: Date.parse(h.capturado_en),
              precio: h.precio_final,
              disponible: h.disponible,
            }))
            .sort((a: { t: number }, b: { t: number }) => a.t - b.t),
        })),
      }));
    },

    async cambiarObjetivo(id, precio) {
      falla((await sb.from("vigilados").update({ precio_objetivo: precio }).eq("id", id)).error);
    },

    async dejarDeRastrear(id) {
      // Borra el vigilado; sus ofertas e historial caen en cascada.
      falla((await sb.from("vigilados").delete().eq("id", id)).error);
    },

    async cambiarSeguimiento(id, seguir) {
      falla((await sb.from("vigilados").update({ seguir_modelo: seguir }).eq("id", id)).error);
    },

    async quitarOferta(vigiladoId, oferta) {
      // Primero se recuerda como descartada (poka-yoke: si lo segundo falla, no reaparece sola).
      const { data, error } = await sb.from("vigilados").select("ids_descartados").eq("id", vigiladoId).single();
      falla(error);
      const lista = [...new Set([...(data!.ids_descartados ?? []), oferta.clave])];
      falla((await sb.from("vigilados").update({ ids_descartados: lista }).eq("id", vigiladoId)).error);
      falla((await sb.from("ofertas").delete().eq("id", oferta.id)).error);
    },

    async revisarAhora() {
      const { data, error } = await sb.functions.invoke("revisar-precios", { body: { origen: "app" } });
      falla(error);
      return data;
    },

    async areasCenso() {
      const [{ data: areas, error }, { data: mias }] = await Promise.all([
        sb.from("censo_areas").select("id, conector, tienda, nombre, n_productos, truncada, ultima_pasada").order("orden"),
        sb.from("censo_intereses").select("area_id"),
      ]);
      falla(error);
      const elegidas = new Set((mias ?? []).map((m) => m.area_id));
      return (areas ?? []).map((a) => ({
        id: a.id,
        conector: a.conector,
        tienda: a.tienda,
        nombre: a.nombre,
        nProductos: a.n_productos,
        truncada: a.truncada,
        ultimaPasada: a.ultima_pasada,
        interesa: elegidas.has(a.id),
      }));
    },

    async cambiarInteres(areaId, interesa) {
      const r = interesa
        ? await sb.from("censo_intereses").upsert({ area_id: areaId }, { onConflict: "user_id,area_id", ignoreDuplicates: true })
        : await sb.from("censo_intereses").delete().eq("area_id", areaId);
      falla(r.error);
    },

    async alertas() {
      const { data, error } = await sb.from("alertas")
        .select("id, tipo, titulo, cuerpo, url, creada_en, leida")
        .order("creada_en", { ascending: false }).limit(100);
      falla(error);
      return (data ?? []).map((a) => ({
        id: a.id, tipo: a.tipo, titulo: a.titulo, cuerpo: a.cuerpo, url: a.url, creadaEn: a.creada_en, leida: a.leida,
      }));
    },

    async marcarLeidas() {
      const { error } = await sb.from("alertas").update({ leida: true }).eq("leida", false);
      falla(error);
    },

    notificaciones: estadoPush,

    async activarNotificaciones() {
      const { llave } = await invocar<{ llave: string }>("notificar", { accion: "llave" });
      const sub = await suscribirPush(llave);
      const j = sub.toJSON();
      const { error } = await sb.rpc("registrar_dispositivo", {
        p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth,
        p_agente: navigator.userAgent.slice(0, 200),
      });
      falla(error);
      return "activas";
    },

    async probarNotificacion() {
      return invocar<{ entregas: number }>("notificar", { accion: "prueba" });
    },

    async ofertasCenso({ areas, umbral, base }) {
      if (!areas.length) return [];
      const { data, error } = await sb.rpc("ofertas_censo", { p_areas: areas, p_umbral: umbral, p_base: base, p_limite: 200 });
      falla(error);
      return (data ?? []).map((o: Record<string, unknown>) => ({
        id: o.id as number,
        tienda: TIENDA_DE_CONECTOR[o.conector as string] ?? (o.conector as string),
        titulo: o.titulo as string,
        marca: o.marca as string | null,
        url: o.url as string,
        imagen: o.imagen as string | null,
        areas: o.areas as string[],
        precio: o.precio as number,
        referencia: o.referencia as number,
        base: o.base as BaseCenso,
        bajada: Number(o.bajada),
        precios30d: (o.precios_30d as number[]) ?? [],
      }));
    },
  };
}
