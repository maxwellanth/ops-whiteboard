// Turns structured project data into dry-erase whiteboard writing: marker text, quick doodles,
// loose circled clusters and a web of arrows. These "managed" elements are rebuilt from the data
// and never saved, so an assistant's update can't clobber your drawings and your drawings
// can't corrupt the data. This is only a visual layer: every word comes from board.json and statusView().
import { convertToExcalidrawElements, FONT_FAMILY } from "@excalidraw/excalidraw";
import { sortedProjects, statusView, ago } from "./model.js";

const FONT = FONT_FAMILY.Excalifont;
const LH = 1.25; // Excalifont line height
const W = 420; // used for default spacing
const CW = 360; // core card width
const SW = 190, SH = 88; // sticky note size
const NOTE = { next: { fill: "#fff3a6", edge: "#e8c84a" }, decision: { fill: "#ffd8a8", edge: "#f08c00" }, blocker: { fill: "#ffc9c9", edge: "#f08080" } };
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
  const r = ring === 0 ? 1050 : 1750;
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
    const tilt = () => (r() - 0.5) * 0.025;
    const x0 = pos.x + 20;
    let y = pos.y + 16;
    const text = (id, str, fontSize, color = INK.black, extra = {}, indent = 0, maxLines = 99) => {
      let lines = wrap(str, fontSize, CW - 40 - indent);
      if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, "…"); }
      put({ ...scrawl(x0 + indent, y, lines.join("\n"), fontSize, color, extra), id: `m:${p.id}:${id}`, angle: tilt() }, id);
      y += lines.length * fontSize * LH + 4;
    };

    // ---------- core card: what it is, what's happening now, who owns it ----------
    text("tag", `${lane.label}${p.client ? " · " + p.client : ""} · P${p.priority}`, 15, lane.ink);
    DOODLE[p.revenue]?.(x0, y + 2).forEach((s) => put(s, "doodle"));
    const tStart = y;
    const tl = wrap(p.name.replace(/^DEMO · /, ""), 28, CW - 100);
    put({ ...scrawl(x0 + 58, y + 4, tl.join("\n"), 28, lane.ink === INK.faded ? INK.black : lane.ink), id: `m:${p.id}:title`, angle: tilt() }, "title");
    y += 4 + tl.length * 28 * LH;
    put(DOODLE.underline(x0 + 56, y + 2, Math.min(CW - 90, Math.max(...tl.map((l) => l.length)) * 14), lane.ink, r), "doodle");
    if (p.priority === 1) DOODLE.star(pos.x + CW - 22, tStart + 18, lane.ink).forEach((s) => put(s, "doodle"));
    y = Math.max(y + 14, tStart + 58);
    if (p.demo) put({ ...scrawl(pos.x + CW - 100, pos.y - 34, "DEMO\n(fake data)", 17, INK.orange), id: `m:${p.id}:demo`, angle: 0.12 }, "demo");

    // Status, ClickUp-style but in marker: a boxed NOW line that's readable at a glance
    const nowLines = wrap("NOW: " + (p.currentStep || "(not set)"), 19, CW - 70);
    const nowH = nowLines.length * 19 * LH + 18;
    put({ id: `m:${p.id}:nowbox`, type: "rectangle", x: x0 - 4, y, width: CW - 32, height: nowH, strokeColor: lane.ink, backgroundColor: "transparent", strokeWidth: 2, roughness: 2, angle: tilt() }, "now");
    put({ ...scrawl(x0 + 8, y + 9, nowLines.join("\n"), 19, p.currentStep ? INK.black : INK.faded), id: `m:${p.id}:now` }, "now");
    y += nowH + 10;
    text("goal", "goal: " + (p.goal || "(not set)"), 15, p.goal ? INK.blue : INK.faded, {}, 0, 2);

    y += 4;
    if (!p.agents.length) text("ag-none", "nobody assigned", 16, INK.faded);
    p.agents.forEach((a, k) => {
      const v = statusView(a.status, now);
      const ai = /claude|codex|gpt|agent|bot/i.test(a.name);
      (ai ? DOODLE.robot : DOODLE.person)(x0 + 2, y + 6, TONE[v.tone]).forEach((s) => put(s, "doodle"));
      text(`ag${k}`, `${a.name}: ${a.owns || "?"}`, 16, INK.black, {}, 32, 2);
      text(`ags${k}`, `${v.tone === "live" ? "● " : v.tone === "unknown" ? "? " : "○ "}${v.label}`, 13, TONE[v.tone], {}, 32, 1);
    });
    if (p.conflicts.length) text("cf", `⚠ ${p.conflicts.length} conflicting edit(s) kept`, 14, INK.orange);
    text("foot", `updated ${ago(p.updatedAt, now)} by ${p.updatedBy}`, 13, INK.faded);
    const h = y - pos.y + 10;
    // The card goes first so it sits beneath its writing. Marker outline only, no fill: it's a whiteboard.
    sk.splice(sk.findIndex((s) => meta.get(s.id)?.pid === p.id), 0, { id: `m:${p.id}:card`, type: "rectangle", x: pos.x, y: pos.y, width: CW, height: h,
      strokeColor: lane.ink, backgroundColor: "transparent", strokeWidth: lane.ring, roughness: 2, roundness: { type: 3 }, strokeStyle: p.revenue === "internal" ? "dashed" : "solid", groupIds: g, angle: (r() - 0.5) * 0.01 });
    meta.set(`m:${p.id}:card`, { managed: true, pid: p.id, role: "card" });

    // ---------- islands of sticky notes around the card (Miro-style spatial grouping) ----------
    const sticky = (id, str, color, sx, sy, role) => {
      let ls = wrap(str, 16, SW - 22);
      if (ls.length > 3) { ls = ls.slice(0, 3); ls[2] = ls[2].replace(/.{0,2}$/, "…"); }
      put({ id: `m:${p.id}:${id}`, type: "rectangle", x: sx, y: sy, width: SW, height: SH, angle: (r() - 0.5) * 0.08, strokeColor: color.edge, backgroundColor: color.fill, fillStyle: "solid", strokeWidth: 1, roughness: 1,
        label: { text: ls.join("\n"), fontSize: 16, fontFamily: FONT, strokeColor: INK.black } }, role);
    };
    const link = (fromY, toX, toY, color) => { // marker arrow from the card's right edge to an island
      const sx = pos.x + CW + 6, sy = Math.min(pos.y + h - 10, Math.max(pos.y + 10, fromY));
      add({ type: "arrow", x: sx, y: sy, points: [[0, 0], [(toX - sx) * 0.5, (toY - sy) * 0.35 - 8], [toX - sx, toY - sy]], roundness: { type: 2 }, strokeColor: color, strokeWidth: 2, roughness: 2, groupIds: g,
        start: { id: `m:${p.id}:card` } }, p.id, "isl");
    };
    const colX = pos.x + CW + 90;
    let colY = pos.y - 6;
    if (p.decisions.length) {
      DOODLE.you(colX, colY + 6).forEach((s) => put(s, "doodle"));
      put({ ...scrawl(colX + 56, colY + 16, "MAX, DECIDE", 21, INK.red), id: `m:${p.id}:dec-h` }, "dec");
      link(pos.y + 40, colX - 10, colY + 30, INK.red);
      colY += 70;
      p.decisions.slice(0, 3).forEach((d, k) => { sticky(`dec${k}`, "? " + d.text, NOTE.decision, colX + (k % 2) * 16, colY, "dec"); colY += SH + 12; });
      colY += 14;
    }
    if (p.next.length) {
      put({ ...scrawl(colX, colY, `next (${p.next.length})`, 20, INK.black), id: `m:${p.id}:nx-h` }, "next");
      link(colY + 12, colX - 10, colY + 12, INK.black);
      colY += 32;
      p.next.slice(0, 3).forEach((n, k) => { sticky(`nx${k}`, n.text, NOTE.next, colX + ((k + 1) % 2) * 14, colY, "next"); colY += SH + 12; });
      if (p.next.length > 3) put({ ...scrawl(colX, colY, `+${p.next.length - 3} more`, 15, INK.faded), id: `m:${p.id}:nx-more` }, "next");
    }
    // Under the card: roadblocks (pink notes behind a brick wall), then done ticks and links
    let by = pos.y + h + 30;
    if (p.blockers.length) {
      DOODLE.wall(pos.x + 6, by).forEach((s) => put(s, "doodle"));
      put({ ...scrawl(pos.x + 50, by, "STUCK ON", 20, INK.red), id: `m:${p.id}:blk-h` }, "blk");
      by += 34;
      p.blockers.slice(0, 2).forEach((b, k) => sticky(`blk${k}`, "✕ " + b.text, NOTE.blocker, pos.x + k * (SW + 14), by, "blk"));
      by += SH + 22;
    }
    if (p.done.length) {
      put({ ...scrawl(pos.x + 6, by, `done (${p.done.length}):`, 17, INK.green), id: `m:${p.id}:dn-h` }, "done");
      by += 24;
      p.done.slice(-3).forEach((d, k) => { const ls = wrap("✓ " + d.text, 15, CW + 120).slice(0, 1); put({ ...scrawl(pos.x + 16, by, ls.join(""), 15, INK.green), id: `m:${p.id}:dn${k}` }, "done"); by += 22; });
    }
    p.links.slice(0, 2).forEach((l, k) => { by += k ? 2 : 10; put({ ...scrawl(pos.x + 16, by, "↗ " + wrap(l.text, 16, CW).slice(0, 1).join(""), 16, INK.blue, { link: l.url }), id: `m:${p.id}:ln${k}` }, "link"); by += 26; });

    // Web: hub → project (thick marker for paid), plus dashed lines between related projects
    geom[p.id] = { x: pos.x, y: pos.y, w: CW, h };
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
