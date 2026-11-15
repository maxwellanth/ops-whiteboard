// Turns structured project data into dry-erase whiteboard writing: marker text, quick doodles,
// loose circled clusters and a web of arrows. These "managed" elements are rebuilt from the data
// and never saved, so an assistant's update can't clobber your drawings and your drawings
// can't corrupt the data. This is only a visual layer: every word comes from board.json and statusView().
import { convertToExcalidrawElements, FONT_FAMILY } from "@excalidraw/excalidraw";
import { sortedProjects, statusView, ago } from "./model.js";

const FONT = FONT_FAMILY.Excalifont;
const LH = 1.25; // Excalifont line height
const W = 420; // writing width of a cluster
// Dry-erase marker colours
const INK = { black: "#1e1e1e", blue: "#1c4fa1", green: "#237a3b", red: "#c92a2a", orange: "#d9480f", purple: "#6741d9", faded: "#9aa0a6" };
const TONE = { live: INK.green, stale: INK.orange, reported: INK.blue, unknown: INK.faded };
const LANE = {
  paid: { ink: INK.green, label: "$ PAID CLIENT", ring: 3 },
  pipeline: { ink: INK.blue, label: "pipeline", ring: 2 },
  internal: { ink: INK.faded, label: "internal / side", ring: 1 },
};

export const isManaged = (el) => !!el?.customData?.managed;

function wrap(text, fontSize, width) {
  const max = Math.max(8, Math.floor(width / (fontSize * 0.5)));
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((line + " " + word).trim().length > max) {
        if (line) out.push(line);
        line = word.length > max ? word.slice(0, max - 1) + "…" : word;
      } else line = (line + " " + word).trim();
    }
    out.push(line);
  }
  return out;
}

// Small deterministic wobble so every cluster looks hand-placed but stays stable between renders.
function rng(seedStr) {
  let h = 2166136261;
  for (const c of seedStr) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

/** Default spot for a cluster with no saved position: paid work on the inner ring, everything else further out. */
function defaultPos(p, i, n, ring) {
  const r = ring === 0 ? 800 : 1300;
  const a = -Math.PI / 2 + (2 * Math.PI * (i + (ring ? 0.5 : 0))) / Math.max(n, 1);
  return { x: Math.round(Math.cos(a) * r - W / 2), y: Math.round(Math.sin(a) * r - 220) };
}

export function cardBox(pid, elements) {
  return elements.find((e) => e.customData?.managed && e.customData.pid === pid && e.customData.role === "card" && !e.isDeleted);
}

const rectOf = (g) => ({ cx: g.x + g.w / 2, cy: g.y + g.h / 2, rx: g.w / 2, ry: g.h / 2 });
function edge(sh, dx, dy, gap) {
  const len = Math.hypot(dx, dy) || 1;
  const t = sh.ellipse ? 1 / Math.sqrt((dx / sh.rx) ** 2 + (dy / sh.ry) ** 2) : Math.min(sh.rx / Math.abs(dx || 1e-9), sh.ry / Math.abs(dy || 1e-9));
  return [sh.cx + dx * t + (dx / len) * gap, sh.cy + dy * t + (dy / len) * gap];
}
function segment(a, b) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  return [edge(a, dx, dy, 12), edge(b, -dx, -dy, 12)];
}

// ---------- doodles: quick marker sketches made of ordinary editable line/ellipse elements ----------
const line = (x, y, pts, color, w = 2, extra = {}) => ({ type: "line", x, y, points: pts, strokeColor: color, strokeWidth: w, roughness: 2, ...extra });
const circle = (x, y, wd, ht, color, w = 2, extra = {}) => ({ type: "ellipse", x, y, width: wd, height: ht, strokeColor: color, backgroundColor: "transparent", strokeWidth: w, roughness: 2, ...extra });
const scrawl = (x, y, text, size, color, extra = {}) => ({ type: "text", x, y, text, fontSize: size, fontFamily: FONT, strokeColor: color, ...extra });

const DOODLE = {
  // Circled dollar sign for paid client work
  paid: (x, y) => [circle(x, y, 46, 46, INK.green, 2), scrawl(x + 13, y + 5, "$", 30, INK.green)],
  // Light bulb for pipeline / ideas
  pipeline: (x, y) => [circle(x + 6, y, 32, 32, INK.blue), line(x + 14, y + 32, [[0, 0], [16, 0]], INK.blue), line(x + 15, y + 38, [[0, 0], [14, 0]], INK.blue),
    line(x - 4, y + 2, [[0, 0], [-8, -6]], INK.blue, 1), line(x + 48, y + 2, [[0, 0], [8, -6]], INK.blue, 1), line(x + 22, y - 6, [[0, 0], [0, -8]], INK.blue, 1)],
  // Little cog for internal / side work
  internal: (x, y) => [circle(x + 8, y + 8, 30, 30, INK.faded), circle(x + 18, y + 18, 10, 10, INK.faded, 1),
    ...[0, 1, 2, 3, 4, 5].map((k) => { const a = (k * Math.PI) / 3; return line(x + 23 + Math.cos(a) * 15, y + 23 + Math.sin(a) * 15, [[0, 0], [Math.cos(a) * 7, Math.sin(a) * 7]], INK.faded, 2); })],
  // Robot head for an AI agent; a plain stick head for a person
  robot: (x, y, c) => [line(x, y + 6, [[0, 0], [20, 0], [20, 16], [0, 16], [0, 0]], c, 2), line(x + 10, y + 6, [[0, 0], [0, -6]], c, 1), circle(x + 8, y - 4, 4, 4, c, 1),
    line(x + 5, y + 11, [[0, 0], [2, 0]], c, 2), line(x + 13, y + 11, [[0, 0], [2, 0]], c, 2)],
  person: (x, y, c) => [circle(x + 4, y, 12, 12, c, 2), line(x + 10, y + 12, [[0, 0], [0, 10]], c, 2), line(x + 2, y + 15, [[0, 0], [16, 0]], c, 1)],
  // Stick figure with a question mark: "Max needs to decide"
  you: (x, y) => [circle(x + 8, y, 18, 18, INK.red), line(x + 17, y + 18, [[0, 0], [0, 26]], INK.red), line(x + 5, y + 26, [[0, 0], [24, -4]], INK.red),
    line(x + 17, y + 44, [[0, 0], [-10, 16]], INK.red), line(x + 17, y + 44, [[0, 0], [10, 16]], INK.red), scrawl(x + 30, y - 10, "?", 34, INK.red)],
  // Brick wall for roadblocks
  wall: (x, y) => [line(x, y, [[0, 0], [34, 0], [34, 24], [0, 24], [0, 0]], INK.red, 2), line(x, y + 12, [[0, 0], [34, 0]], INK.red, 1),
    line(x + 12, y, [[0, 0], [0, 12]], INK.red, 1), line(x + 24, y + 12, [[0, 0], [0, 12]], INK.red, 1), line(x + 8, y + 12, [[0, 0], [0, 12]], INK.red, 1)],
  // Star burst next to the top priority
  star: (x, y, c) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const a = (k * Math.PI) / 4; return line(x + Math.cos(a) * 6, y + Math.sin(a) * 6, [[0, 0], [Math.cos(a) * (k % 2 ? 7 : 12), Math.sin(a) * (k % 2 ? 7 : 12)]], c, 2); }),
  // Wobbly underline
  underline: (x, y, w, c, r) => line(x, y, [[0, 0], [w * 0.3, 2 + r() * 3], [w * 0.65, -1 - r() * 2], [w, 2]], c, 3),
};

/** Builds every managed element. Returns { elements, positions }. */
export function buildManaged(board, now = Date.now()) {
  const sk = [];
  const meta = new Map(); // skeleton id -> customData
  let auto = 0;
  const add = (s, pid, role) => { if (!s.id) s.id = `m:${pid}:z${auto++}`; sk.push(s); meta.set(s.id, { managed: true, pid, role }); return s; };
  const projects = sortedProjects(board);
  const paid = projects.filter((p) => p.revenue === "paid");
  const rest = projects.filter((p) => p.revenue !== "paid");

  // ---- the middle of the board: "THE OPERATION", scrawled and circled ----
  const decisions = projects.reduce((n, p) => n + p.decisions.length, 0);
  const blockers = projects.reduce((n, p) => n + p.blockers.length, 0);
  add(circle(-260, -125, 520, 250, INK.black, 2, { id: "m:hq", roughness: 2 }), "_hq", "hq");
  add(scrawl(-185, -82, "THE OPERATION", 44, INK.black, { id: "m:hq:t" }), "_hq", "hq");
  add(DOODLE.underline(-180, -22, 330, INK.black, rng("hq")), "_hq", "hq");
  add(scrawl(-175, -6, `${paid.length} paid · ${rest.filter((p) => p.revenue === "pipeline").length} pipeline · ${rest.filter((p) => p.revenue === "internal").length} side`, 20, INK.green, { id: "m:hq:s" }), "_hq", "hq");
  add(scrawl(-175, 24, `${decisions} decision(s) waiting on you`, 20, decisions ? INK.red : INK.faded, { id: "m:hq:d" }), "_hq", "hq");
  add(scrawl(-175, 52, `${blockers} roadblock(s)`, 20, blockers ? INK.red : INK.faded, { id: "m:hq:b" }), "_hq", "hq");

  const positions = {};
  const geom = {};
  [paid, rest].forEach((group, ring) => group.forEach((p, i) => {
    const pos = p.pos || defaultPos(p, i, group.length, ring);
    positions[p.id] = pos;
    const lane = LANE[p.revenue] || LANE.internal;
    const r = rng(p.id);
    const g = [`g:${p.id}`];
    const put = (s, role) => add({ ...s, groupIds: g }, p.id, role);
    const tilt = () => (r() - 0.5) * 0.03;
    const x0 = pos.x + 24;
    let y = pos.y + 22;
    const text = (id, str, fontSize, color = INK.black, extra = {}, indent = 0, width = W - indent) => {
      const lines = wrap(str, fontSize, width);
      put({ ...scrawl(x0 + indent, y, lines.join("\n"), fontSize, color, extra), id: `m:${p.id}:${id}`, angle: tilt() }, id);
      y += lines.length * fontSize * LH + 4;
      return lines.length;
    };
    const head = (id, label, color) => { y += 8; text(id, label, 17, color); };

    // Title row: doodle, big marker title, wobbly underline, star for P1
    DOODLE[p.revenue]?.(x0, y).forEach((s) => put(s, "doodle"));
    const tStart = y;
    y += 2;
    const tl = wrap(p.name, 32, W - 64);
    put({ ...scrawl(x0 + 60, y, tl.join("\n"), 32, lane.ink === INK.faded ? INK.black : lane.ink), id: `m:${p.id}:title`, angle: tilt() }, "title");
    y += tl.length * 32 * LH;
    put(DOODLE.underline(x0 + 58, y + 2, Math.min(W - 70, Math.max(...tl.map((l) => l.length)) * 16), lane.ink, r), "doodle");
    if (p.priority === 1) DOODLE.star(x0 + W - 12, tStart + 12, lane.ink).forEach((s) => put(s, "doodle"));
    y = Math.max(y + 12, tStart + 56);
    text("tag", `${lane.label}${p.client ? " · " + p.client : ""} · P${p.priority}`, 16, lane.ink);
    if (p.demo) put({ ...scrawl(x0 + W - 120, pos.y - 14, "DEMO\n(fake data)", 18, INK.orange), id: `m:${p.id}:demo`, angle: 0.12 }, "demo");

    head("h-goal", "goal:", INK.blue); text("goal", p.goal || "(not set)", 19, p.goal ? INK.black : INK.faded, {}, 14);
    head("h-now", "NOW ⟶", INK.black); text("now", p.currentStep || "(not set)", 22, p.currentStep ? INK.black : INK.faded, {}, 14);

    head("h-agents", "who's on it:", INK.blue);
    if (!p.agents.length) text("ag-none", "nobody assigned", 17, INK.faded, {}, 14);
    p.agents.forEach((a, k) => {
      const v = statusView(a.status, now);
      const ai = /claude|codex|gpt|agent|bot/i.test(a.name);
      (ai ? DOODLE.robot : DOODLE.person)(x0 + 10, y + 4, TONE[v.tone]).forEach((s) => put(s, "doodle"));
      text(`ag${k}`, `${a.name}: ${a.owns || "?"}`, 18, INK.black, {}, 40);
      text(`ags${k}`, `${v.tone === "live" ? "● " : v.tone === "unknown" ? "? " : "○ "}${v.label}${v.detail ? " · " + v.detail : ""}`, 15, TONE[v.tone], {}, 40);
    });
    if (p.blockers.length) {
      y += 8; DOODLE.wall(x0, y).forEach((s) => put(s, "doodle"));
      const yy = y; text("h-blk", "STUCK ON:", 18, INK.red, {}, 44); y = Math.max(y, yy + 28);
      p.blockers.slice(0, 4).forEach((b, k) => text(`blk${k}`, "✕ " + b.text, 17, INK.red, {}, 14));
    }
    if (p.next.length) { head("h-next", "next:", INK.black); p.next.slice(0, 4).forEach((b, k) => text(`nx${k}`, "☐ " + b.text, 17, INK.black, {}, 14)); if (p.next.length > 4) text("nx-more", `+${p.next.length - 4} more`, 15, INK.faded, {}, 14); }
    if (p.done.length) { head("h-done", `done (${p.done.length}):`, INK.green); p.done.slice(-3).forEach((b, k) => text(`dn${k}`, "✓ " + b.text, 16, INK.green, {}, 14)); }
    if (p.links.length) y += 10; // room for the link icon
    p.links.slice(0, 4).forEach((l, k) => text(`ln${k}`, "↗ " + l.text, 17, INK.blue, { link: l.url }, 14));
    if (p.conflicts.length) text("cf", `⚠ ${p.conflicts.length} conflicting edit(s) kept: tap to review`, 15, INK.orange);
    text("foot", `last update ${ago(p.updatedAt, now)} by ${p.updatedBy}`, 14, INK.faded);
    const h = y - pos.y + 14;

    // Cluster outline: an invisible box (anchor for arrows and dragging) plus a loose, wobbly
    // marker loop drawn around the writing, the way you'd circle a group of notes on a whiteboard.
    sk.splice(sk.findIndex((s) => meta.get(s.id)?.pid === p.id), 0, { id: `m:${p.id}:card`, type: "rectangle", x: pos.x, y: pos.y, width: W + 40, height: h,
      strokeColor: "transparent", backgroundColor: "transparent", strokeWidth: 1, roughness: 0, opacity: 0, groupIds: g });
    {
      const cx = W / 2 + 20, cy = h / 2, rx = W / 2 + 34, ry = h / 2 + 22, pts = [];
      const start = r() * Math.PI * 2, n = 22;
      for (let k = 0; k <= n + 1; k++) { // runs slightly past the start, like a real pen stroke
        const a = start + (k / n) * Math.PI * 2, j = 1 + (r() - 0.5) * 0.05;
        const sx = Math.cos(a), sy = Math.sin(a);
        const px = Math.sign(sx) * Math.pow(Math.abs(sx), 0.55) * rx * j, py = Math.sign(sy) * Math.pow(Math.abs(sy), 0.55) * ry * j; // squarish ellipse
        pts.push([Math.round(cx + px), Math.round(cy + py)]);
      }
      put({ ...line(pos.x, pos.y, pts.map(([a, b]) => [a - pts[0][0], b - pts[0][1]]), lane.ink, lane.ring, { roughness: 1, strokeStyle: p.revenue === "internal" ? "dashed" : "solid" }), x: pos.x + pts[0][0], y: pos.y + pts[0][1], id: `m:${p.id}:loop` }, "loop");
    }
    meta.set(`m:${p.id}:card`, { managed: true, pid: p.id, role: "card" });

    // Decisions: written beside the cluster in red, boxed, with a stick figure "you?"
    if (p.decisions.length) {
      const dx = pos.x + W + 64, dy = pos.y + 40;
      DOODLE.you(dx, dy).forEach((s) => put(s, "doodle"));
      let yy = dy + 72;
      put({ ...scrawl(dx, yy, "MAX, DECIDE:", 20, INK.red), id: `m:${p.id}:dec-h` }, "dec");
      yy += 28;
      p.decisions.slice(0, 3).forEach((d, k) => {
        const ls = wrap("→ " + d.text, 17, 230);
        put({ ...scrawl(dx + 4, yy, ls.join("\n"), 17, INK.red), id: `m:${p.id}:dec${k}` }, "dec");
        yy += ls.length * 17 * LH + 6;
      });
      put({ id: `m:${p.id}:dec`, type: "rectangle", x: dx - 12, y: dy + 64, width: 262, height: yy - dy - 56, strokeColor: INK.red, backgroundColor: "transparent", strokeWidth: 2, roughness: 2, angle: -0.03 }, "dec");
    }

    // Web: hub → project (thick marker for paid), plus dashed lines between related projects
    geom[p.id] = { x: pos.x, y: pos.y, w: W + 40, h };
    const [s0, e0] = segment({ cx: 0, cy: 0, rx: 260, ry: 125, ellipse: true }, rectOf(geom[p.id]));
    add({ id: `m:${p.id}:hub`, type: "arrow", x: s0[0], y: s0[1], points: [[0, 0], [e0[0] - s0[0], e0[1] - s0[1]]], strokeColor: lane.ink, strokeWidth: p.revenue === "paid" ? 4 : 2, roughness: 2, strokeStyle: p.revenue === "internal" ? "dashed" : "solid",
      start: { id: "m:hq" }, end: { id: `m:${p.id}:card` } }, p.id, "hub");
  }));
  for (const p of projects) for (const r of p.related || []) {
    if (!board.projects[r] || r === p.id) continue;
    const [s0, e0] = segment(rectOf(geom[p.id]), rectOf(geom[r]));
    add({ id: `m:rel:${p.id}:${r}`, type: "arrow", x: s0[0], y: s0[1], points: [[0, 0], [e0[0] - s0[0], e0[1] - s0[1]]], strokeColor: INK.purple, strokeStyle: "dashed", strokeWidth: 2, roughness: 2, endArrowhead: null,
      start: { id: `m:${p.id}:card` }, end: { id: `m:${r}:card` }, label: { text: "depends on", fontSize: 16, fontFamily: FONT, strokeColor: INK.purple } }, p.id, "rel");
  }

  const els = convertToExcalidrawElements(sk, { regenerateIds: false });
  const byId = new Map(els.map((e) => [e.id, e]));
  for (const el of els) {
    if (el.containerId && byId.get(el.containerId)) el.groupIds = [...byId.get(el.containerId).groupIds];
    const m = meta.get(el.id) || (el.containerId && meta.get(el.containerId)) || { managed: true, pid: "_", role: "label" };
    el.customData = m;
  }
  return { elements: els, positions };
}
