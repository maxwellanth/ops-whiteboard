// Picks how this device reaches the private board:
//  - "mac": served by `npm run serve` on 127.0.0.1, which proxies GitHub using the Mac's `gh` login
//  - "token": any other device, such as the phone, with a fine-grained GitHub token kept only on this device
import { createStore } from "./ghstore.js";

const K = { token: "ow.token", repo: "ow.repo" };
const get = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const set = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };

export async function detectConnection() {
  if (["127.0.0.1", "localhost"].includes(location.hostname)) {
    try {
      const r = await fetch("api/health", { cache: "no-store" });
      if (r.ok) {
        const h = await r.json();
        return { mode: "mac", repo: h.repo, path: h.path, store: createStore({ apiBase: new URL("api/gh", location.href).href.replace(/\/$/, ""), repo: h.repo, path: h.path }) };
      }
    } catch {}
  }
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("repo") && !get(K.repo)) set(K.repo, hash.get("repo"));
  const token = get(K.token), repo = get(K.repo);
  if (!token || !repo) return { mode: "setup", repo: repo || hash.get("repo") || "" };
  return { mode: "token", repo, path: "board.json", store: createStore({ token, repo, path: "board.json" }) };
}

export function saveCredentials(repo, token) { set(K.repo, repo.trim()); set(K.token, token.trim()); }
export function forgetToken() { set(K.token, ""); }

export function tokenTemplateUrl(owner) {
  // GitHub's template URL for fine-grained tokens (Aug 2025). Pick only the ops-board-data repository on that page.
  const q = new URLSearchParams({ name: "Ops Whiteboard (phone)", description: "Read/write board.json in the private ops-board-data repo only", expires_in: "90", contents: "write" });
  if (owner) q.set("target_name", owner);
  return "https://github.com/settings/personal-access-tokens/new?" + q.toString();
}
