// Pruebas con respuestas grabadas (fixtures): no tocan internet.
// Ejecutar:  deno test supabase/functions/_shared
import { assert, assertEquals } from "jsr:@std/assert@1";
import { crearConectorML, resultadoAOferta } from "./mercadolibre.ts";
import { crearConectorVtex, EXITO, productoAOfertas } from "./vtex.ts";
import { agrupar, coincide, motivoRuido, normalizar } from "./agrupar.ts";
import type { Oferta } from "./tipos.ts";

const leer = (n: string) => JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const ml = leer("ml_rtx5060.json");
const vtex = leer("vtex_exito_rtx5060.json");
const ofertasML = ml.results.map(resultadoAOferta).filter(Boolean) as Oferta[];
const ofertasExito = vtex.flatMap((p: unknown) => productoAOfertas(p, EXITO)) as Oferta[];

Deno.test("normalizar: tildes, mayúsculas y unidades", () => {
  assertEquals(normalizar("Tarjeta Gráfica RTX 5060 8 GB"), "tarjeta grafica rtx 5060 8gb");
  assertEquals(normalizar('Monitor 27" 165 Hz'), "monitor 27 165hz");
  assertEquals(normalizar("Panel 550 W"), "panel 550w");
});

Deno.test("MercadoLibre: convierte resultados y descarta precios en USD", () => {
  assertEquals(ofertasML.length, 8);
  const o = ofertasML[0];
  assertEquals(o.condicion, "nueva");
  assertEquals(o.envio, 0);
  assertEquals(o.precioFinal, 1719000);
  assertEquals(o.marca, "MSI");
  assert(o.imagen!.startsWith("https://"));
  const usada = ofertasML[1];
  assertEquals(usada.condicion, "usada");
  assertEquals(usada.envio, null, "sin envío gratis, el envío queda por calcular");
  assertEquals(ofertasML.find((x) => x.idExterno === "MCO1500000007")!.disponible, false);
});

Deno.test("MercadoLibre: el filtro nueva/usada viaja como condition=new|used", async () => {
  const urls: string[] = [];
  const falso = ((u: string) => {
    urls.push(u);
    return Promise.resolve(new Response(JSON.stringify(ml)));
  }) as unknown as typeof fetch;
  const c = crearConectorML({ fetch: falso });
  await c.buscar("rtx 5060", "usada");
  await c.buscar("rtx 5060", "ambas");
  assert(urls[0].includes("condition=used"));
  assert(!urls[1].includes("condition="));
});

Deno.test("MercadoLibre: revisar usa multiget y marca pausadas como no disponibles", async () => {
  const falso = (() => Promise.resolve(new Response(JSON.stringify(leer("ml_items.json"))))) as unknown as typeof fetch;
  const r = await crearConectorML({ fetch: falso }).revisar(["MCO1500000001", "MCO1500000002", "MCO9"]);
  assertEquals(r.length, 2);
  assertEquals(r[0].precioFinal, 1689000);
  assertEquals(r[1].disponible, false);
});

Deno.test("VTEX: un SKU por oferta, mejor seller con stock", () => {
  assertEquals(ofertasExito.length, 4);
  const msi = ofertasExito[0];
  assertEquals(msi.idExterno, "3100001");
  assertEquals(msi.precio, 1879000, "el seller externo con stock es más barato");
  assertEquals(msi.precioAntes, 1999000);
  assertEquals(ofertasExito[1].disponible, false);
});

Deno.test("VTEX: la búsqueda de usados no consulta la tienda", async () => {
  let llamadas = 0;
  const falso = (() => {
    llamadas++;
    return Promise.resolve(new Response("[]"));
  }) as unknown as typeof fetch;
  const c = crearConectorVtex(EXITO, { fetch: falso });
  assertEquals(await c.buscar("rtx 5060", "usada"), []);
  assertEquals(llamadas, 0);
});

Deno.test("VTEX: revisar pide por skuId", async () => {
  let url = "";
  const falso = ((u: string) => {
    url = u;
    return Promise.resolve(new Response(JSON.stringify(vtex.slice(0, 1))));
  }) as unknown as typeof fetch;
  const r = await crearConectorVtex(EXITO, { fetch: falso }).revisar(["3100001"]);
  assert(url.includes("fq=skuId%3A3100001"));
  assertEquals(r[0].precioFinal, 1879000);
});

Deno.test("coincide: exige todas las palabras buscadas", () => {
  assert(coincide("Tarjeta MSI RTX5060 8GB", "rtx 5060"));
  assert(!coincide("Mouse Gamer RGB", "rtx 5060"));
});

Deno.test("ruido: variantes, equipos completos y accesorios", () => {
  assertEquals(motivoRuido("Msi Geforce Rtx 5060 Ti Gaming Trio 16gb", "rtx 5060"), "Es la versión Ti");
  assertEquals(motivoRuido("Msi Geforce Rtx 5060 Ti", "rtx 5060 ti"), null);
  assertEquals(
    motivoRuido("Portátil Gamer ASUS TUF A15 RTX 5060", "rtx 5060"),
    "Es un equipo completo que incluye ese componente",
  );
  assertEquals(motivoRuido("Soporte Antipandeo Para Rtx 5060 Rgb", "rtx 5060"), "Parece un accesorio, no el producto");
  assertEquals(motivoRuido("Kit limpieza para rtx 5060", "rtx 5060"), "Parece un accesorio para ese producto");
  assertEquals(motivoRuido("Tarjeta De Video Msi Geforce Rtx 5060 Ventus 2x Oc 8gb", "rtx 5060"), null);
});

Deno.test("agrupar: mismas tarjetas de distintas tiendas quedan juntas", () => {
  const grupos = agrupar([...ofertasML, ...ofertasExito], "rtx 5060");
  const buenos = grupos.filter((g) => !g.ruido);
  const ruido = grupos.filter((g) => g.ruido);

  const msi = buenos[0];
  assertEquals(msi.marca, "msi");
  assertEquals(msi.ofertas.length, 4, "3 de MercadoLibre (nueva, usada, otra nueva) + 1 de Éxito");
  assertEquals(new Set(msi.ofertas.map((o) => o.tienda)), new Set(["MercadoLibre", "Éxito"]));
  assertEquals(msi.nombre, "Tarjeta de video MSI GeForce RTX 5060 8GB Ventus 2X OC", "prefiere el título de la cadena");

  const marcas = buenos.map((g) => g.marca).sort();
  assertEquals(marcas, ["asus", "gigabyte", "msi", "zotac"]);

  // La Ti, los portátiles y el soporte van aparte; el mouse no aparece.
  assertEquals(ruido.map((g) => g.ruido).sort(), [
    "Es la versión Ti",
    "Es un equipo completo que incluye ese componente",
    "Parece un accesorio, no el producto",
  ]);
  const portatiles = ruido.find((g) => g.ruido!.startsWith("Es un equipo"))!;
  assertEquals(portatiles.ofertas.length, 2, "el portátil de ML y el de Éxito son el mismo modelo");
  assert(!grupos.some((g) => g.ofertas.some((o) => o.titulo.includes("Mouse"))));
});

Deno.test("agrupar: poka-yoke, 8GB y 16GB nunca se mezclan", () => {
  const base = ofertasML[0];
  const a = { ...base, idExterno: "a", idCatalogo: null, titulo: "Kingston Fury Beast DDR5 8GB 5600" };
  const b = { ...base, idExterno: "b", idCatalogo: null, titulo: "Kingston Fury Beast DDR5 16GB 5600" };
  const g = agrupar([a, b], "kingston fury ddr5");
  assertEquals(g.length, 2);
});

Deno.test("agrupar: la clave es estable sin importar el orden de llegada", () => {
  const todas = [...ofertasML, ...ofertasExito];
  const k1 = agrupar(todas, "rtx 5060").map((g) => g.clave).sort();
  const k2 = agrupar([...todas].reverse(), "rtx 5060").map((g) => g.clave).sort();
  assertEquals(k1, k2);
});
