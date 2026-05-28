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
app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
});
