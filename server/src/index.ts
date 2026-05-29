import dotenv from "dotenv";
import express from "express";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initCrypto } from "./db/crypto.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the repo-root .env regardless of which workspace dir we launch from.
dotenv.config({ path: join(__dirname, "..", "..", ".env") });

// Initialize encryption before anything touches the DB.
initCrypto();

// Importing ./db/index runs migrations as a side effect; import after crypto.
await import("./db/index.js");

const { settingsRouter } = await import("./routes/settings.js");
const { modelsRouter } = await import("./routes/models.js");
const { projectsRouter } = await import("./routes/projects.js");
const { chatsRouter } = await import("./routes/chats.js");
const { uploadRouter } = await import("./routes/upload.js");

const app = express();

// Reject requests whose Host header isn't a loopback name. Combined with
// binding to 127.0.0.1 below, this blocks DNS-rebinding attacks: a malicious
// page can point its own domain at 127.0.0.1 and reach this API from the
// victim's browser; the bind alone doesn't stop that, but the Host check does.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
app.use((req, res, next) => {
  const raw = req.headers.host ?? "";
  const host = raw.startsWith("[")
    ? raw.slice(0, raw.indexOf("]") + 1) // IPv6 literal: keep "[::1]"
    : raw.split(":")[0];
  if (!LOOPBACK_HOSTS.has(host)) {
    res.status(403).json({ error: "Forbidden: invalid Host header." });
    return;
  }
  next();
});

app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/settings", settingsRouter);
app.use("/api/models", modelsRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/chats", chatsRouter);
app.use("/api/upload", uploadRouter);

// Serve the built client in production (dist served by Vite build).
const clientDist = join(__dirname, "..", "..", "client", "dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(join(clientDist, "index.html"));
  });
}

const port = Number(process.env.PORT ?? 3000);
// Bind to loopback only so the API (which serves decrypted creds and history)
// is never reachable from other machines on the network.
const host = "127.0.0.1";
app.listen(port, host, () => {
  console.log(`[server] listening on http://${host}:${port}`);
});
