// Pestaña "Ofertas": el censo diario por áreas. El usuario elige tiendas y áreas, cuánto debe
// haber bajado el precio y contra qué se compara (ver _shared/censo.ts).
import { useEffect, useMemo, useState } from "react";
import type { AreaCenso, BaseCenso, OfertaCenso } from "../api/index.ts";
import { api } from "../api/index.ts";
import { Spark } from "../componentes/Grafico.tsx";
import { colorTienda, fmt, haceCuanto } from "../util.ts";

const UMBRALES = [0.1, 0.2, 0.3];
const BASES: { id: BaseCenso; texto: string; explica: string }[] = [
  { id: "mediana", texto: "Mediana 30 d", explica: "Comparado con la mediana de los últimos 30 días (sin contar hoy)." },
  { id: "anterior", texto: "Precio anterior", explica: "Comparado con el último precio distinto que vimos." },
  { id: "normal", texto: "Tachado", explica: "Comparado con el precio normal que declara la tienda. Ojo: a veces está inflado." },
];
const ETIQUETA_BASE: Record<BaseCenso, string> = { mediana: "mediana 30 d", anterior: "antes", normal: "tachado" };

export function Ofertas({ avisar }: { avisar: (t: string) => void }) {
  const [areas, setAreas] = useState<AreaCenso[] | null>(null);
  const [tienda, setTienda] = useState<string>("Todas");
  const [umbral, setUmbral] = useState(0.1);
  const [base, setBase] = useState<BaseCenso>("mediana");
  const [ofertas, setOfertas] = useState<OfertaCenso[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.areasCenso().then(setAreas).catch((e) => setError((e as Error).message));
  }, []);

  const tiendas = useMemo(() => ["Todas", ...new Set((areas ?? []).map((a) => a.tienda))], [areas]);
  const visibles = (areas ?? []).filter((a) => tienda === "Todas" || a.tienda === tienda);
  const elegidas = visibles.filter((a) => a.interesa).map((a) => a.id);
  const claveElegidas = elegidas.join(",");

  useEffect(() => {
    if (!areas) return;
    setOfertas(null);
    api.ofertasCenso({ areas: elegidas, umbral, base })
      .then(setOfertas)
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveElegidas, umbral, base, areas === null]);

  const alternar = async (a: AreaCenso) => {
    const nuevo = !a.interesa;
    setAreas((xs) => xs?.map((x) => (x.id === a.id ? { ...x, interesa: nuevo } : x)) ?? null);
    try {
      await api.cambiarInteres(a.id, nuevo);
      if (nuevo && !a.ultimaPasada) avisar(`${a.nombre}: la primera pasada empieza en los próximos minutos`);
    } catch (e) {
      setError((e as Error).message);
      setAreas((xs) => xs?.map((x) => (x.id === a.id ? { ...x, interesa: !nuevo } : x)) ?? null);
    }
  };

  const nombreArea = (id: string) => areas?.find((a) => a.id === id)?.nombre ?? id;
  const pendientes = visibles.filter((a) => a.interesa && !a.ultimaPasada);

  return (
    <>
      <div className="top">
        <h2>Ofertas</h2>
        <div className="sub">Precios que bajaron de verdad · censo diario de las áreas que elijas</div>
      </div>
      <div className="pad">
        {error && <div className="err">{error}</div>}

        <div className="chips" role="group" aria-label="Tienda">
          {tiendas.map((t) => (
            <button key={t} className={`chip ${tienda === t ? "on" : ""}`} onClick={() => setTienda(t)}>{t}</button>
          ))}
        </div>

        <div className="card" style={{ display: "grid", gap: 10 }}>
          <b>Tus áreas</b>
          {!areas && <div className="esqueleto" style={{ height: 40 }} />}
          {[...new Set(visibles.map((a) => a.tienda))].map((t) => (
            <div key={t} style={{ display: "grid", gap: 6 }}>
              {tienda === "Todas" && <small style={{ color: "var(--muted)", fontWeight: 600 }}>{t}</small>}
              <div className="chips">
                {visibles.filter((a) => a.tienda === t).map((a) => (
                  <button
                    key={a.id}
                    className={`chip ${a.interesa ? "on" : ""}`}
                    aria-pressed={a.interesa}
                    title={a.ultimaPasada ? `${a.nProductos.toLocaleString("es-CO")} productos · ${haceCuanto(a.ultimaPasada)}` : "Aún sin recorrer"}
                    onClick={() => alternar(a)}
                  >
                    {a.interesa ? "✓ " : ""}{a.nombre}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <small style={{ color: "var(--muted)" }}>
            Cada área elegida se recorre completa una vez al día. El primer día se compara contra el precio tachado;
            desde el día 7, contra la mediana real.
          </small>
          {pendientes.length > 0 && (
            <div className="aviso">Recorriendo por primera vez: {pendientes.map((a) => a.nombre).join(", ")}. Se hace en tandas cada 5 minutos.</div>
          )}
        </div>

        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div className="row" style={{ alignItems: "center" }}>
            <b>Bajó al menos</b>
            <div className="chips">
              {UMBRALES.map((u) => (
                <button key={u} className={`chip ${umbral === u ? "on" : ""}`} onClick={() => setUmbral(u)}>{Math.round(u * 100)} %</button>
              ))}
            </div>
          </div>
          <div className="chips" role="group" aria-label="Comparar con">
            {BASES.map((b) => (
              <button key={b.id} className={`chip ${base === b.id ? "on" : ""}`} onClick={() => setBase(b.id)}>{b.texto}</button>
            ))}
          </div>
          <small style={{ color: "var(--muted)" }}>{BASES.find((b) => b.id === base)!.explica}</small>
        </div>

        {elegidas.length === 0 && areas && <div className="empty">Elige al menos un área para ver sus ofertas.</div>}
        {elegidas.length > 0 && !ofertas && <div className="cargando"><div className="esqueleto" /><div className="esqueleto" /></div>}
        {ofertas && elegidas.length > 0 && ofertas.length === 0 && (
          <div className="empty">Hoy no hay productos que hayan bajado {Math.round(umbral * 100)} % o más en estas áreas.</div>
        )}

        {ofertas?.map((o) => (
          <a key={o.id} className="watch" href={o.url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
            <span className="name">{o.titulo}</span>
            <span>
              <span className="big num">{fmt(o.precio)}</span>
              <span className="meta">
                <span className="delta down">↓ {Math.round(o.bajada * 100)} %</span>
                <span>{ETIQUETA_BASE[o.base]} {fmt(o.referencia)}</span>
                {base === "mediana" && o.base === "normal" && <span className="pill">poca historia</span>}
              </span>
              <span className="meta" style={{ marginTop: 2 }}>
                <span className="dot" style={{ background: colorTienda(o.tienda) }} />
                <span style={{ flex: 1, minWidth: 0 }}>{o.tienda} · {o.areas.map(nombreArea).join(", ")}{o.marca ? ` · ${o.marca}` : ""}</span>
              </span>
            </span>
            {o.precios30d.length > 1
              ? <Spark valores={o.precios30d} color="var(--down)" />
              : o.imagen ? <img src={o.imagen} alt="" loading="lazy" style={{ width: 72, height: 72, objectFit: "contain", justifySelf: "end", background: "#fff", borderRadius: 10 }} /> : <span />}
          </a>
        ))}
      </div>
    </>
  );
}
