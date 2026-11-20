// Pestaña de alertas: llega en la fase 2. Explica qué hará y deja cerrar sesión.
import { reiniciarDemo } from "../api/demo.ts";

export function Alertas({ modo, salir }: { modo: "supabase" | "demo"; salir: () => void }) {
  return (
    <>
      <div className="top">
        <h2>Alertas</h2>
        <div className="sub">Llegan en la fase 2</div>
      </div>
      <div className="pad">
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <b>Lo que vendrá aquí</b>
          <span style={{ color: "var(--muted)" }}>
            Notificaciones al celular cuando un producto llegue a tu precio objetivo, baje más del 5 % o vuelva a tener stock.
            El historial ya se está guardando cada 6 horas, así que las alertas podrán usarlo desde el primer día.
          </span>
        </div>
        {modo === "demo"
          ? (
            <div className="card" style={{ display: "grid", gap: 10 }}>
              <b>Estás en modo demo</b>
              <span style={{ color: "var(--muted)" }}>
                Los resultados salen de respuestas grabadas de MercadoLibre y Éxito, agrupadas con el mismo código de la app real.
                El historial es simulado. Configura Supabase en <code>.env.local</code> para usar datos reales.
              </span>
              <button className="chip" style={{ justifySelf: "start" }} onClick={() => { reiniciarDemo(); location.reload(); }}>Reiniciar demo</button>
            </div>
          )
          : <button className="danger" onClick={salir}>Cerrar sesión</button>}
      </div>
    </>
  );
}
