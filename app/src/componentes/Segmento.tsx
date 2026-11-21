import type { FiltroCondicion } from "../api/index.ts";

const OPCIONES: [FiltroCondicion, string][] = [["nueva", "Nueva"], ["usada", "Usada"], ["ambas", "Ambas"]];

export function Segmento({ valor, onCambio }: { valor: FiltroCondicion; onCambio: (f: FiltroCondicion) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Condición">
      {OPCIONES.map(([v, t]) => (
        <button key={v} role="radio" aria-checked={valor === v} className={valor === v ? "on" : ""} onClick={() => onCambio(v)}>
          {t}
        </button>
      ))}
    </div>
  );
}
