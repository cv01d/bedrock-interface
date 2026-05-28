import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@chat/shared": fileURLToPath(
        new URL("../shared/src/types.ts", import.meta.url)
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        selfHandleResponse: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            const isSSE = proxyRes.headers["content-type"]?.includes("text/event-stream");
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
            if (isSSE) res.flushHeaders();
            proxyRes.pipe(res, { end: true });
          });
        },
      },
    },
  },
});
