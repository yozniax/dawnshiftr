import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 43187);
const nowPlaying = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".mp3": "audio/mpeg",
};

function rememberTitle(url, title) {
  if (!title) return;
  nowPlaying.set(url, { title, at: Date.now() });
}

function titleFromIcy(text) {
  const m = String(text).match(/StreamTitle='([^']*)'/i);
  if (!m) return "";
  const raw = m[1].replace(/\0+$/g, "").trim();
  try {
    return decodeURIComponent(escape(raw));
  } catch {
    return raw;
  }
}

function icyStripper(metaInt, onTitle) {
  let buf = Buffer.alloc(0);
  let mode = "audio";
  let need = metaInt;
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const out = [];
    while (buf.length) {
      if (mode === "audio") {
        const n = Math.min(need, buf.length);
        out.push(buf.subarray(0, n));
        buf = buf.subarray(n);
        need -= n;
        if (need === 0) {
          mode = "len";
          need = 1;
        }
      } else if (mode === "len") {
        const len = buf[0] * 16;
        buf = buf.subarray(1);
        if (len === 0) {
          mode = "audio";
          need = metaInt;
        } else {
          mode = "meta";
          need = len;
        }
      } else {
        if (buf.length < need) break;
        const meta = buf.subarray(0, need);
        buf = buf.subarray(need);
        const title = titleFromIcy(meta.toString("latin1"));
        if (title) onTitle(title);
        mode = "audio";
        need = metaInt;
      }
    }
    return Buffer.concat(out);
  };
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  fs.createReadStream(filePath).pipe(res);
}

function safeJoin(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = decoded === "/" ? "/player.html" : decoded;
  const full = path.normalize(path.join(root, rel));
  if (!full.startsWith(root)) return null;
  return full;
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  const url = new URL(req.url || "/", `http://${host}`);

  if (url.pathname === "/v1/ingest") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "text/plain" });
      res.end("POST");
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    if (raw.length > 200_000) {
      res.writeHead(413, { "content-type": "text/plain" });
      res.end("too large");
      return;
    }
    let payload = null;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("json");
      return;
    }
    if (!payload || payload.v !== 1 || !payload.installId || !Array.isArray(payload.events)) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("shape");
      return;
    }
    const dir = path.join(root, "data");
    fs.mkdirSync(dir, { recursive: true });
    const line =
      JSON.stringify({
        at: Date.now(),
        geo: { country: "XX", city: "preview" },
        v: payload.v,
        app: payload.app || "dawnshiftr",
        installId: String(payload.installId).slice(0, 80),
        tz: String(payload.tz || "").slice(0, 80),
        locale: String(payload.locale || "").slice(0, 32),
        totals: payload.totals || {},
        events: payload.events.slice(0, 80),
      }) + "\n";
    fs.appendFileSync(path.join(dir, "telemetry.jsonl"), line);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname.startsWith("/rb/")) {
    const rest = `${url.pathname.slice(3)}${url.search}`;
    if (!rest.startsWith("/json/")) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad path");
      return;
    }
    const hosts = ["https://de1.api.radio-browser.info", "https://fi1.api.radio-browser.info"];
    let lastError = null;
    for (const host of hosts) {
      try {
        const incoming = await fetch(`${host}${rest}`, {
          headers: {
            Accept: "application/json",
            "User-Agent": "DAWNSHIFTR/1.0",
          },
        });
        const body = Buffer.from(await incoming.arrayBuffer());
        res.writeHead(incoming.status, {
          "Content-Type": incoming.headers.get("content-type") || "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        });
        res.end(body);
        return;
      } catch (err) {
        lastError = err;
      }
    }
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(String(lastError?.message || lastError || "radio-browser failed"));
    return;
  }

  if (url.pathname === "/nowplaying") {
    const target = url.searchParams.get("url") || "";
    const hit = nowPlaying.get(target);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ title: hit?.title || "" }));
    return;
  }

  if (url.pathname === "/proxy") {
    const target = url.searchParams.get("url") || "";
    if (!/^https?:\/\//i.test(target)) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad url");
      return;
    }
    try {
      const incoming = await fetch(target, {
        headers: {
          "User-Agent": "DAWNSHIFTR/1.0",
          Accept: "*/*",
          "Icy-MetaData": "1",
        },
        redirect: "follow",
      });
      const type = incoming.headers.get("content-type") || "audio/mpeg";
      const metaInt = Number(incoming.headers.get("icy-metaint"));
      res.writeHead(incoming.ok ? 200 : incoming.status, {
        "Content-Type": type.split(";")[0],
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      if (req.method === "HEAD" || !incoming.body) {
        res.end();
        return;
      }
      const reader = incoming.body.getReader();
      req.on("close", () => {
        reader.cancel().catch(() => {});
      });
      const strip =
        Number.isFinite(metaInt) && metaInt > 0
          ? icyStripper(metaInt, (title) => rememberTitle(target, title))
          : null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        const audio = strip ? strip(chunk) : chunk;
        if (!audio.length) continue;
        if (!res.write(audio)) {
          await new Promise((resolve) => res.once("drain", resolve));
        }
      }
      res.end();
    } catch (err) {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(String(err?.message || err));
    }
    return;
  }

  const filePath = safeJoin(url.pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (!err && st.isFile()) {
      sendFile(res, filePath);
      return;
    }
    const asHtml = filePath + ".html";
    if (!err && st.isDirectory()) {
      const idx = path.join(filePath, "index.html");
      if (fs.existsSync(idx)) {
        sendFile(res, idx);
        return;
      }
    }
    if (fs.existsSync(asHtml)) {
      sendFile(res, asHtml);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`DAWNSHIFTr preview http://127.0.0.1:${PORT}`);
});
