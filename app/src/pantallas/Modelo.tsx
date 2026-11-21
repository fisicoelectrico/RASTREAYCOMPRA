// Pantalla 2: las ofertas de un modelo, por tienda. Se marcan las que se quieren
// rastrear y se fija el precio objetivo en la hoja inferior.
import { useState } from "react";
import { api, type FiltroCondicion, type Grupo } from "../api/index.ts";
import { IcAtras, IcCheck } from "../componentes/Iconos.tsx";
import { Segmento } from "../componentes/Segmento.tsx";
import { colorTienda, fmt } from "../util.ts";

interface Props {
  grupo: Grupo;
  consulta: string;
  filtro: FiltroCondicion;
  setFiltro: (f: FiltroCondicion) => void;
  volver: () => void;
  alRastrear: (n: number) => void;
}

const idDe = (o: Grupo["ofertas"][number]) => `${o.conector}:${o.idExterno}`;

export function Modelo({ grupo, consulta, filtro, setFiltro, volver, alRastrear }: Props) {
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [hoja, setHoja] = useState(false);

  const ofertas = grupo.ofertas
    .filter((o) => filtro === "ambas" || o.condicion === filtro)
    .sort((a, b) => a.precioFinal - b.precioFinal);
  const nuevas = ofertas.filter((o) => o.condicion === "nueva" && o.disponible);
  const minNueva = nuevas.length ? Math.min(...nuevas.map((o) => o.precioFinal)) : -1;
  const todas = ofertas.length > 0 && ofertas.every((o) => marcadas.has(idDe(o)));
  const elegidas = ofertas.filter((o) => marcadas.has(idDe(o)));

  const alternar = (id: string) => {
    const s = new Set(marcadas);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setMarcadas(s);
  };

  return (
    <>
      <div className="top">
        <button className="back" onClick={volver}><IcAtras />Coincidencias</button>
        <h2 style={{ fontSize: 21, lineHeight: 1.2 }}>{grupo.nombre}</h2>
        <div className="sub">{ofertas.length} ofertas · elige las que quieres rastrear</div>
        <Segmento valor={filtro} onCambio={setFiltro} />
      </div>
      <div className="pad">
        {grupo.ruido && <div className="hint">Ojo: {grupo.ruido.toLowerCase()}.</div>}
        <div className="row">
          <button className="chip" onClick={() => setMarcadas(todas ? new Set() : new Set(ofertas.map(idDe)))}>
            {todas ? "Quitar todas" : "Marcar todas"}
          </button>
          <small style={{ color: "var(--muted)", fontSize: 12 }}>Precio final · menor a mayor</small>
        </div>
        {ofertas.length === 0 && <div className="empty">No hay ofertas en esta condición.</div>}
        {ofertas.map((o) => {
          const id = idDe(o);
          const on = marcadas.has(id);
          return (
            <button key={id} className={`offer ${on ? "on" : ""}`} onClick={() => alternar(id)} aria-pressed={on}>
              <span className="box">{on && <IcCheck />}</span>
              <span style={{ minWidth: 0 }}>
                <span className="store">
                  <span className="dot" style={{ background: colorTienda(o.tienda) }} />
                  {o.tienda} <span className={`pill ${o.condicion}`}>{o.condicion === "nueva" ? "Nueva" : "Usada"}</span>
                  {!o.disponible && <span className="pill">Agotado</span>}
                </span>
                <small>{o.nota}</small>
                <small style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={o.titulo}>{o.titulo}</small>
              </span>
              <span className="price num">
                {o.precioFinal === minNueva && o.condicion === "nueva" && <div className="best">Mejor nueva</div>}
                {fmt(o.precioFinal)}
                {o.precioAntes && <small style={{ display: "block", textDecoration: "line-through" }}>{fmt(o.precioAntes)}</small>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="footer">
        <button className="cta" disabled={!elegidas.length} onClick={() => setHoja(true)}>
          {elegidas.length ? `Rastrear ${elegidas.length} oferta${elegidas.length > 1 ? "s" : ""}` : "Marca al menos una oferta"}
        </button>
      </div>
      {hoja && (
        <HojaObjetivo
          n={elegidas.length}
          sugerido={Math.floor((Math.min(...elegidas.map((o) => o.precioFinal)) * 0.95) / 10000) * 10000}
          cerrar={() => setHoja(false)}
          confirmar={async (precio) => {
            await api.rastrear(grupo, elegidas, precio, consulta, filtro);
            alRastrear(elegidas.length);
          }}
        />
      )}
    </>
  );
}

function HojaObjetivo({ n, sugerido, cerrar, confirmar }: { n: number; sugerido: number; cerrar: () => void; confirmar: (p: number) => Promise<void> }) {
  const [precio, setPrecio] = useState(Math.max(sugerido, 10000));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paso = precio >= 1_000_000 ? 50_000 : precio >= 200_000 ? 10_000 : 1_000;

  return (
    <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && cerrar()}>
      <div className="sheet" role="dialog" aria-label="Precio objetivo">
        <div className="grab" />
        <div>
          <h3>¿A qué precio lo compras?</h3>
          <small style={{ color: "var(--muted)" }}>
            Marcaremos el producto cuando alguna de tus {n} ofertas llegue a este precio final.
          </small>
        </div>
        <div className="stepper">
          <button aria-label="Bajar" onClick={() => setPrecio(Math.max(paso, precio - paso))}>−</button>
          <input
            className="num"
            inputMode="numeric"
            aria-label="Precio objetivo"
            value={fmt(precio)}
            onChange={(e) => setPrecio(Number(e.target.value.replace(/\D/g, "")) || 0)}
          />
          <button aria-label="Subir" onClick={() => setPrecio(precio + paso)}>+</button>
        </div>
        <div className="aviso">
          También vigilamos el modelo completo: si otro vendedor lo publica más barato, lo sumamos solo. Las alertas al celular llegan en la fase 2.
        </div>
        <div className="row" style={{ color: "var(--muted)", fontSize: 13 }}>
          <span>Revisamos precios cada 6 horas</span>
        </div>
        {error && <div className="err">{error}</div>}
        <button
          className="cta tag"
          disabled={guardando || precio <= 0}
          onClick={async () => {
            setGuardando(true);
            setError(null);
            try {
              await confirmar(precio);
            } catch (e) {
              setError((e as Error).message);
              setGuardando(false);
            }
          }}
        >
          {guardando ? "Guardando…" : "Empezar a rastrear"}
        </button>
      </div>
    </div>
  );
}
