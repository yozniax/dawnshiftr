import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 43187);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

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
            "User-Agent": "broamp/1.0",
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
          "User-Agent": "broamp/1.0",
          Accept: "*/*",
        },
        redirect: "follow",
      });
      const type = incoming.headers.get("content-type") || "audio/mpeg";
      res.writeHead(incoming.ok ? 200 : incoming.status, {
        "Content-Type": type,
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
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) {
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
  console.log(`broamp preview http://127.0.0.1:${PORT}`);
});
