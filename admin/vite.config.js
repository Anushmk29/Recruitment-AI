import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Route-level code splitting lives in App.jsx; this splits the other
        // half of the problem — third-party code. Grouped by change rate, so a
        // release that touches app code does not invalidate the ~200 kB of
        // dependencies a returning recruiter already has cached. React and
        // react-dom stay in ONE chunk on purpose: splitting them risks two
        // copies of the renderer and a duplicated context registry.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (id.includes("react-router") || id.includes("@remix-run")) return "router";
          if (id.includes("framer-motion") || id.includes("motion-dom") || id.includes("motion-utils")) return "motion";
          if (id.includes("socket.io") || id.includes("engine.io")) return "realtime";
          if (id.includes("react-hook-form") || id.includes("@hookform") || id.includes("zod")) return "forms";
          return "vendor";
        },
      },
    },
  },
  // strictPort: a stale second dev server instance must fail loudly on startup
  // (EADDRINUSE) instead of Vite silently rebinding it onto 5174 — the user
  // app's port. That silent fallback is exactly what made an admin dev server
  // answer the candidate portal's interview link on 5174 (7/27/2026 incident).
  server: {
      port: 5173,
      strictPort: true, // fail loud on conflict rather than silently rebinding — see admin/vite.config.js
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
