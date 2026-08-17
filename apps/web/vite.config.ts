import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    /*
     * The browser talks to /api on its own origin, so cookies are first-party
     * in development exactly as they are in production behind one domain.
     *
     * There is deliberately NO path rewrite: the API serves its routes under
     * /api, so the request path is byte-identical in both environments. The
     * previous rewrite meant development exercised a different URL space from
     * production and hid a total production breakage.
     */
    proxy: {
      "/api": {
        target: process.env["VITE_API_TARGET"] ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
