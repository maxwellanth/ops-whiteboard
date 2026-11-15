import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyOp, mergeBoards, normalizeBoard, statusView, snapshotHtml, sortedProjects, LIVE_TTL_MS } from "../src/model.js";

const seed = () => normalizeBoard(JSON.parse(readFileSync(new URL("../seed/demo-board.json", import.meta.url), "utf8")));
const clone = (x) => JSON.parse(JSON.stringify(x));

test("paid client work sorts first", () => {
  const ids = sortedProjects(seed()).map((p) => p.revenue);
  assert.deepEqual(ids, ["paid", "paid", "pipeline", "internal"]);
});

test("LIVE needs evidence and expires after 10 minutes", () => {
  const b = seed();
  assert.throws(() => applyOp(b, { type: "agent", pid: "demo-acme-site", agent: "Codex", state: "live" }, "codex"), /evidence/);
  applyOp(b, { type: "agent", pid: "demo-acme-site", agent: "Codex", state: "live", evidence: "pid 123 running" }, "codex");
  const st = b.projects["demo-acme-site"].agents.find((a) => a.name === "Codex").status;
  assert.equal(statusView(st).tone, "live");
  assert.equal(statusView(st, Date.parse(st.checkedAt) + LIVE_TTL_MS + 1000).tone, "stale");
  assert.equal(statusView({ state: "unknown" }).tone, "unknown");
  assert.equal(statusView(undefined).tone, "unknown");
  assert.equal(statusView({ state: "live", checkedAt: new Date().toISOString() }).tone, "stale", "live without evidence is never shown as live");
});

test("concurrent additions from both sides both survive", () => {
  const base = seed();
  const mine = clone(base), theirs = clone(base);
  applyOp(mine, { type: "add", pid: "demo-acme-site", list: "next", text: "mine" }, "max");
  applyOp(theirs, { type: "add", pid: "demo-acme-site", list: "next", text: "theirs" }, "codex");
  const { board, conflicts } = mergeBoards(base, mine, theirs, "max");
  const texts = board.projects["demo-acme-site"].next.map((x) => x.text);
  assert.ok(texts.includes("mine") && texts.includes("theirs"));
  assert.equal(conflicts.length, 0);
});

test("same field edited on both sides: my edit wins, the other is kept as a conflict note", () => {
  const base = seed();
  const mine = clone(base), theirs = clone(base);
  applyOp(mine, { type: "set", pid: "demo-acme-site", field: "currentStep", value: "MAX STEP" }, "max");
  applyOp(theirs, { type: "set", pid: "demo-acme-site", field: "currentStep", value: "CODEX STEP" }, "codex");
  const { board, conflicts } = mergeBoards(base, mine, theirs, "max");
  const p = board.projects["demo-acme-site"];
  assert.equal(p.currentStep, "MAX STEP");
  assert.equal(conflicts.length, 1);
  assert.match(p.conflicts.at(-1).text, /CODEX STEP/);
});

test("different fields edited on both sides merge cleanly", () => {
  const base = seed();
  const mine = clone(base), theirs = clone(base);
  applyOp(mine, { type: "set", pid: "demo-acme-site", field: "goal", value: "new goal" }, "max");
  applyOp(theirs, { type: "agent", pid: "demo-acme-site", agent: "Codex", state: "reported", note: "tests written" }, "codex");
  const { board, conflicts } = mergeBoards(base, mine, theirs, "max");
  const p = board.projects["demo-acme-site"];
  assert.equal(p.goal, "new goal");
  assert.equal(p.agents.find((a) => a.name === "Codex").status.note, "tests written");
  assert.equal(conflicts.length, 0);
});

test("drawings merge per element by version; deletions are tombstones", () => {
  const base = seed();
  base.scene.elements = [{ id: "a", version: 1, versionNonce: 5 }, { id: "b", version: 1, versionNonce: 5 }];
  const mine = clone(base), theirs = clone(base);
  mine.scene.elements[0] = { id: "a", version: 2, versionNonce: 1, isDeleted: true };
  mine.scene.elements.push({ id: "c", version: 1, versionNonce: 1 });
  theirs.scene.elements[1] = { id: "b", version: 3, versionNonce: 1, x: 99 };
  const { board } = mergeBoards(base, mine, theirs);
  const m = Object.fromEntries(board.scene.elements.map((e) => [e.id, e]));
  assert.equal(m.a.isDeleted, true);
  assert.equal(m.b.x, 99);
  assert.ok(m.c);
});

test("a project deleted elsewhere but edited here is kept", () => {
  const base = seed();
  const mine = clone(base), theirs = clone(base);
  applyOp(mine, { type: "add", pid: "demo-pitch-deck", list: "done", text: "kept" }, "max");
  delete theirs.projects["demo-pitch-deck"];
  const { board } = mergeBoards(base, mine, theirs);
  assert.ok(board.projects["demo-pitch-deck"]);
});

test("snapshot is readable and escapes HTML", () => {
  const b = seed();
  applyOp(b, { type: "add", pid: "demo-acme-site", list: "next", text: "<script>x</script>" }, "max");
  applyOp(b, { type: "add", pid: "demo-acme-site", list: "link", text: "bad", url: "javascript:alert(1)" }, "max");
  const html = snapshotHtml(b);
  assert.ok(html.includes("DEMO DATA"));
  assert.ok(!html.includes("<script>x"));
  assert.ok(!html.includes("javascript:alert"));
  assert.ok(html.indexOf("Acme") < html.indexOf("Side game"), "paid work first");
});
