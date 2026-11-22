/**
 * HTTP routes for voice clips and transcription.
 * Never includes API keys in responses, logs, or error payloads.
 */

const SAFE_ID = /^[a-f0-9]{8,64}$/i;
const MAX_UPLOAD = 3_000_000;

export async function handleVoiceRequest(req, res, url, voice, helpers = {}) {
  const json = helpers.json || defaultJson;
  if (req.method === "GET" && url.pathname.startsWith("/api/voice/clips/")) {
    const id = url.pathname.slice("/api/voice/clips/".length);
    if (!SAFE_ID.test(id)) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "not found" }));
      return true;
    }
    const clip = voice?.getClip?.(id);
    if (!clip?.buffer) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "not found" }));
      return true;
    }
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(clip.buffer.length),
    });
    res.end(clip.buffer);
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/voice/transcribe") {
    try {
      const part = await readMultipart(req, { maxBytes: MAX_UPLOAD });
      const file = part.file;
      if (!file?.buffer?.length) {
        json(res, { ok: false, error: "没能识别出内容。" }, 400);
        return true;
      }
      const result = await voice.transcribe({
        buffer: file.buffer,
        mime: file.mime,
        filename: file.filename,
      });
      json(res, result, result.ok ? 200 : 400);
      return true;
    } catch {
      json(res, { ok: false, error: "语音识别暂时不可用。" }, 400);
      return true;
    }
  }
  return false;
}

export function readMultipart(req, { maxBytes = MAX_UPLOAD } = {}) {
  return new Promise((resolve, reject) => {
    const ctype = String(req.headers["content-type"] || "");
    const match = ctype.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!match) {
      reject(new Error("missing-boundary"));
      return;
    }
    const boundary = (match[1] || match[2]).trim();
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(parseMultipart(Buffer.concat(chunks), boundary));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export function parseMultipart(buffer, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = indexOf(buffer, delim, 0);
  while (start !== -1) {
    const after = start + delim.length;
    if (buffer[after] === 45 && buffer[after + 1] === 45) break;
    const next = indexOf(buffer, delim, after);
    const slice = buffer.subarray(after, next === -1 ? buffer.length : next);
    parts.push(parsePart(trimCrlf(slice)));
    start = next;
  }
  const file = parts.find((part) => part.filename) || null;
  const fields = {};
  for (const part of parts) {
    if (!part.filename && part.name) fields[part.name] = part.buffer.toString("utf8");
  }
  return { file, fields };
}

function parsePart(raw) {
  const split = indexOf(raw, Buffer.from("\r\n\r\n"), 0);
  const headerBuf = split === -1 ? raw : raw.subarray(0, split);
  const body = split === -1 ? Buffer.alloc(0) : trimTrailingCrlf(raw.subarray(split + 4));
  const headers = headerBuf.toString("utf8");
  const disp = headers.match(/Content-Disposition:\s*form-data;([^;\r\n]+(?:;[^;\r\n]+)*)/i);
  const name = valueOf(disp?.[1], "name");
  const filename = valueOf(disp?.[1], "filename");
  const mimeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
  return {
    name,
    filename,
    mime: mimeMatch ? mimeMatch[1].trim() : "application/octet-stream",
    buffer: body,
  };
}

function valueOf(segment, key) {
  if (!segment) return null;
  const match = segment.match(new RegExp(`${key}="([^"]*)"`, "i"))
    || segment.match(new RegExp(`${key}=([^;\\s]+)`, "i"));
  return match ? match[1] : null;
}

function indexOf(buffer, needle, from) {
  return buffer.indexOf(needle, from);
}

function trimCrlf(buf) {
  let start = 0;
  if (buf[0] === 13 && buf[1] === 10) start = 2;
  return buf.subarray(start);
}

function trimTrailingCrlf(buf) {
  let end = buf.length;
  if (end >= 2 && buf[end - 2] === 13 && buf[end - 1] === 10) end -= 2;
  return buf.subarray(0, end);
}

function defaultJson(res, body, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
