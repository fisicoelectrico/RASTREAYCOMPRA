// Implementación real: habla con Supabase (tablas con RLS + Edge Functions).
import { createClient } from "@supabase/supabase-js";
import type { Api, Vigilado } from "./tipos.ts";

export function crearApiSupabase(url: string, anonKey: string): Api {
  const sb = createClient(url, anonKey);

  const falla = (e: { message: string } | null) => {
    if (e) throw new Error(e.message);
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

    async rastrear(grupo, ofertas, precioObjetivo, consulta) {
      // upsert por (user_id, clave_modelo): rastrear el mismo modelo otra vez actualiza el objetivo.
      const { data: v, error } = await sb
        .from("vigilados")
        .upsert(
          { nombre: grupo.nombre, clave_modelo: grupo.clave, imagen: grupo.imagen, consulta, precio_objetivo: precioObjetivo, activo: true },
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
        .select(`id, nombre, imagen, precio_objetivo, creado_en,
          ofertas ( id, tienda, titulo, url, vendedor, condicion, precio_final, envio, disponible, revisada_en,
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
        ultimaRevision: v.ofertas.map((o: { revisada_en: string }) => o.revisada_en).sort().at(-1) ?? null,
        // deno-lint-ignore no-explicit-any
        ofertas: v.ofertas.map((o: any) => ({
          id: o.id,
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

    async revisarAhora() {
      const { data, error } = await sb.functions.invoke("revisar-precios", { body: { origen: "app" } });
      falla(error);
      return data;
    },
  };
}
