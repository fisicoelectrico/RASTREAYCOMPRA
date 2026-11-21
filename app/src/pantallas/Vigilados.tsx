// Pantalla 3: lista de productos vigilados con el mejor precio de hoy y su tendencia.
import { useState } from "react";
import type { Vigilado } from "../api/index.ts";
import { Spark } from "../componentes/Grafico.tsx";
import { IcRefrescar } from "../componentes/Iconos.tsx";
import { colorTienda, fmt, haceCuanto, mejorOferta, pct, serieMejor, variacion } from "../util.ts";

interface Props {
  lista: Vigilado[] | null;
  abrir: (id: string) => void;
  irABuscar: () => void;
  revisar: () => Promise<void>;
}

export function Vigilados({ lista, abrir, irABuscar, revisar }: Props) {
  const [revisando, setRevisando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!lista) return <div className="pad"><div className="esqueleto" /><div className="esqueleto" /></div>;

  const ultima = lista.map((v) => v.ultimaRevision).filter(Boolean).sort().at(-1) ?? null;
  const enObjetivo = lista.filter((v) => (mejorOferta(v)?.precioFinal ?? Infinity) <= v.precioObjetivo).length;
  const bajaron = lista.filter((v) => variacion(v) < -1).length;

  return (
    <>
      <div className="top">
        <div className="row">
          <h2>Vigilados</h2>
          {lista.length > 0 && (
            <button
              className="icbtn"
              disabled={revisando}
              onClick={async () => {
                setRevisando(true);
                setError(null);
                try {
                  await revisar();
                } catch (e) {
                  setError((e as Error).message);
                }
                setRevisando(false);
              }}
            >
              <IcRefrescar />{revisando ? "Revisando…" : "Revisar ahora"}
            </button>
          )}
        </div>
        <div className="sub">Última revisión {haceCuanto(ultima)} · automática cada 6 horas</div>
      </div>
      <div className="pad">
        {error && <div className="err">{error}</div>}
        {lista.length === 0 && (
          <div className="empty">
            Aún no rastreas ningún producto.<br />
            <button className="cta" style={{ marginTop: 14, width: "auto", padding: "12px 20px" }} onClick={irABuscar}>Buscar un producto</button>
          </div>
        )}
        {lista.length > 0 && (
          <div className="summary">
            <div><b className="num">{lista.length}</b><small>productos</small></div>
            <div><b className="num" style={{ color: "var(--down)" }}>{bajaron}</b><small>bajaron (30 d)</small></div>
            <div><b className="num" style={{ color: "var(--tag)" }}>{enObjetivo}</b><small>en tu objetivo</small></div>
          </div>
        )}
        {lista.map((v) => {
          const b = mejorOferta(v);
          if (!b) return null;
          const d = variacion(v);
          const enMeta = b.precioFinal <= v.precioObjetivo;
          const color = d <= 0 ? "var(--down)" : "var(--up)";
          return (
            <button key={v.id} className="watch" onClick={() => abrir(v.id)}>
              <span className="name">{v.nombre}</span>
              <span>
                <span className="big num">{fmt(b.precioFinal)}</span>
                <span className="meta">
                  <span className="dot" style={{ background: colorTienda(b.tienda) }} />
                  {b.tienda}{b.condicion === "usada" ? " · usada" : ""} · {v.ofertas.length} oferta{v.ofertas.length > 1 ? "s" : ""}
                  {enMeta
                    ? <span className="delta goal">En tu objetivo</span>
                    : Math.abs(d) >= 0.05 && <span className={`delta ${d < 0 ? "down" : "up"}`}>{d < 0 ? "↓" : "↑"} {pct(d)}</span>}
                </span>
                <span className="meta" style={{ marginTop: 2 }}>Objetivo {fmt(v.precioObjetivo)}</span>
              </span>
              <Spark valores={serieMejor(v, 30, 40).map((p) => p.precio)} color={color} />
            </button>
          );
        })}
        {lista.length > 0 && <button className="chip" style={{ justifySelf: "center" }} onClick={irABuscar}>+ Rastrear otro producto</button>}
      </div>
    </>
  );
}
