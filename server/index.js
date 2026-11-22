import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorld } from "./world.js";
import { loadSettings, resolvePresentation } from "./settings/index.js";
import { getSettingsPayload, putSettingsPayload } from "./settings/http.js";
import { resolveListenHost, resolveListenPort } from "./settings/listen.js";
import { getMemoryBrowseResponse, getMemoryExportResponse } from "./memory/http.js";
import { getPresentationCatalog } from "./presentation/catalog.js";
import { viewerPatchAfterSseClose } from "./viewer.js";
import { createVoiceService } from "./voice/index.js";
import { handleVoiceRequest } from "./voice/http.js";

loadEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const DATA = path.join(ROOT, "data");
const bootSettings = loadSettings();
const HOST = resolveListenHost(bootSettings);
const PORT = resolveListenPort(process.env);
const TICK_MS = 30_000;
const startedAt = new Date().toISOString();
const startedMs = Date.now();

const clients = new Set();

function broadcast(event, data) {
  if (clients.size === 0) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(frame); } catch { clients.delete(res); }
  }
}

const voice = createVoiceService({
  dataDir: DATA,
  getSettings: () => world?.settings ?? null,
  getSseClientCount: () => clients.size,
  getViewer: () => world?.world?.viewer ?? null,
  onReady: (payload) => broadcast("voice.ready", payload),
  onFailed: (payload) => broadcast("voice.failed", payload),
});

const world = createWorld(DATA, { voice });

let ticking = false;
setInterval(() => {
  if (ticking) return;
  ticking = true;
  Promise.resolve()
    .then(() => world.tick(new Date(), { sseClientCount: clients.size }))
    .then((state) => broadcast("world.updated", state))
    .catch((err) => console.error(err))
    .finally(() => {
      ticking = false;
    });
}, TICK_MS).unref();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, {
        ok: true,
        pid: process.pid,
        port: PORT,
        host: HOST,
        startedAt,
        uptimeSec: Math.round((Date.now() - startedMs) / 1000),
        savedAt: world.savedAt,
        clients: clients.size,
      });
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      return json(res, world.publicState());
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      return openEventStream(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/view") {
      const body = await readJson(req);
      const state = world.setViewer({
        room: typeof body.room === "string" ? body.room : undefined,
        present: typeof body.present === "boolean" ? body.present : true,
      });
      broadcast("world.updated", state);
      return json(res, state);
    }
    if (req.method === "GET" && url.pathname === "/api/settings") {
      return json(res, getSettingsPayload(world, null, { runtimeHost: HOST, runtimePort: PORT }));
    }
    if (req.method === "PUT" && url.pathname === "/api/settings") {
      const body = await readJson(req);
      const result = putSettingsPayload(world, body, { runtimeHost: HOST, runtimePort: PORT });
      if (result.status === 200) broadcast("world.updated", world.publicState());
      return json(res, result.body, result.status);
    }
    if (req.method === "GET" && url.pathname === "/api/presentation") {
      const settings = loadSettings();
      const config = resolvePresentation(settings);
      return json(res, getPresentationCatalog({ settings, config, root: settings.root }));
    }
    if (req.method === "GET" && url.pathname === "/api/memory/browse") {
      const result = getMemoryBrowseResponse(world, url);
      return json(res, result.body, result.status);
    }
    if (req.method === "GET" && url.pathname === "/api/memory/export") {
      const result = getMemoryExportResponse(world, url);
      if (result.status !== 200) return json(res, result.body, result.status);
      res.writeHead(200, result.headers);
      res.end(result.body);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/chat/styles") {
      const characterId = url.searchParams.get("character") || url.searchParams.get("characterId") || "";
      return json(res, world.chatStyles(characterId));
    }
    if (await handleVoiceRequest(req, res, url, voice, { json })) {
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readJson(req);
      const style = body.style && typeof body.style === "object" ? body.style : {
        tone: body.tone,
        length: body.length,
      };
      const result = await world.chat({
        characterId: typeof body.characterId === "string" ? body.characterId : "",
        volume: typeof body.volume === "string" ? body.volume : "",
        text: typeof body.text === "string" ? body.text : "",
        style,
        sseClientCount: clients.size,
      });
      if (result.ok) broadcast("world.updated", world.publicState());
      return json(res, result);
    }
    if (req.method === "GET") {
      return await serveStatic(url.pathname, res);
    }
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "internal error" }));
    }
  }
});

function openEventStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write(":\n\n");
  res.write(`event: world.updated\ndata: ${JSON.stringify(world.publicState())}\n\n`);
  clients.add(res);
  const keepAlive = setInterval(() => {
    try { res.write(":\n\n"); } catch { clearInterval(keepAlive); }
  }, 15_000);
  req.on("close", () => {
    clearInterval(keepAlive);
    clients.delete(res);
    const patch = viewerPatchAfterSseClose(clients.size, world.world?.viewer);
    if (patch) world.setViewer(patch);
  });
}

async function serveStatic(pathname, res) {
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  const decoded = decodeURIComponent(pathname);
  let rel = decoded === "/" ? "/index.html" : decoded;
  const file = path.resolve(DIST, "." + rel);
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  let target = file;
  if (!existsSync(target)) {
    const fallback = path.join(DIST, "index.html");
    if (existsSync(fallback) && !path.extname(rel)) target = fallback;
    else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
  }
  const info = await stat(target);
  if (info.isDirectory()) {
    target = path.join(target, "index.html");
  }
  const ext = path.extname(target).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  res.end(readFileSync(target));
}

function json(res, body, status = 200) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(raw);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("invalid json")); }
    });
    req.on("error", reject);
  });
}

function loadEnv() {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
};

server.listen(PORT, HOST, () => {
  console.log(`house service listening on http://${HOST}:${PORT}`);
  console.log(`pid ${process.pid} started ${startedAt}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
