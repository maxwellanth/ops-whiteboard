// Turns structured project data into dry-erase whiteboard writing: big sparse marker headings,
// thick wobbly loops and arrows, and a few doodles. Only the essentials are written on the board
// (name, what's happening now, what's stuck, what needs Max, who's on it). Everything else lives in
// the details sheet you open by tapping a project.
// These "managed" elements are rebuilt from board.json and never saved, so an assistant's update
// can't clobber your drawings and your drawings can't corrupt the data.
import { convertToExcalidrawElements, FONT_FAMILY } from "@excalidraw/excalidraw";
import { sortedProjects, statusView } from "./model.js";

const FONT = FONT_FAMILY.Excalifont;
const LH = 1.25; // Excalifont line height
const CW = 760; // width of a project's writing area (scene units)
export const CARD_PAD = 20; // the invisible anchor box starts this far outside the writing
// Type scale: big enough to read like a real classroom board at ~40% zoom on a phone
const T = { title: 64, now: 40, note: 36, who: 32, tag: 30 };
const INK = { black: "#1e1e1e", blue: "#1c4fa1", green: "#237a3b", red: "#c92a2a", orange: "#d9480f", purple: "#6741d9", faded: "#868e96" };
const LANE = {
  paid: { ink: INK.green, label: "$ paid", ring: 6 },
  pipeline: { ink: INK.blue, label: "pipeline", ring: 4 },
  internal: { ink: INK.faded, label: "side project", ring: 4 },
};

export const isManaged = (el) => !!el?.customData?.managed;

function wrap(text, fontSize, width, maxLines = 99) {
  const max = Math.max(6, Math.floor(width / (fontSize * 0.5)));
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((line + " " + word).trim().length > max) { if (line) out.push(line); line = word.length > max ? word.slice(0, max - 1) + "…" : word; }
      else line = (line + " " + word).trim();
    }
    out.push(line);
  }
  if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] = out[maxLines - 1].replace(/\s*\S{0,3}$/, "") + " …"; }
  return out;
}

// Deterministic wobble: hand-drawn but stable between renders.
function rng(seedStr) {
  let h = 2166136261;
  for (const c of seedStr) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

/** Default spot for a project with no saved position: paid work on the inner ring, everything else further out. */
function defaultPos(i, n, ring) {
  const r = ring === 0 ? 1350 : 2200;
  const a = -Math.PI / 2 + (2 * Math.PI * (i + (ring ? 0.5 : 0))) / Math.max(n, 1);
  return { x: Math.round(Math.cos(a) * r - CW / 2), y: Math.round(Math.sin(a) * r - 220) };
}

const rectOf = (g) => ({ cx: g.x + g.w / 2, cy: g.y + g.h / 2, rx: g.w / 2, ry: g.h / 2 });
function edge(sh, dx, dy, gap) {
  const len = Math.hypot(dx, dy) || 1;
  const t = sh.ellipse ? 1 / Math.sqrt((dx / sh.rx) ** 2 + (dy / sh.ry) ** 2) : Math.min(sh.rx / Math.abs(dx || 1e-9), sh.ry / Math.abs(dy || 1e-9));
  return [sh.cx + dx * t + (dx / len) * gap, sh.cy + dy * t + (dy / len) * gap];
}
function segment(a, b) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  return [edge(a, dx, dy, 30), edge(b, -dx, -dy, 30)];
}

// ---------- marker primitives ----------
const line = (x, y, pts, color, w = 4, extra = {}) => ({ type: "line", x, y, points: pts, strokeColor: color, strokeWidth: w, roughness: 2, ...extra });
const circle = (x, y, wd, ht, color, w = 4, extra = {}) => ({ type: "ellipse", x, y, width: wd, height: ht, strokeColor: color, backgroundColor: "transparent", strokeWidth: w, roughness: 2, ...extra });
const scrawl = (x, y, text, size, color, extra = {}) => ({ type: "text", x, y, text, fontSize: size, fontFamily: FONT, strokeColor: color, ...extra });

/** A loose freehand loop around a region, overshooting its start like a real pen stroke. */
function loop(x, y, w, h, color, width, r, extra = {}) {
  const cx = w / 2, cy = h / 2, rx = w / 2 + 26, ry = h / 2 + 28, pts = [];
  const start = r() * Math.PI * 2, n = 26;
  for (let k = 0; k <= n + 2; k++) {
    const a = start + (k / n) * Math.PI * 2, j = 1 + (r() - 0.5) * 0.06;
    const sx = Math.cos(a), sy = Math.sin(a);
    pts.push([cx + Math.sign(sx) * Math.pow(Math.abs(sx), 0.5) * rx * j, cy + Math.sign(sy) * Math.pow(Math.abs(sy), 0.5) * ry * j]);
  }
  const [ox, oy] = pts[0];
  return line(x + ox, y + oy, pts.map(([a, b]) => [Math.round(a - ox), Math.round(b - oy)]), color, width, { roughness: 2, ...extra });
}

/** A hand-drawn arrow with a slight bow, thick marker. */
function bowArrow(s0, e0, color, width, r, extra = {}) {
  const dx = e0[0] - s0[0], dy = e0[1] - s0[1], len = Math.hypot(dx, dy) || 1;
  const bow = (r() - 0.5) * 0.18 * len;
  return { type: "arrow", x: s0[0], y: s0[1], points: [[0, 0], [dx / 2 - (dy / len) * bow, dy / 2 + (dx / len) * bow], [dx, dy]], roundness: { type: 2 }, strokeColor: color, strokeWidth: width, roughness: 2, ...extra };
}

// Doodles drawn at a base size and scaled up, so they read at a distance.
const DOODLE = {
  paid: (c) => [circle(0, 0, 46, 46, c, 3), scrawl(13, 5, "$", 30, c)],
  pipeline: (c) => [circle(6, 0, 32, 32, c, 3), line(14, 32, [[0, 0], [16, 0]], c, 3), line(15, 38, [[0, 0], [14, 0]], c, 3), line(-4, 2, [[0, 0], [-8, -6]], c, 2), line(48, 2, [[0, 0], [8, -6]], c, 2)],
  internal: (c) => [circle(8, 8, 30, 30, c, 3), ...[0, 1, 2, 3, 4, 5].map((k) => { const a = (k * Math.PI) / 3; return line(23 + Math.cos(a) * 15, 23 + Math.sin(a) * 15, [[0, 0], [Math.cos(a) * 7, Math.sin(a) * 7]], c, 3); })],
  robot: (c) => [line(0, 6, [[0, 0], [20, 0], [20, 16], [0, 16], [0, 0]], c, 3), line(10, 6, [[0, 0], [0, -6]], c, 2), circle(8, -4, 4, 4, c, 2), line(5, 11, [[0, 0], [2, 0]], c, 3), line(13, 11, [[0, 0], [2, 0]], c, 3)],
  person: (c) => [circle(4, 0, 12, 12, c, 3), line(10, 12, [[0, 0], [0, 10]], c, 3), line(2, 15, [[0, 0], [16, 0]], c, 2)],
  wall: (c) => [line(0, 0, [[0, 0], [34, 0], [34, 24], [0, 24], [0, 0]], c, 3), line(0, 12, [[0, 0], [34, 0]], c, 2), line(12, 0, [[0, 0], [0, 12]], c, 2), line(24, 12, [[0, 0], [0, 12]], c, 2)],
  you: (c) => [circle(8, 0, 18, 18, c, 3), line(17, 18, [[0, 0], [0, 22]], c, 3), line(6, 25, [[0, 0], [22, -4]], c, 3), line(17, 40, [[0, 0], [-9, 14]], c, 3), line(17, 40, [[0, 0], [9, 14]], c, 3)],
  star: (c) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const a = (k * Math.PI) / 4; return line(Math.cos(a) * 6, Math.sin(a) * 6, [[0, 0], [Math.cos(a) * (k % 2 ? 7 : 13), Math.sin(a) * (k % 2 ? 7 : 13)]], c, 3); }),
};
function doodle(kind, color, x, y, k) {
  return DOODLE[kind](color).map((s) => ({
    ...s, x: x + s.x * k, y: y + s.y * k,
    ...(s.width ? { width: s.width * k, height: s.height * k } : {}),
    ...(s.points ? { points: s.points.map(([a, b]) => [a * k, b * k]) } : {}),
    ...(s.fontSize ? { fontSize: s.fontSize * k } : {}),
    strokeWidth: Math.max(3, Math.round((s.strokeWidth || 2) * k * 0.55)),
  }));
}
const underline = (x, y, w, c, r, width = 5) => line(x, y, [[0, 0], [w * 0.3, 3 + r() * 5], [w * 0.65, -2 - r() * 4], [w, 3]], c, width);

/** Builds every managed element. Returns { elements, positions }. */
export function buildManaged(board, now = Date.now()) {
  const sk = [];
  const meta = new Map();
  let auto = 0;
  const add = (s, pid, role) => { if (!s.id) s.id = `m:${pid}:z${auto++}`; sk.push(s); meta.set(s.id, { managed: true, pid, role }); return s; };
  const projects = sortedProjects(board);
  const paid = projects.filter((p) => p.revenue === "paid");
  const rest = projects.filter((p) => p.revenue !== "paid");

  // ---- the hub: "THE OPERATION", big and circled ----
  const decisions = projects.reduce((n, p) => n + p.decisions.length, 0);
  const blockers = projects.reduce((n, p) => n + p.blockers.length, 0);
  const hr = rng("hq");
  add(circle(-470, -230, 940, 460, INK.black, 5, { id: "m:hq" }), "_hq", "hq");
  add(scrawl(-330, -150, "THE OPERATION", 80, INK.black, { id: "m:hq:t" }), "_hq", "hq");
  add(underline(-320, -40, 620, INK.black, hr, 6), "_hq", "hq");
  add(scrawl(-300, -10, decisions ? `${decisions} thing${decisions > 1 ? "s" : ""} need you` : "nothing needs you", 44, decisions ? INK.red : INK.faded, { id: "m:hq:d" }), "_hq", "hq");
  add(scrawl(-300, 54, blockers ? `${blockers} stuck` : "nothing stuck", 44, blockers ? INK.red : INK.faded, { id: "m:hq:b" }), "_hq", "hq");

  const positions = {};
  const geom = {};
  [paid, rest].forEach((group, ring) => group.forEach((p, i) => {
    const pos = p.pos || defaultPos(i, group.length, ring);
    positions[p.id] = pos;
    const lane = LANE[p.revenue] || LANE.internal;
    const r = rng(p.id);
    const g = [`g:${p.id}`];
    const put = (s, role) => add({ ...s, groupIds: g }, p.id, role);
    const tilt = () => (r() - 0.5) * 0.03;
    let y = pos.y;
    const write = (id, str, size, color, indent = 0, maxLines = 2) => {
      const ls = wrap(str, size, CW - indent, maxLines);
      put({ ...scrawl(pos.x + indent, y, ls.join("\n"), size, color), id: `m:${p.id}:${id}`, angle: tilt() }, id);
      y += ls.length * size * LH + 18;
    };

    // Heading: doodle + big title + wobbly underline (+ star for top priority)
    const titleInk = lane.ink === INK.faded ? INK.black : lane.ink;
    doodle(p.revenue in DOODLE ? p.revenue : "internal", lane.ink, pos.x, y + 6, 1.6).forEach((s) => put(s, "doodle"));
    const tl = wrap(p.name.replace(/^DEMO · /, ""), T.title, CW - 100, 2);
    put({ ...scrawl(pos.x + 96, y, tl.join("\n"), T.title, titleInk), id: `m:${p.id}:title`, angle: tilt() }, "title");
    y += tl.length * T.title * LH;
    put(underline(pos.x + 92, y + 2, Math.min(CW - 100, Math.max(...tl.map((l) => l.length)) * T.title * 0.48), lane.ink, r), "doodle");
    if (p.priority === 1) doodle("star", lane.ink, pos.x + CW - 30, pos.y - 40, 2).forEach((s) => put(s, "doodle"));
    if (p.demo) put({ ...scrawl(pos.x + CW - 140, pos.y - 70, "DEMO", T.tag, INK.orange), id: `m:${p.id}:demo`, angle: 0.14 }, "demo");
    y += 34;

    // Now: the one thing happening
    write("now", "now: " + (p.currentStep || "?"), T.now, p.currentStep ? INK.black : INK.faded, 0, 2);
    // Stuck: first roadblock only
    if (p.blockers.length) {
      doodle("wall", INK.red, pos.x, y + 8, 1.3).forEach((s) => put(s, "doodle"));
      write("stuck", "stuck: " + p.blockers[0].text + (p.blockers.length > 1 ? ` (+${p.blockers.length - 1})` : ""), T.note, INK.red, 64, 2);
    }
    // Needs Max: first decision only
    if (p.decisions.length) {
      doodle("you", INK.orange, pos.x + 6, y - 4, 1.1).forEach((s) => put(s, "doodle"));
      write("dec", "you decide: " + p.decisions[0].text + (p.decisions.length > 1 ? ` (+${p.decisions.length - 1})` : ""), T.note, INK.orange, 64, 2);
    }
    // Who's on it: names only, plus LIVE only when there is fresh evidence
    if (p.agents.length) {
      let x = pos.x;
      const yy = y;
      p.agents.slice(0, 3).forEach((a, k) => {
        const v = statusView(a.status, now);
        const live = v.tone === "live";
        doodle(/claude|codex|gpt|agent|bot/i.test(a.name) ? "robot" : "person", live ? INK.green : INK.blue, x, yy + 6, 1.6).forEach((s) => put(s, "doodle"));
        const label = a.name + (live ? " ● LIVE" : "");
        put({ ...scrawl(x + 46, yy, label, T.who, live ? INK.green : INK.blue), id: `m:${p.id}:ag${k}` }, "who");
        x += 46 + label.length * T.who * 0.52 + 40;
      });
      y = yy + T.who * LH + 18;
    } else write("who", "nobody on it", T.who, INK.faded);
    if (p.conflicts.length) write("cf", "⚠ check edits", 30, INK.orange);
    const h = y - pos.y;

    // Invisible anchor box (for arrows, dragging and taps) + the visible thick freehand loop
    sk.splice(sk.findIndex((s) => meta.get(s.id)?.pid === p.id), 0, { id: `m:${p.id}:card`, type: "rectangle", x: pos.x - CARD_PAD, y: pos.y - CARD_PAD, width: CW + 2 * CARD_PAD, height: h + CARD_PAD,
      strokeColor: "transparent", backgroundColor: "transparent", strokeWidth: 1, roughness: 0, opacity: 0, groupIds: g });
    meta.set(`m:${p.id}:card`, { managed: true, pid: p.id, role: "card" });
    put({ ...loop(pos.x - 20, pos.y - 20, CW + 40, h + 20, lane.ink, lane.ring, r, { strokeStyle: p.revenue === "internal" ? "dashed" : "solid" }), id: `m:${p.id}:loop` }, "loop");

    // Web: hub → project, thick marker for paid work
    geom[p.id] = { x: pos.x - 20, y: pos.y - 20, w: CW + 40, h: h + 20 };
    const [s0, e0] = segment({ cx: 0, cy: 0, rx: 470, ry: 230, ellipse: true }, { ...rectOf(geom[p.id]), rx: (CW + 40) / 2 + 40, ry: (h + 20) / 2 + 34 });
    add({ id: `m:${p.id}:hub`, ...bowArrow(s0, e0, lane.ink, p.revenue === "paid" ? 7 : 4, r, { strokeStyle: p.revenue === "internal" ? "dashed" : "solid", start: { id: "m:hq" }, end: { id: `m:${p.id}:card` } }) }, p.id, "hub");
  }));
  for (const p of projects) for (const rel of p.related || []) {
    if (!board.projects[rel] || rel === p.id) continue;
    const [s0, e0] = segment(rectOf(geom[p.id]), rectOf(geom[rel]));
    add({ id: `m:rel:${p.id}:${rel}`, ...bowArrow(s0, e0, INK.purple, 4, rng(p.id + rel), { strokeStyle: "dashed", endArrowhead: null, start: { id: `m:${p.id}:card` }, end: { id: `m:${rel}:card` } }) }, p.id, "rel");
  }

  const els = convertToExcalidrawElements(sk, { regenerateIds: false });
  const byId = new Map(els.map((e) => [e.id, e]));
  for (const el of els) {
    if (el.containerId && byId.get(el.containerId)) el.groupIds = [...byId.get(el.containerId).groupIds];
    el.customData = meta.get(el.id) || (el.containerId && meta.get(el.containerId)) || { managed: true, pid: "_", role: "label" };
  }
  return { elements: els, positions };
}
