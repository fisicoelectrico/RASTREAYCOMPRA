// Pestaña de alertas: los avisos que generó la revisión de precios cada 6 horas
// (llegó al precio objetivo, bajó 5 % o más, volvió a stock). Al abrirla se marcan como leídas.
// El envío al celular como notificación usa la misma tabla (columna enviada_en).
import { useEffect, useState } from "react";
import type { AlertaPrecio, EstadoNotificaciones } from "../api/index.ts";
import { api } from "../api/index.ts";
import { reiniciarDemo } from "../api/demo.ts";
import { haceCuanto } from "../util.ts";

const TEXTO_ESTADO: Record<EstadoNotificaciones, string> = {
  "no-soportado": "Este navegador no recibe notificaciones. Usa la app instalada o Chrome en Android.",
  bloqueadas: "Bloqueaste las notificaciones de esta app. Actívalas en los ajustes del sitio o de la app.",
  inactivas: "Actívalas para que te avisemos al celular aunque la app esté cerrada.",
  activas: "Este celular recibe tus alertas de precio.",
};

function Notificaciones({ avisar }: { avisar: (t: string) => void }) {
  const [estado, setEstado] = useState<EstadoNotificaciones | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    api.notificaciones().then(setEstado).catch(() => setEstado("no-soportado"));
  }, []);

  const correr = async (f: () => Promise<void>) => {
    setOcupado(true);
    try {
      await f();
    } catch (e) {
      avisar((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };
  const activar = () => correr(async () => setEstado(await api.activarNotificaciones()));
  const probar = () =>
    correr(async () => {
      const r = await api.probarNotificacion();
      avisar(r.entregas ? "Enviada. Debería llegarte en unos segundos." : "El servidor no pudo entregarla. Vuelve a activar las notificaciones.");
    });

  if (!estado) return null;
  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      <b>Notificaciones en este celular</b>
      <span style={{ color: "var(--muted)" }}>{TEXTO_ESTADO[estado]}</span>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {(estado === "inactivas" || estado === "activas") && (
          <button className={estado === "activas" ? "chip" : "chip on"} disabled={ocupado} onClick={activar}>
            {estado === "activas" ? "Volver a registrar" : "Activar notificaciones"}
          </button>
        )}
        {estado === "activas" && (
          <button className="chip on" disabled={ocupado} onClick={probar}>Enviar notificación de prueba</button>
        )}
      </div>
    </div>
  );
}

export function Alertas({ modo, salir, avisar }: { modo: "supabase" | "demo"; salir: () => void; avisar: (t: string) => void }) {
  const [alertas, setAlertas] = useState<AlertaPrecio[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.alertas()
      .then((xs) => {
        setAlertas(xs);
        if (xs.some((a) => !a.leida)) api.marcarLeidas().catch(() => {});
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  return (
    <>
      <div className="top">
        <h2>Alertas</h2>
        <div className="sub">Precio objetivo, bajadas de 5 % o más y regreso a stock</div>
      </div>
      <div className="pad">
        {error && <div className="err">{error}</div>}
        {modo === "supabase" && <Notificaciones avisar={avisar} />}
        {!alertas && !error && <div className="cargando"><div className="esqueleto" /></div>}
        {alertas?.length === 0 && (
          <div className="empty">
            Aún no hay alertas. Se revisan tus productos cada 6 horas y aquí aparece cada cambio que valga la pena.
          </div>
        )}
        {alertas?.map((a) => {
          const contenido = (
            <>
              <span className="name">{!a.leida && <span className="pill" style={{ marginRight: 6 }}>nueva</span>}{a.titulo}</span>
              <span>{a.cuerpo}</span>
              <small style={{ color: "var(--muted)" }}>{haceCuanto(a.creadaEn)}</small>
            </>
          );
          const estilo = { color: "inherit", textDecoration: "none", display: "grid", gap: 4 } as const;
          return a.url
            ? <a key={a.id} className="card" href={a.url} target="_blank" rel="noopener noreferrer" style={estilo}>{contenido}</a>
            : <div key={a.id} className="card" style={estilo}>{contenido}</div>;
        })}

        {modo === "demo"
          ? (
            <div className="card" style={{ display: "grid", gap: 10 }}>
              <b>Estás en modo demo</b>
              <span style={{ color: "var(--muted)" }}>
                Los resultados salen de respuestas grabadas de MercadoLibre y Éxito, agrupadas con el mismo código de la app real.
                El historial y las alertas son simulados. Configura Supabase en <code>.env.local</code> para usar datos reales.
              </span>
              <button className="chip" style={{ justifySelf: "start" }} onClick={() => { reiniciarDemo(); location.reload(); }}>Reiniciar demo</button>
            </div>
          )
          : <button className="danger" onClick={salir}>Cerrar sesión</button>}
      </div>
    </>
  );
}
