// Capacitor envuelve la misma app web (dist/) en una APK de Android.
// La app habla directo con Supabase, igual que en el navegador: no hay servidor propio.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rastreaycompra.app",
  appName: "RastreaYCompra",
  webDir: "dist",
  android: {
    // Enlaces a tiendas (MercadoLibre, Éxito, Homecenter) se abren en el navegador del celular.
    allowMixedContent: false,
  },
};

export default config;
