import { crearApiDemo } from "./demo.ts";
import { crearApiSupabase } from "./supabase.ts";
import type { Api } from "./tipos.ts";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Con credenciales de Supabase usa el backend real; sin ellas, el modo demo. */
export const api: Api = url && key ? crearApiSupabase(url, key) : crearApiDemo();
export * from "./tipos.ts";
