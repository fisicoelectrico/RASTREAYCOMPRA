// Inicio de sesión con correo y contraseña (Supabase Auth).
import { useState } from "react";
import { api } from "../api/index.ts";

export function Entrar({ alEntrar }: { alEntrar: () => void }) {
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [crear, setCrear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  return (
    <>
      <div className="top" style={{ paddingTop: 40 }}>
        <h2 style={{ fontSize: 34 }}>Rastrea<span style={{ background: "var(--tag)", color: "var(--tag-ink)", borderRadius: 6, padding: "0 .12em" }}>Y</span>Compra</h2>
        <div className="sub">Sigue precios en tiendas de Colombia y compra cuando bajen.</div>
      </div>
      <form
        className="pad"
        onSubmit={async (e) => {
          e.preventDefault();
          setEnviando(true);
          setError(null);
          try {
            await api.entrar(email, clave, crear);
            if (crear) setAviso("Cuenta creada. Si tu proyecto pide confirmar el correo, revisa tu bandeja y luego entra.");
            alEntrar();
          } catch (err) {
            setError((err as Error).message);
          }
          setEnviando(false);
        }}
      >
        <label className="campo"><span className="lbl">Correo</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="campo"><span className="lbl">Contraseña</span><input type="password" autoComplete={crear ? "new-password" : "current-password"} minLength={6} required value={clave} onChange={(e) => setClave(e.target.value)} /></label>
        {error && <div className="err">{error}</div>}
        {aviso && <div className="aviso">{aviso}</div>}
        <button className="cta" disabled={enviando}>{enviando ? "…" : crear ? "Crear cuenta" : "Entrar"}</button>
        <button type="button" className="link" onClick={() => setCrear(!crear)}>{crear ? "Ya tengo cuenta" : "Crear una cuenta"}</button>
      </form>
    </>
  );
}
