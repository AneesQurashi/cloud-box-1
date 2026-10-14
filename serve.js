/* ==========================================================================
   serve.js — zero-dependency static file server for local development
   Usage:  node serve.js [port]      (default 8080)
   ========================================================================== */

const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.argv[2]) || 8080;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".rules": "text/plain; charset=utf-8"
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(root, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA-ish fallback: serve index.html for extension-less routes
      if (!path.extname(filePath)) {
        fs.readFile(path.join(root, "index.html"), (e2, html) => {
          if (e2) return res.writeHead(404).end("Not found");
          res.writeHead(200, { "Content-Type": TYPES[".html"] }).end(html);
        });
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" }).end("404 Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    }).end(data);
  });
});

server.listen(port, () => {
  console.log(`\n  CloudBox is running →  http://localhost:${port}\n`);
  console.log("  Serving " + root);
  console.log("  Press Ctrl+C to stop.\n");
});
