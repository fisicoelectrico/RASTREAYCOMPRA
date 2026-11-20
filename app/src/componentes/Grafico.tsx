// Gráficos en SVG puro (sin librerías), igual que en el mockup.
import type { OfertaVigilada } from "../api/index.ts";
import { colorTienda, pasoBonito } from "../util.ts";

export function Spark({ valores, color }: { valores: number[]; color: string }) {
  if (valores.length < 2) return <svg className="spark" viewBox="0 0 96 34" aria-hidden="true" />;
  const mn = Math.min(...valores), mx = Math.max(...valores), w = 96, h = 34;
  const pts = valores.map((v, i) => [(i / (valores.length - 1)) * w, h - 3 - (mx === mn ? 0.5 : (v - mn) / (mx - mn)) * (h - 6)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const ult = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`${d} L${w} ${h} L0 ${h}Z`} fill={color} opacity=".12" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={ult[0] - 1} cy={ult[1]} r="2.6" fill={color} />
    </svg>
  );
}

interface PropsHistorial {
  ofertas: OfertaVigilada[];
  ocultas: Set<string>;
  dias: number;
  objetivo: number;
}

/** Historial por tienda: una línea escalonada por oferta (el precio se mantiene hasta la siguiente revisión). */
export function GraficoHistorial({ ofertas, ocultas, dias, objetivo }: PropsHistorial) {
  const W = 340, H = 180, L = 46, T = 10, B = 22, R = 8;
  const fin = Date.now(), ini = fin - dias * 864e5;
  const series = ofertas.filter((o) => !ocultas.has(o.id)).map((o) => {
    const previos = o.historial.filter((p) => p.t < ini);
    const dentro = o.historial.filter((p) => p.t >= ini);
    const pts = [...(previos.length ? [{ ...previos[previos.length - 1], t: ini }] : []), ...dentro];
    if (pts.length) pts.push({ ...pts[pts.length - 1], t: fin });
    return { o, pts };
  }).filter((s) => s.pts.length);

  const todos = series.flatMap((s) => s.pts.map((p) => p.precio)).concat(objetivo);
  let mn = Math.min(...todos), mx = Math.max(...todos);
  const pad = (mx - mn) * 0.08 || mx * 0.02;
  mn -= pad;
  mx += pad;
  const x = (t: number) => L + ((t - ini) / (fin - ini)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
  const paso = pasoBonito((mx - mn) / 4);
  const marcas: number[] = [];
  for (let v = Math.ceil(mn / paso) * paso; v <= mx; v += paso) marcas.push(v);
  const etiqueta = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(paso < 1e5 ? 2 : 1).replace(".", ",")} M` : `${Math.round(v / 1e3)} k`;

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Historial de precios por tienda">
      {marcas.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
          <text x={L - 6} y={y(v) + 3} textAnchor="end">{etiqueta(v)}</text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={y(objetivo)} y2={y(objetivo)} stroke="var(--tag)" strokeWidth="1.5" strokeDasharray="5 4" />
      <text x={W - R} y={y(objetivo) - 4} textAnchor="end" style={{ fill: "var(--tag)", fontWeight: 600 }}>objetivo</text>
      {series.map(({ o, pts }) => {
        const d = pts.map((p, i) => i === 0 ? `M${x(p.t).toFixed(1)} ${y(p.precio).toFixed(1)}` : `H${x(p.t).toFixed(1)} V${y(p.precio).toFixed(1)}`).join(" ");
        return (
          <g key={o.id}>
            <path d={d} fill="none" stroke={colorTienda(o.tienda)} strokeWidth="2" strokeLinejoin="round" strokeDasharray={o.condicion === "usada" ? "3 3" : undefined} />
            <circle cx={x(fin)} cy={y(pts[pts.length - 1].precio)} r="3" fill={colorTienda(o.tienda)} />
          </g>
        );
      })}
      <text x={L} y={H - 6}>hace {dias} d</text>
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle">hace {Math.round(dias / 2)} d</text>
      <text x={W - R} y={H - 6} textAnchor="end">hoy</text>
    </svg>
  );
}
