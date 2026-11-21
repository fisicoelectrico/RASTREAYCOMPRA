// Pantalla 1: escribir el producto y ver coincidencias agrupadas por modelo.
import { type ReactNode, useEffect, useState } from "react";
import { api, type FiltroCondicion, type Grupo, type ResultadoBusqueda } from "../api/index.ts";
import { IcBuscar, IcCaja, IcFoco } from "../componentes/Iconos.tsx";
import { Segmento } from "../componentes/Segmento.tsx";
import { fmt } from "../util.ts";

export interface EstadoBusqueda {
  texto: string;
  resultado: ResultadoBusqueda | null;
  cargando: boolean;
  error: string | null;
}

const TIENDAS_ACTIVAS = ["MercadoLibre", "Éxito"];
const TIENDAS_PRONTO = ["Alkosto", "Ktronix", "Homecenter", "Easy", "Amazon", "AliExpress"];

interface Props {
  estado: EstadoBusqueda;
  setEstado: (e: EstadoBusqueda | ((p: EstadoBusqueda) => EstadoBusqueda)) => void;
  filtro: FiltroCondicion;
  setFiltro: (f: FiltroCondicion) => void;
  abrir: (g: Grupo) => void;
}

export function Buscar({ estado, setEstado, filtro, setFiltro, abrir }: Props) {
  const [recientes, setRecientes] = useState<string[]>([]);
  const [verRuido, setVerRuido] = useState(false);

  useEffect(() => {
    api.recientes().then(setRecientes);
  }, [estado.resultado]);

  async function buscar(texto: string, f: FiltroCondicion = filtro) {
    const q = texto.trim();
    if (q.length < 2) return;
    setEstado((e) => ({ ...e, texto: q, cargando: true, error: null }));
    setVerRuido(false);
    try {
      const resultado = await api.buscar(q, f);
      setEstado({ texto: q, resultado, cargando: false, error: null });
    } catch (err) {
      setEstado((e) => ({ ...e, cargando: false, error: (err as Error).message }));
    }
  }

  const r = estado.resultado;
  const buenos = r?.grupos.filter((g) => !g.ruido) ?? [];
  const ruido = r?.grupos.filter((g) => g.ruido) ?? [];

  return (
    <>
      <div className="top">
        <h2>Buscar{api.modo === "demo" && <span className="modo-demo">demo</span>}</h2>
        <div className="sub">Busca en todas tus tiendas a la vez</div>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            buscar(estado.texto);
          }}
        >
          <IcBuscar />
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Ej: RTX 5060 8GB, Fluke 117…"
            aria-label="Producto a buscar"
            value={estado.texto}
            onChange={(e) => setEstado((s) => ({ ...s, texto: e.target.value }))}
          />
          {estado.texto && (
            <button type="button" className="clear" aria-label="Borrar" onClick={() => setEstado({ texto: "", resultado: null, cargando: false, error: null })}>×</button>
          )}
        </form>
        <Segmento
          valor={filtro}
          onCambio={(f) => {
            setFiltro(f);
            if (r) buscar(r.consulta, f);
          }}
        />
      </div>

      <div className="pad">
        <div>
          <div className="lbl" style={{ marginBottom: 8 }}>Tiendas</div>
          <div className="chips">
            {TIENDAS_ACTIVAS.map((s) => <span key={s} className="chip on">{s}</span>)}
            {TIENDAS_PRONTO.map((s) => <span key={s} className="chip soon">{s} · pronto</span>)}
          </div>
        </div>

        {estado.error && <div className="err">No se pudo buscar: {estado.error}</div>}
        {r?.errores.map((e) => <div key={e.tienda} className="err">{e.tienda} no respondió ({e.mensaje}). Mostramos lo de las demás tiendas.</div>)}

        {estado.cargando && (
          <div className="cargando" aria-label="Buscando">
            <div className="lbl">Consultando tiendas…</div>
            <div className="esqueleto" />
            <div className="esqueleto" />
            <div className="esqueleto" />
          </div>
        )}

        {!estado.cargando && !r && (
          <div>
            <div className="lbl" style={{ marginBottom: 8 }}>Búsquedas recientes</div>
            <div className="chips">
              {recientes.map((q) => (
                <button key={q} className="chip" onClick={() => buscar(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {!estado.cargando && r && !r.grupos.length && (
          <div className="empty">No encontramos "{r.consulta}" en tus tiendas.<br />Prueba con menos palabras o revisa el modelo.</div>
        )}

        {!estado.cargando && r && r.grupos.length > 0 && (
          <div style={{ display: "grid", gap: 10 }}>
            <div className="row">
              <div className="lbl">{buenos.length} producto{buenos.length !== 1 ? "s" : ""} coinciden</div>
              <small style={{ color: "var(--muted)", fontSize: 12 }}>Toca el que buscas</small>
            </div>
            {buenos.map((g) => <Tarjeta key={g.clave} g={g} consulta={r.consulta} filtro={filtro} onClick={() => abrir(g)} />)}
            {ruido.length > 0 && (
              <div className="hint">
                <IcFoco />
                <span>
                  Separé {ruido.length} resultado{ruido.length > 1 ? "s" : ""} que contienen tu búsqueda pero parecen otra cosa.{" "}
                  <button className="link" onClick={() => setVerRuido(!verRuido)}>{verRuido ? "Ocultar" : "Ver"}</button>
                </span>
              </div>
            )}
            {verRuido && ruido.map((g) => <Tarjeta key={g.clave} g={g} consulta={r.consulta} filtro={filtro} dim onClick={() => abrir(g)} />)}
          </div>
        )}
      </div>
    </>
  );
}

const sinTildes = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Resalta las palabras buscadas dentro del nombre del modelo. */
function Resaltado({ texto, consulta }: { texto: string; consulta: string }) {
  const n = sinTildes(texto);
  const marcas: [number, number][] = [];
  for (const q of sinTildes(consulta).split(/\s+/).filter(Boolean)) {
    const i = n.indexOf(q);
    if (i >= 0) marcas.push([i, i + q.length]);
  }
  marcas.sort((a, b) => a[0] - b[0]);
  const partes: ReactNode[] = [];
  let pos = 0;
  marcas.forEach(([a, b], k) => {
    if (a < pos) return;
    partes.push(texto.slice(pos, a), <mark key={k}>{texto.slice(a, b)}</mark>);
    pos = b;
  });
  partes.push(texto.slice(pos));
  return <>{partes}</>;
}

function Tarjeta({ g, consulta, filtro, dim, onClick }: { g: Grupo; consulta: string; filtro: FiltroCondicion; dim?: boolean; onClick: () => void }) {
  const nu = g.ofertas.filter((o) => o.condicion === "nueva");
  const us = g.ofertas.filter((o) => o.condicion === "usada");
  const min = (a: typeof nu) => fmt(Math.min(...a.map((o) => o.precioFinal)));
  const tiendas = new Set(g.ofertas.map((o) => o.tienda)).size;
  return (
    <button className={`hit ${dim ? "dim" : ""}`} onClick={onClick}>
      <span className="thumb">{g.imagen ? <img src={g.imagen} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} /> : <IcCaja />}</span>
      <span>
        <b><Resaltado texto={g.nombre} consulta={consulta} /></b>
        <small>{dim && g.ruido ? `${g.ruido} · ` : ""}{g.ofertas.length} oferta{g.ofertas.length > 1 ? "s" : ""} en {tiendas} tienda{tiendas > 1 ? "s" : ""}</small>
      </span>
      <span className="from num">
        {nu.length > 0 && <><small>nueva desde</small>{min(nu)}</>}
        {us.length > 0 && filtro !== "nueva" && <small style={{ marginTop: 3 }}>usada desde {min(us)}</small>}
      </span>
    </button>
  );
}
