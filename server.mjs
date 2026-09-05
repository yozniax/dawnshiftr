import http from "node:http";
import https from "node:https";
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

function proxyRequest(req, res, target) {
  let dest;
  try {
    dest = new URL(target);
  } catch {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("bad url");
    return;
  }
  if (dest.protocol !== "http:" && dest.protocol !== "https:") {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("bad url");
    return;
  }

  const lib = dest.protocol === "https:" ? https : http;
  const upstream = lib.request(
    {
      protocol: dest.protocol,
      hostname: dest.hostname,
      port: dest.port || (dest.protocol === "https:" ? 443 : 80),
      path: dest.pathname + dest.search,
      method: "GET",
      headers: {
        "User-Agent": "cliamp-chrome/1.0",
        Accept: "*/*",
        "Icy-MetaData": "0",
        Connection: "keep-alive",
      },
    },
    (upRes) => {
      const type = upRes.headers["content-type"] || "application/octet-stream";
      res.writeHead(upRes.statusCode || 200, {
        "Content-Type": type,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      upRes.on("error", () => {
        if (!res.writableEnded) res.destroy();
      });
      upRes.pipe(res);
    }
  );

  const abort = () => {
    upstream.destroy();
  };
  req.on("aborted", abort);
  res.on("close", () => {
    if (!res.writableFinished) abort();
  });
  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(String(err.message || err));
    } else if (!res.writableEnded) {
      res.destroy();
    }
  });
  upstream.setTimeout(0);
  upstream.end();
}

const server = http.createServer((req, res) => {
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  const url = new URL(req.url || "/", `http://${host}`);

  if (url.pathname === "/proxy") {
    const target = url.searchParams.get("url") || "";
    if (!/^https?:\/\//i.test(target)) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad url");
      return;
    }
    proxyRequest(req, res, target);
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

server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 0;
server.timeout = 0;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`cliamp preview http://127.0.0.1:${PORT}`);
});
