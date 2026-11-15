// Mac mode: serves the built app on 127.0.0.1 and proxies GitHub calls for the board repo
// using the Mac's existing `gh` login, so no token is stored in the browser.
// It listens on 127.0.0.1 only, checks the Host header (against DNS rebinding), sends no CORS
// headers, and forwards only the one board repo's paths.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT || 4173);
const cfg = JSON.parse(readFileSync(join(ROOT, "board.config.json"), "utf8"));
const TOKEN = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

createServer(async (req, res) => {
  if (!ALLOWED_HOSTS.has(req.headers.host)) { res.writeHead(403); return res.end("bad host"); }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/health") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true, mode: "mac-proxy", repo: cfg.repo, path: cfg.path })); }
  if (url.pathname.startsWith("/api/gh/")) {
    const ghPath = url.pathname.slice("/api/gh".length);
    if (!ghPath.startsWith(`/repos/${cfg.repo}/`)) { res.writeHead(403); return res.end("only the board repo is proxied"); }
    if (req.headers.origin && !ALLOWED_HOSTS.has(req.headers.origin.replace(/^https?:\/\//, ""))) { res.writeHead(403); return res.end("bad origin"); }
    const body = ["PUT", "POST", "PATCH"].includes(req.method) ? await new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); }) : undefined;
    const r = await fetch("https://api.github.com" + ghPath + url.search, { method: req.method, body, headers: { Authorization: `Bearer ${TOKEN}`, Accept: req.headers.accept || "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) } });
    res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store" });
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(PORT, "127.0.0.1", () => console.log(`Ops Whiteboard (Mac mode): http://127.0.0.1:${PORT}/  · data: ${cfg.repo}/${cfg.path}`));
