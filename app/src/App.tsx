// Navegación de la app: 4 pestañas (Vigilados, Buscar, Ofertas, Alertas) y dos pantallas
// internas (modelo con sus ofertas, detalle con historial), como en el mockup aprobado.
import { useCallback, useEffect, useState } from "react";
import { api, type FiltroCondicion, type Grupo, type Vigilado } from "./api/index.ts";
import { IcBuscar, IcCampana, IcCheck, IcEtiqueta, IcOjo } from "./componentes/Iconos.tsx";
import { Alertas } from "./pantallas/Alertas.tsx";
import { Buscar, type EstadoBusqueda } from "./pantallas/Buscar.tsx";
import { Detalle } from "./pantallas/Detalle.tsx";
import { Entrar } from "./pantallas/Entrar.tsx";
import { Modelo } from "./pantallas/Modelo.tsx";
import { Ofertas } from "./pantallas/Ofertas.tsx";
import { Vigilados } from "./pantallas/Vigilados.tsx";

type Pantalla =
  | { id: "buscar" }
  | { id: "modelo"; grupo: Grupo }
  | { id: "vigilados" }
  | { id: "detalle"; vigiladoId: string }
  | { id: "ofertas" }
  | { id: "alertas" };

export function App() {
  const [usuario, setUsuario] = useState<{ email: string } | null | undefined>(undefined);
  const [pantalla, setPantalla] = useState<Pantalla>({ id: "buscar" });
  const [filtro, setFiltro] = useState<FiltroCondicion>("ambas");
  const [busqueda, setBusqueda] = useState<EstadoBusqueda>({ texto: "", resultado: null, cargando: false, error: null });
  const [vigilados, setVigilados] = useState<Vigilado[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api.usuario().then(setUsuario);
  }, []);

  const recargar = useCallback(async () => {
    setVigilados(await api.vigilados());
  }, []);

  useEffect(() => {
    if (usuario) recargar().then(() => {});
  }, [usuario, recargar]);

  // Si ya hay productos vigilados, se abre en esa pestaña.
  useEffect(() => {
    if (vigilados && vigilados.length && pantalla.id === "buscar" && !busqueda.texto) setPantalla({ id: "vigilados" });
    // solo al cargar por primera vez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vigilados === null]);

  const ir = (p: Pantalla) => {
    setPantalla(p);
    window.scrollTo(0, 0);
  };
  const avisar = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 3200);
  };

  if (usuario === undefined) return <div className="app" />;
  if (usuario === null) return <div className="app"><Entrar alEntrar={() => api.usuario().then(setUsuario)} /></div>;

  const pestaña = pantalla.id === "buscar" || pantalla.id === "modelo"
    ? "buscar"
    : pantalla.id === "alertas" || pantalla.id === "ofertas"
    ? pantalla.id
    : "vigilados";

  return (
    <div className="app">
      <main className="screen">
        {pantalla.id === "buscar" && (
          <Buscar
            estado={busqueda}
            setEstado={setBusqueda}
            filtro={filtro}
            setFiltro={setFiltro}
            abrir={(g) => ir({ id: "modelo", grupo: g })}
          />
        )}
        {pantalla.id === "modelo" && (
          <Modelo
            grupo={pantalla.grupo}
            consulta={busqueda.resultado?.consulta ?? busqueda.texto}
            filtro={filtro}
            setFiltro={setFiltro}
            volver={() => ir({ id: "buscar" })}
            alRastrear={async (n) => {
              await recargar();
              ir({ id: "vigilados" });
              avisar(`Listo. Rastreando ${n} oferta${n > 1 ? "s" : ""} de ${pantalla.grupo.nombre.split(" ").slice(0, 5).join(" ")}`);
            }}
          />
        )}
        {pantalla.id === "vigilados" && (
          <Vigilados
            lista={vigilados}
            abrir={(id) => ir({ id: "detalle", vigiladoId: id })}
            irABuscar={() => ir({ id: "buscar" })}
            revisar={async () => {
              const r = await api.revisarAhora();
              await recargar();
              avisar(`Revisadas ${r.revisadas} ofertas · ${r.cambiaron} cambiaron de precio`);
            }}
          />
        )}
        {pantalla.id === "detalle" && (() => {
          const v = vigilados?.find((x) => x.id === pantalla.vigiladoId);
          if (!v) return null;
          return (
            <Detalle
              v={v}
              volver={() => ir({ id: "vigilados" })}
              cambiarObjetivo={async (p) => {
                await api.cambiarObjetivo(v.id, p);
                await recargar();
              }}
              cambiarSeguimiento={async (seguir) => {
                await api.cambiarSeguimiento(v.id, seguir);
                await recargar();
              }}
              quitarOferta={async (o) => {
                await api.quitarOferta(v.id, o);
                await recargar();
                avisar(`Quitamos la oferta de ${o.tienda}; no volverá a sumarse`);
              }}
              dejar={async () => {
                await api.dejarDeRastrear(v.id);
                await recargar();
                ir({ id: "vigilados" });
                avisar("Dejaste de rastrear este producto");
              }}
            />
          );
        })()}
        {pantalla.id === "ofertas" && <Ofertas avisar={avisar} />}
        {pantalla.id === "alertas" && <Alertas modo={api.modo} salir={async () => { await api.salir(); setUsuario(null); }} />}
      </main>

      <nav className="tabbar" aria-label="Secciones">
        <button className={pestaña === "vigilados" ? "on" : ""} onClick={() => ir({ id: "vigilados" })}><IcOjo />Vigilados</button>
        <button className={pestaña === "buscar" ? "on" : ""} onClick={() => ir({ id: "buscar" })}><IcBuscar />Buscar</button>
        <button className={pestaña === "ofertas" ? "on" : ""} onClick={() => ir({ id: "ofertas" })}><IcEtiqueta />Ofertas</button>
        <button className={pestaña === "alertas" ? "on" : ""} onClick={() => ir({ id: "alertas" })}>
          <IcCampana />Alertas<span className="badge">pronto</span>
        </button>
      </nav>

      {toast && <div className="toast" role="status"><span style={{ width: 16, height: 16, display: "inline-flex" }}><IcCheck /></span>{toast}</div>}
    </div>
  );
}
