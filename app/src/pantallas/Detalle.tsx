// Pantalla 4: historial por tienda, mínimo histórico, objetivo y ofertas que se siguen.
import { useState } from "react";
import type { Vigilado } from "../api/index.ts";
import { GraficoHistorial } from "../componentes/Grafico.tsx";
import { IcAtras } from "../componentes/Iconos.tsx";
import { colorTienda, fmt, mejorOferta, pct, serieMejor, variacion } from "../util.ts";

interface Props {
  v: Vigilado;
  volver: () => void;
  cambiarObjetivo: (p: number) => Promise<void>;
  dejar: () => Promise<void>;
}

export function Detalle({ v, volver, cambiarObjetivo, dejar }: Props) {
  const [dias, setDias] = useState(30);
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const [editando, setEditando] = useState(false);
  const [objetivo, setObjetivo] = useState(v.precioObjetivo);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);

  const b = mejorOferta(v)!;
  const d30 = variacion(v, 30);
  const serie = serieMejor(v, dias, 120).map((p) => p.precio);
  const serie90 = serieMejor(v, 90, 360);
  const minimo = serie90.length ? serie90.reduce((a, p) => (p.precio <= a.precio ? p : a)) : null;
  const haceDias = minimo ? Math.round((Date.now() - minimo.t) / 864e5) : 0;
  const promedio = serie.length ? serie.reduce((a, x) => a + x, 0) / serie.length : b.precioFinal;
  const falta = b.precioFinal - v.precioObjetivo;

  const alternar = (id: string) => {
    const s = new Set(ocultas);
    if (s.has(id)) s.delete(id);
    else if (s.size < v.ofertas.length - 1) s.add(id);
    setOcultas(s);
  };

  return (
    <>
      <div className="top">
        <button className="back" onClick={volver}><IcAtras />Vigilados</button>
        <h2 style={{ fontSize: 20, lineHeight: 1.25 }}>{v.nombre}</h2>
        <div className="hero-price">
          <span className="big num">{fmt(b.precioFinal)}</span>
          {Math.abs(d30) >= 0.05 && <span className={`delta ${d30 < 0 ? "down" : "up"}`}>{d30 < 0 ? "↓" : "↑"} {pct(d30)} en 30 d</span>}
        </div>
        <div className="sub">
          <span className="dot" style={{ display: "inline-block", background: colorTienda(b.tienda) }} /> Mejor precio hoy en {b.tienda}
          {b.condicion === "usada" ? " (usada)" : ""}
          {falta <= 0 ? <> · <b style={{ color: "var(--tag)" }}>ya está en tu objetivo</b></> : ` · faltan ${fmt(falta)} para tu objetivo`}
        </div>
      </div>
      <div className="pad">
        <div className="card">
          <h4>
            Historial por tienda
            <span className="tabs">
              {[7, 30, 90].map((r) => <button key={r} className={dias === r ? "on" : ""} onClick={() => setDias(r)}>{r} d</button>)}
            </span>
          </h4>
          <GraficoHistorial ofertas={v.ofertas} ocultas={ocultas} dias={dias} objetivo={v.precioObjetivo} />
          <div className="legend">
            {v.ofertas.map((o) => (
              <button key={o.id} className={ocultas.has(o.id) ? "off" : ""} onClick={() => alternar(o.id)}>
                <span className="dot" style={{ background: colorTienda(o.tienda) }} />{o.tienda}{o.condicion === "usada" ? " (usada)" : ""}
              </button>
            ))}
          </div>
          <div className="facts">
            <div>
              <small>Mínimo histórico (90 d)</small>
              <b className="num" style={{ color: "var(--down)" }}>{minimo ? fmt(minimo.precio) : "—"}</b>{" "}
              <small>{haceDias ? `hace ${haceDias} días` : "hoy"}</small>
            </div>
            <div><small>Promedio {dias} d</small><b className="num">{fmt(promedio)}</b></div>
          </div>
        </div>

        <div className="card">
          <h4>Precio objetivo{!editando && <button className="pill" style={{ border: 0 }} onClick={() => setEditando(true)}>Editar</button>}</h4>
          {editando
            ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="campo">
                  <input inputMode="numeric" aria-label="Nuevo precio objetivo" value={fmt(objetivo)} onChange={(e) => setObjetivo(Number(e.target.value.replace(/\D/g, "")) || 0)} />
                </div>
                <div className="row-acc">
                  <button className="cta" style={{ padding: 10 }} disabled={objetivo <= 0} onClick={async () => { await cambiarObjetivo(objetivo); setEditando(false); }}>Guardar</button>
                  <button className="chip" onClick={() => { setObjetivo(v.precioObjetivo); setEditando(false); }}>Cancelar</button>
                </div>
              </div>
            )
            : (
              <div className="row">
                <span style={{ fontFamily: "var(--f-display)", fontWeight: 800, fontSize: 22 }} className="num">{fmt(v.precioObjetivo)}</span>
                <small style={{ color: "var(--muted)" }}>
                  {falta > 0 ? `${Math.round((falta / b.precioFinal) * 100)} % bajo el precio actual` : "Superado"}
                </small>
              </div>
            )}
        </div>

        <div className="card">
          <h4>Ofertas que sigues</h4>
          <div className="olist">
            {[...v.ofertas].sort((a, c) => a.precioFinal - c.precioFinal).map((o) => (
              <div key={o.id} className="o">
                <span>
                  <span className="store" style={{ fontWeight: 500 }}>
                    <span className="dot" style={{ background: colorTienda(o.tienda) }} />{o.tienda}
                    {o.condicion === "usada" && <span className="pill usada">Usada</span>}
                    {!o.disponible && <span className="pill">Agotado</span>}
                  </span>
                  <small title={o.titulo}>{o.envio === 0 ? "Envío gratis · " : o.envio === null ? "Envío por calcular · " : ""}{o.titulo}</small>
                </span>
                <b className="num">{fmt(o.precioFinal)}</b>
                <a href={o.url} target="_blank" rel="noopener noreferrer">Ver ›</a>
              </div>
            ))}
          </div>
        </div>

        {confirmarBorrar
          ? (
            <div className="card" style={{ display: "grid", gap: 10 }}>
              <span>¿Dejar de rastrear? Se borra también su historial.</span>
              <div className="row-acc">
                <button className="cta" style={{ background: "var(--up)", padding: 10 }} onClick={dejar}>Sí, dejar de rastrear</button>
                <button className="chip" onClick={() => setConfirmarBorrar(false)}>Cancelar</button>
              </div>
            </div>
          )
          : <button className="danger" onClick={() => setConfirmarBorrar(true)}>Dejar de rastrear</button>}
      </div>
    </>
  );
}
