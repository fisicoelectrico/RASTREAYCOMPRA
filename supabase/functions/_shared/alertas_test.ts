// Pruebas de la decisión de alertas.  deno test --allow-read supabase/functions/_shared
import { assert, assertEquals } from "jsr:@std/assert@1";
import { decidirAlerta } from "./alertas.ts";

const d = (p: number, disponible = true) => ({ precioFinal: p, disponible });

Deno.test("Alertas: cruzar el objetivo avisa una sola vez", () => {
  const a = decidirAlerta(d(1_050_000), d(990_000), 1_000_000, "RTX 5060", "Éxito");
  assertEquals(a?.tipo, "objetivo");
  assert(a!.cuerpo.includes("990.000"));
  // Siguiente revisión, sigue por debajo con el mismo precio: no repite.
  assertEquals(decidirAlerta(d(990_000), d(990_000), 1_000_000, "RTX 5060", "Éxito"), null);
});

Deno.test("Alertas: bajada de 5 % o más; 4 % no", () => {
  assertEquals(decidirAlerta(d(100_000), d(95_000), 50_000, "X", "T")?.tipo, "bajada");
  assertEquals(decidirAlerta(d(100_000), d(96_000), 50_000, "X", "T"), null);
  // Ya bajo el objetivo, una bajada extra fuerte también avisa.
  assertEquals(decidirAlerta(d(900_000), d(800_000), 1_000_000, "X", "T")?.tipo, "bajada");
});

Deno.test("Alertas: vuelve a stock y agotado no avisa", () => {
  assertEquals(decidirAlerta(d(100_000, false), d(100_000), 50_000, "X", "T")?.tipo, "vuelve_stock");
  assertEquals(decidirAlerta(d(100_000), d(50_000, false), 60_000, "X", "T"), null);
});

Deno.test("Alertas: subir de precio no avisa", () => {
  assertEquals(decidirAlerta(d(100_000), d(120_000), 50_000, "X", "T"), null);
});
