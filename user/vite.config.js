import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    host: true, // listen on 0.0.0.0 so LAN devices / tunnels can reach the dev server
    allowedHosts: true, // accept the Host header from tunnels (VS Code dev tunnels, cloudflared, ngrok)
    // Let the SPA call the backend same-origin (VITE_API_URL="/api"), so a single
    // forwarded port / tunnel covers BOTH the app and the API — no second tunnel and
    // no cross-origin CORS. Ignored when VITE_API_URL is an absolute URL (the default).
    proxy: {
      "/api": { target: "http://localhost:9000", changeOrigin: true },
      "/socket.io": { target: "http://localhost:9000", ws: true, changeOrigin: true },
    },
  },
});
