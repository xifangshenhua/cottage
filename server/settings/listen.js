/**
 * HTTP listen address for the house service.
 * Default is 127.0.0.1 (this machine only). Changing it requires a process restart.
 */
import { isIP } from "node:net";

export const DEFAULT_LISTEN_HOST = "127.0.0.1";
export const DEFAULT_LISTEN_PORT = 8787;

/**
 * Allow loopback, wildcard, or a literal IP. Reject other hostnames so a typo
 * cannot silently bind somewhere unexpected.
 */
export function isAllowedListenHost(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text.length > 80) return false;
  if (text.toLowerCase() === "localhost") return true;
  return isIP(text) !== 0;
}

export function normalizeListenHost(value) {
  if (!isAllowedListenHost(value)) return null;
  const text = value.trim();
  return text.toLowerCase() === "localhost" ? "127.0.0.1" : text;
}

/**
 * house.server.host → env HOST → 127.0.0.1.
 * Invalid saved values are ignored rather than crashing the service.
 */
export function resolveListenHost(settings = null, env = process.env) {
  const fromSettings = settings?.house?.server?.host ?? settings?.server?.host;
  const saved = normalizeListenHost(fromSettings);
  if (saved) return saved;
  const fromEnv = normalizeListenHost(typeof env?.HOST === "string" ? env.HOST : "");
  if (fromEnv) return fromEnv;
  return DEFAULT_LISTEN_HOST;
}

export function resolveListenPort(env = process.env) {
  const n = Number(env?.PORT);
  if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  return DEFAULT_LISTEN_PORT;
}

export function listenStatus(settings, opts = {}) {
  const host = resolveListenHost(settings, opts.env);
  const port = resolveListenPort(opts.env);
  const runtimeHost = typeof opts.runtimeHost === "string" && opts.runtimeHost.trim()
    ? opts.runtimeHost.trim()
    : null;
  const runtimePort = Number.isInteger(opts.runtimePort) ? opts.runtimePort : null;
  const restartRequired = (runtimeHost != null && runtimeHost !== host)
    || (runtimePort != null && runtimePort !== port);
  return {
    host,
    port,
    runtimeHost,
    runtimePort,
    restartRequired,
  };
}
