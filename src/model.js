// Shared board model. Pure ESM with no dependencies; the browser app and the
// `board` CLI both use it.

export const SCHEMA = 1;
export const LIVE_TTL_MS = 10 * 60 * 1000; // "live" expires after 10 minutes without fresh evidence
export const LIST_FIELDS = ["done", "next", "blockers", "decisions", "links", "agents"];
export const SCALAR_FIELDS = ["name", "client", "revenue", "priority", "goal", "currentStep", "demo", "related", "pos"];
export const REVENUE_ORDER = { paid: 0, pipeline: 1, internal: 2 };

export const nowIso = () => new Date().toISOString();
export const uid = (p = "i") => p + "_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function emptyBoard() {
  return { schema: SCHEMA, title: "Operations Whiteboard", updatedAt: nowIso(), updatedBy: "init", projects: {}, scene: { elements: [] }, log: [] };
}

export function normalizeProject(p) {
  const out = {
    id: p.id, name: p.name || p.id, client: p.client || "", revenue: p.revenue || "internal",
    priority: Number(p.priority ?? 3), goal: p.goal || "", currentStep: p.currentStep || "",
    demo: !!p.demo, related: p.related || [], pos: p.pos || null,
    updatedAt: p.updatedAt || nowIso(), updatedBy: p.updatedBy || "unknown", conflicts: p.conflicts || [],
  };
  for (const f of LIST_FIELDS) out[f] = (p[f] || []).map((it) => ({ id: it.id || uid(f[0]), ...it }));
  out.agents = out.agents.map((a) => ({ ...a, status: a.status || { state: "unknown" } }));
  return out;
}

export function normalizeBoard(b) {
  const out = { ...emptyBoard(), ...b };
  out.projects = {};
  for (const [id, p] of Object.entries(b.projects || {})) out.projects[id] = normalizeProject({ ...p, id });
  out.scene = { elements: (b.scene && b.scene.elements) || [] };
  out.log = b.log || [];
  return out;
}

/** Sort order: paid client work first, then pipeline, then internal; then by priority (1 = highest). */
export function sortedProjects(board) {
  return Object.values(board.projects).sort(
    (a, b) => (REVENUE_ORDER[a.revenue] ?? 9) - (REVENUE_ORDER[b.revenue] ?? 9) || a.priority - b.priority || a.name.localeCompare(b.name)
  );
}

export function ago(iso, now = Date.now()) {
  if (!iso) return "never";
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 0) return "just now";
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

/** The honest display state of an agent status. Never shows "live" without fresh evidence. */
export function statusView(status, now = Date.now()) {
  const st = status || { state: "unknown" };
  const when = st.checkedAt || st.at;
  if (st.state === "live") {
    const fresh = st.evidence && when && now - Date.parse(when) <= LIVE_TTL_MS;
    if (fresh) return { tone: "live", label: `LIVE · checked ${ago(when, now)}`, detail: `evidence: ${st.evidence}` };
    return { tone: "stale", label: `was live, now unverified · last seen ${ago(when, now)}`, detail: st.evidence ? `old evidence: ${st.evidence}` : "no evidence" };
  }
  if (st.state === "reported") return { tone: "reported", label: `last reported ${ago(when, now)}${st.by ? " by " + st.by : ""}`, detail: st.note || "" };
  return { tone: "unknown", label: when ? `unknown · checked ${ago(when, now)}` : "unknown · never reported", detail: st.note || "" };
}

function addLog(board, by, msg) {
  board.log = [{ id: uid("l"), at: nowIso(), by, msg }, ...(board.log || [])].slice(0, 300);
}

/**
 * Apply one operation. Both the CLI and the app's edit panel go through here, so every
 * change is validated the same way. Returns a short human message for commit and log.
 */
export function applyOp(board, op, by) {
  const t = nowIso();
  const need = (pid) => {
    const p = board.projects[pid];
    if (!p) throw new Error(`No project "${pid}". Known: ${Object.keys(board.projects).join(", ") || "(none)"}`);
    return p;
  };
  let msg;
  switch (op.type) {
    case "newProject": {
      if (board.projects[op.pid]) throw new Error(`Project "${op.pid}" already exists`);
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(op.pid)) throw new Error("Project id must be lowercase letters, digits, dashes");
      board.projects[op.pid] = normalizeProject({ id: op.pid, ...op.fields, updatedAt: t, updatedBy: by });
      msg = `new project ${op.pid}`;
      break;
    }
    case "set": {
      const p = need(op.pid);
      const allowed = ["name", "client", "revenue", "priority", "goal", "currentStep", "demo", "related", "pos"];
      if (!allowed.includes(op.field)) throw new Error(`Field must be one of: ${allowed.join(", ")}`);
      let v = op.value;
      if (op.field === "priority") { v = Number(v); if (!(v >= 1 && v <= 5)) throw new Error("priority must be 1-5"); }
      if (op.field === "revenue" && !(v in REVENUE_ORDER)) throw new Error("revenue must be paid, pipeline or internal");
      if (op.field === "demo") v = v === true || v === "true";
      if (op.field === "related" && typeof v === "string") v = v.split(",").map((s) => s.trim()).filter(Boolean);
      p[op.field] = v;
      msg = `${op.pid}: set ${op.field}`;
      break;
    }
    case "add": {
      const p = need(op.pid);
      const field = { done: "done", next: "next", blocker: "blockers", blockers: "blockers", decision: "decisions", decisions: "decisions", link: "links", links: "links" }[op.list];
      if (!field) throw new Error("list must be done, next, blocker, decision or link");
      if (!op.text) throw new Error("text is required");
      const item = { id: uid(field[0]), text: op.text, at: t, by };
      if (op.url) item.url = op.url;
      if (field === "links" && !op.url) throw new Error("a link needs --url");
      p[field] = [...p[field], item];
      msg = `${op.pid}: +${field.replace(/s$/, "")} "${op.text.slice(0, 50)}"`;
      break;
    }
    case "resolve": {
      // Removes an item from next/blockers/decisions. For `next`, the item also moves to `done`.
      const p = need(op.pid);
      const field = { next: "next", blocker: "blockers", blockers: "blockers", decision: "decisions", decisions: "decisions", done: "done", link: "links", links: "links" }[op.list];
      if (!field) throw new Error("bad list");
      const list = p[field];
      const idx = /^\d+$/.test(String(op.item)) ? Number(op.item) - 1 : list.findIndex((x) => x.id === op.item);
      if (idx < 0 || idx >= list.length) throw new Error(`No item ${op.item} in ${field} (1-${list.length})`);
      const [it] = list.splice(idx, 1);
      if (field === "next") p.done = [...p.done, { id: uid("d"), text: it.text + (op.note ? ` (${op.note})` : ""), at: t, by }];
      if (field === "decisions" && op.note) p.done = [...p.done, { id: uid("d"), text: `Decided: ${it.text} → ${op.note}`, at: t, by }];
      msg = `${op.pid}: resolved ${field.replace(/s$/, "")} "${it.text.slice(0, 50)}"`;
      break;
    }
    case "agent": {
      const p = need(op.pid);
      const state = op.state || "reported";
      if (!["live", "reported", "unknown"].includes(state)) throw new Error("state must be live, reported or unknown");
      if (state === "live" && !op.evidence) throw new Error('"live" needs --evidence (for example: "pid 4121 running codex in ~/x, checked by ps")');
      let a = p.agents.find((x) => x.id === op.agent || x.name.toLowerCase() === String(op.agent).toLowerCase());
      if (!a) { a = { id: uid("a"), name: op.agent, owns: "" }; p.agents = [...p.agents, a]; }
      if (op.owns !== undefined) a.owns = op.owns;
      if (op.remove) { p.agents = p.agents.filter((x) => x !== a); msg = `${op.pid}: removed agent ${a.name}`; break; }
      a.status = { state, note: op.note || "", evidence: op.evidence || "", checkedAt: t, by };
      msg = `${op.pid}: ${a.name} → ${state}${op.note ? " (" + op.note.slice(0, 40) + ")" : ""}`;
      break;
    }
    case "deleteProject": {
      need(op.pid);
      delete board.projects[op.pid];
      msg = `deleted project ${op.pid}`;
      break;
    }
    case "clearConflicts": {
      need(op.pid).conflicts = [];
      msg = `${op.pid}: cleared conflict notes`;
      break;
    }
    default:
      throw new Error("Unknown op " + op.type);
  }
  if (op.pid && board.projects[op.pid]) { board.projects[op.pid].updatedAt = t; board.projects[op.pid].updatedBy = by; }
  board.updatedAt = t;
  board.updatedBy = by;
  addLog(board, by, msg);
  return msg;
}

// ---------- three-way merge (used when a save hits a newer remote version) ----------

function mergeList(base = [], local = [], remote = [], noteConflict) {
  const b = new Map(base.map((x) => [x.id, x]));
  const l = new Map(local.map((x) => [x.id, x]));
  const r = new Map(remote.map((x) => [x.id, x]));
  const order = [...remote.map((x) => x.id), ...local.map((x) => x.id).filter((id) => !r.has(id))];
  const out = [];
  for (const id of order) {
    const bi = b.get(id), li = l.get(id), ri = r.get(id);
    if (bi && !li && ri) { if (!same(bi, ri)) { out.push(ri); noteConflict?.(`item kept: you removed it, but it was changed elsewhere: "${ri.text || ri.name}"`); } continue; } // locally deleted
    if (bi && li && !ri) { if (!same(bi, li)) { out.push(li); noteConflict?.(`item kept: it was removed elsewhere, but you changed it: "${li.text || li.name}"`); } continue; } // remotely deleted
    if (li && ri) {
      if (same(li, ri)) out.push(ri);
      else if (bi && same(bi, li)) out.push(ri);
      else if (bi && same(bi, ri)) out.push(li);
      else { out.push(li); noteConflict?.(`both changed "${li.text || li.name}": your version kept; other version: ${JSON.stringify(ri.status || ri.text)}`); }
      continue;
    }
    out.push(li || ri);
  }
  return out;
}

function mergeElements(local = [], remote = []) {
  // Same rule as Excalidraw's collaboration: per element, the higher version wins and the lower versionNonce breaks a tie.
  // Deleted elements stay in the array as isDeleted tombstones, so a deletion also merges correctly.
  const m = new Map();
  for (const e of remote) m.set(e.id, e);
  for (const e of local) {
    const o = m.get(e.id);
    if (!o || e.version > o.version || (e.version === o.version && e.versionNonce < o.versionNonce)) m.set(e.id, e);
  }
  return [...m.values()];
}

/** Three-way merge. `local` wins a true conflict, and the losing value is saved in project.conflicts. */
export function mergeBoards(base, local, remote, who = "you") {
  base = normalizeBoard(base || emptyBoard());
  local = normalizeBoard(local);
  remote = normalizeBoard(remote);
  const out = normalizeBoard(clone(remote));
  const conflicts = [];
  const ids = new Set([...Object.keys(local.projects), ...Object.keys(remote.projects)]);
  for (const id of ids) {
    const b = base.projects[id], l = local.projects[id], r = remote.projects[id];
    if (!l) { if (b && r && same(b, r)) delete out.projects[id]; continue; } // deleted locally, untouched remotely
    if (!r) { if (!b || !same(b, l)) out.projects[id] = l; continue; } // new locally, or deleted remotely while changed locally
    const p = clone(r);
    const notes = [];
    for (const f of SCALAR_FIELDS) {
      const bv = b?.[f], lv = l[f], rv = r[f];
      if (same(lv, rv)) continue;
      if (same(bv, rv)) p[f] = lv; // only the local side changed
      else if (same(bv, lv)) p[f] = rv; // only the remote side changed
      else if (f !== "pos") { p[f] = lv; notes.push(`${f}: ${who}'s value kept; the other edit (${r.updatedBy}, ${r.updatedAt}) was: ${JSON.stringify(rv)}`); }
    }
    for (const f of LIST_FIELDS) p[f] = mergeList(b?.[f], l[f], r[f], (n) => notes.push(`${f}: ${n}`));
    p.conflicts = mergeList(b?.conflicts, l.conflicts, r.conflicts);
    if (notes.length) {
      const c = notes.map((text) => ({ id: uid("c"), text, at: nowIso() }));
      p.conflicts = [...p.conflicts, ...c];
      conflicts.push(...notes.map((n) => `${id}: ${n}`));
    }
    out.projects[id] = p;
  }
  out.scene.elements = mergeElements(local.scene.elements, remote.scene.elements);
  const seen = new Set();
  out.log = [...local.log, ...remote.log].filter((x) => (seen.has(x.id) ? false : seen.add(x.id))).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 300);
  if (conflicts.length) addLog(out, who, `merged a conflicting edit (${conflicts.length} field(s)); details are kept on the cards`);
  return { board: out, conflicts };
}

// ---------- readable snapshot (HTML) ----------

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const safeUrl = (u) => (/^(https?:|mailto:)/i.test(u || "") ? u : "#");

export function snapshotHtml(board, { svg = "", source = "", fetchedAt = "" } = {}) {
  const now = Date.now();
  const list = (items, cls = "") => (items.length ? `<ul class="${cls}">${items.map((i) => `<li>${i.url ? `<a href="${esc(safeUrl(i.url))}">${esc(i.text)}</a>` : esc(i.text)}${i.at ? ` <small>${esc(ago(i.at, now))}${i.by ? " · " + esc(i.by) : ""}</small>` : ""}</li>`).join("")}</ul>` : `<p class="none">none</p>`);
  const cards = sortedProjects(board).map((p) => `
  <section class="card ${p.revenue}">
    <h2>${p.revenue === "paid" ? "$ " : ""}${esc(p.name)} ${p.demo ? '<span class="demo">DEMO DATA</span>' : ""}</h2>
    <p class="meta">${esc(p.client || "no client")} · ${esc(p.revenue)} · priority ${p.priority} · updated ${esc(ago(p.updatedAt, now))} by ${esc(p.updatedBy)}</p>
    <p><b>Goal:</b> ${esc(p.goal) || "<i>not set</i>"}</p>
    <p><b>Now:</b> ${esc(p.currentStep) || "<i>not set</i>"}</p>
    <h3>Agents</h3>${p.agents.length ? `<ul>${p.agents.map((a) => { const v = statusView(a.status, now); return `<li><b>${esc(a.name)}</b>: owns ${esc(a.owns || "?")}<br><span class="st ${v.tone}">${esc(v.label)}</span> ${esc(v.detail)}</li>`; }).join("")}</ul>` : '<p class="none">none assigned</p>'}
    <h3>Needs your decision</h3>${list(p.decisions, "dec")}
    <h3>Roadblocks</h3>${list(p.blockers, "blk")}
    <h3>Next</h3>${list(p.next)}
    <h3>Done</h3>${list(p.done)}
    <h3>Links</h3>${list(p.links)}
    ${p.conflicts.length ? `<h3>Conflict notes</h3>${list(p.conflicts)}` : ""}
  </section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ops Whiteboard snapshot</title><style>
body{font:15px/1.45 -apple-system,system-ui,sans-serif;margin:16px auto;max-width:900px;padding:0 16px;color:#1e1e1e;background:#fff}
h1{margin:0}.card{border:2px solid #444;border-radius:10px;padding:12px 16px;margin:16px 0;break-inside:avoid}
.card.paid{border-color:#2f9e44;border-width:3px}.meta{color:#555;margin-top:0}h3{margin:10px 0 2px;font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#444}
ul{margin:2px 0 6px 18px;padding:0}.none{color:#999;margin:2px 0}.demo{background:#ffec99;font-size:12px;padding:1px 6px;border-radius:4px;vertical-align:middle}
.st{font-size:12px;padding:1px 6px;border-radius:4px;background:#eee}.st.live{background:#b2f2bb}.st.stale{background:#ffe8cc}.st.reported{background:#d0ebff}
.dec li{color:#c2410c}.blk li{color:#c92a2a}.board svg{max-width:100%;height:auto;border:1px solid #ddd}small{color:#777}
@media print{a{color:inherit}.card{page-break-inside:avoid}}</style></head><body>
<h1>${esc(board.title)}: snapshot</h1>
<p class="meta">Generated ${esc(new Date().toLocaleString())}${source ? " from " + esc(source) : ""}${fetchedAt ? " · data fetched " + esc(new Date(fetchedAt).toLocaleString()) : ""} · last change ${esc(ago(board.updatedAt, now))} by ${esc(board.updatedBy)}.
Status words mean: <b>LIVE</b> = fresh evidence under 10 min; <b>last reported</b> = what the agent said, not verified now; <b>unknown</b> = no report.</p>
${svg ? `<div class="board">${svg}</div>` : ""}
${cards}
<h3>Recent activity</h3><ul>${board.log.slice(0, 30).map((l) => `<li>${esc(new Date(l.at).toLocaleString())} · <b>${esc(l.by)}</b>: ${esc(l.msg)}</li>`).join("")}</ul>
</body></html>`;
}
