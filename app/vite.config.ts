import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // La app reutiliza la lógica de agrupar.ts que vive junto a las Edge Functions.
  server: { fs: { allow: [".."] } },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icono.svg"],
      manifest: {
        name: "RastreaYCompra",
        short_name: "RastreaYCompra",
        description: "Seguimiento de precios en tiendas de Colombia",
        lang: "es-CO",
        theme_color: "#0e4f5f",
        background_color: "#f4f7f9",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icono.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icono-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
    }),
  ],
});
