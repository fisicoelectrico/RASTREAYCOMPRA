// Pruebas del conector Homecenter y de la lógica del censo (sin internet).
// Ejecutar:  deno test --allow-read supabase/functions/_shared
import { assert, assertEquals } from "jsr:@std/assert@1";
import { crearConectorHomecenter, leerPagina, preciosDe } from "./homecenter.ts";
import { actualizar, AREAS, bajada, diaColombia, mediana } from "./censo.ts";
import { crearConectorVtex, EXITO } from "./vtex.ts";

const leer = (n: string) => JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const hc = leer("homecenter_taladros.json");

Deno.test("Homecenter: precio final sin tarjeta, normal como tachado, CMR en la nota", () => {
  const { ofertas, total, porPagina } = leerPagina(hc);
  assertEquals(total, 468);
  assertEquals(porPagina, 40);
  assertEquals(ofertas.length, 6); // el producto sin precio se descarta
  const bosch = ofertas.find((o) => o.idExterno === "3074457")!;
  assertEquals(bosch.precioFinal, 899900); // INTERNET < NORMAL
  assertEquals(bosch.precioAntes, 1499900);
  assertEquals(bosch.marca, "Bosch");
  assert(bosch.url.startsWith("https://www.homecenter.com.co/homecenter-co/product/3074457"));

  const bauker = ofertas.find((o) => o.idExterno === "874670")!;
  assertEquals(bauker.precioFinal, 269900); // CMR exige tarjeta: no es el precio final
  assertEquals(bauker.precioAntes, null);
  assert(bauker.nota.includes("CMR: $249.900"));

  const elite = ofertas.find((o) => o.idExterno === "3069436")!;
  assertEquals(elite.precioFinal, 359900); // solo NORMAL
  assertEquals(elite.precioAntes, null);
});

Deno.test("Homecenter: preciosDe ignora precios vacíos o cero", () => {
  assertEquals(preciosDe({ prices: [] }), null);
  assertEquals(preciosDe({ prices: [{ type: "NORMAL", priceWithoutFormatting: 0 }] }), null);
});

Deno.test("Homecenter: búsqueda que redirige a una categoría sigue la redirección", async () => {
  const pedidas: string[] = [];
  const falso = ((url: string) => {
    pedidas.push(url);
    const cuerpo = url.includes("/category/products")
      ? hc
      : { data: { redirectUrl: "https://www.homecenter.com.co/homecenter-co/category/cat290012/taladros/?sTerm=taladro" } };
    return Promise.resolve(new Response(JSON.stringify(cuerpo)));
  }) as unknown as typeof fetch;
  const ofertas = await crearConectorHomecenter({ fetch: falso }).buscar("taladro", "nueva");
  assertEquals(ofertas.length, 6);
  assert(pedidas[1].includes("categoryId=cat290012"));
  assertEquals(await crearConectorHomecenter({ fetch: falso }).buscar("taladro", "usada"), []);
});

Deno.test("Homecenter: revisar busca cada SKU y devuelve solo los que aparecen", async () => {
  const falso = ((url: string) => {
    const q = new URL(url).searchParams.get("q")!;
    const r = hc.data.results.filter((p: { skuId: string }) => p.skuId === q);
    return Promise.resolve(new Response(JSON.stringify({ data: { results: r } })));
  }) as unknown as typeof fetch;
  const rev = await crearConectorHomecenter({ fetch: falso }).revisar(["440155", "no-existe"]);
  assertEquals(rev.map((r) => [r.idExterno, r.precioFinal]), [["440155", 247900]]);
});

Deno.test("VTEX: página de categoría lee el total del encabezado y respeta el tope de 2.500", async () => {
  const vtex = leer("vtex_exito_real_rtx5060.json");
  let url = "";
  const falso = ((u: string) => {
    url = u;
    return Promise.resolve(new Response(JSON.stringify(vtex), { status: 206, headers: { resources: "0-49/6713" } }));
  }) as unknown as typeof fetch;
  const c = crearConectorVtex(EXITO, { fetch: falso });
  const p = await c.categoria("/34185084/34185124/", 2);
  assert(url.includes("_from=50") && url.includes("_to=99") && url.includes("fq=C%3A%2F34185084%2F34185124%2F"));
  assertEquals(p.total, 2500);
  assert(p.ofertas.length > 0);
  assertEquals((await c.categoria("/1/", 51)).ofertas, []); // más allá del tope no pide nada
});

Deno.test("Censo: mediana", () => {
  assertEquals(mediana([]), null);
  assertEquals(mediana([3, 1, 2]), 2);
  assertEquals(mediana([1, 2, 3, 10]), 3); // redondea (2+3)/2
});

Deno.test("Censo: primer día usa el precio normal como referencia", () => {
  const a = actualizar(null, 90_000, 120_000, "2026-11-21");
  assertEquals(a.baseRef, "normal");
  assertEquals(a.precioRef, 120_000);
  assert(Math.abs(bajada(a.precio, a.precioRef) - 0.25) < 1e-9);
  assertEquals(a.precios30d, [90_000]);
  assert(a.cambio);
});

Deno.test("Censo: con 7+ días usa la mediana SIN el día de hoy", () => {
  let e = { precio: 100, precios30d: [] as number[], ultimoDia: "", precioAnterior: null as number | null };
  const dias = ["01", "02", "03", "04", "05", "06", "07"];
  for (const d of dias) {
    const a = actualizar(e.ultimoDia ? e : null, 100, 100, `2026-11-${d}`);
    e = { precio: a.precio, precios30d: a.precios30d, ultimoDia: a.ultimoDia, precioAnterior: a.precioAnterior };
  }
  const hoy = actualizar(e, 80, 100, "2026-11-08");
  assertEquals(hoy.baseRef, "mediana");
  assertEquals(hoy.precioRef, 100); // la bajada de hoy no contamina su propia referencia
  assertEquals(hoy.precioAnterior, 100);
  assert(hoy.cambio);
});

Deno.test("Censo: el truco de inflar el precio y luego 'rebajarlo' no cuenta como oferta", () => {
  // 20 días a 100, 5 días inflado a 150, hoy "rebajado" a 120 contra un tachado de 150.
  const historia = [...Array(20).fill(100), ...Array(5).fill(150)];
  const prev = { precio: 150, precios30d: historia, ultimoDia: "2026-11-25", precioAnterior: 100 };
  const a = actualizar(prev, 120, 150, "2026-11-26");
  assertEquals(a.precioRef, 100); // mediana real
  assert(bajada(a.precio, a.precioRef) < 0); // en realidad subió
  assert(bajada(a.precio, a.precioNormal) > 0.19); // contra el tachado parecería 20 % de descuento
});

Deno.test("Censo: dos lecturas el mismo día reemplazan la muestra, no la duplican", () => {
  const a = actualizar(null, 100, null, "2026-11-21");
  const prev = { precio: a.precio, precios30d: a.precios30d, ultimoDia: a.ultimoDia, precioAnterior: a.precioAnterior };
  const b = actualizar(prev, 95, null, "2026-11-21");
  assertEquals(b.precios30d, [95]);
  const c = actualizar({ ...prev, precio: 95, precios30d: b.precios30d }, 95, null, "2026-11-21");
  assert(!c.cambio);
});

Deno.test("Censo: el arreglo guarda como máximo 30 días", () => {
  const prev = { precio: 1, precios30d: Array(30).fill(1), ultimoDia: "2026-11-20", precioAnterior: null };
  assertEquals(actualizar(prev, 2, null, "2026-11-21").precios30d.length, 30);
});

Deno.test("Censo: áreas con ids únicos y categorías válidas", () => {
  assertEquals(new Set(AREAS.map((a) => a.id)).size, AREAS.length);
  for (const a of AREAS) {
    assert(a.categorias.length > 0);
    for (const c of a.categorias) {
      assert(a.conector === "homecenter" ? /^cat\d+$/.test(c) : /^\/\d+\/\d+\/$/.test(c), `${a.id}: ${c}`);
    }
  }
  assertEquals(diaColombia(new Date("2026-11-22T03:00:00Z")), "2026-11-21"); // 10 p. m. en Bogotá
});
