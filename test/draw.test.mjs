import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOp, emptyBoard, normalizeBoard, makeStroke, markSummary, mergeBoards } from "../src/model.js";

test("an agent's strokes become editable freedraw elements at the right board position, tagged with the author", () => {
  const b = normalizeBoard(emptyBoard());
  applyOp(b, { type: "draw", at: [100, 200], strokes: [[[0, 0], [60, 0]], { points: [[0, 20], [30, 50], [60, 20]], color: "red" }] }, "claude");
  assert.equal(b.scene.elements.length, 2);
  const [a, c] = b.scene.elements;
  assert.equal(a.type, "freedraw");
  assert.equal(a.x, 100); assert.equal(a.y, 200);
  assert.ok(a.points.length > 5, "densified like a continuous marker stroke");
  assert.equal(a.customData.drawnBy, "claude");
  assert.equal(c.strokeColor, "#c92a2a");
  assert.deepEqual(markSummary(b).by, { claude: 2 });
});

test("agents can erase only their own strokes", () => {
  const b = normalizeBoard(emptyBoard());
  b.scene.elements.push({ ...makeStroke([[0, 0], [10, 10]]), customData: undefined }); // Max's pen stroke
  applyOp(b, { type: "draw", at: [0, 0], strokes: [[[0, 0], [5, 5]]] }, "codex");
  const maxId = b.scene.elements[0].id, codexId = b.scene.elements[1].id;
  assert.throws(() => applyOp(b, { type: "erase", ids: [maxId] }, "codex"), /only its author/);
  applyOp(b, { type: "erase", ids: [codexId] }, "codex");
  assert.equal(b.scene.elements[1].isDeleted, true);
  assert.equal(b.scene.elements[0].isDeleted, false);
});

test("strokes drawn at the same time by an agent and on the phone both survive a merge", () => {
  const base = normalizeBoard(emptyBoard());
  const phone = structuredClone(base), agent = structuredClone(base);
  phone.scene.elements.push(makeStroke([[0, 0], [9, 9]]));
  applyOp(agent, { type: "draw", at: [50, 50], strokes: [[[0, 0], [20, 0]]] }, "claude");
  const { board } = mergeBoards(base, phone, agent);
  assert.equal(board.scene.elements.length, 2);
});

test("agent strokes get increasing order indices after existing marks", () => {
  const b = normalizeBoard(emptyBoard());
  b.scene.elements.push({ ...makeStroke([[0, 0], [10, 10]]), index: "b0M", customData: undefined });
  applyOp(b, { type: "draw", at: [0, 0], strokes: [[[0, 0], [5, 5]], [[0, 0], [6, 6]], [[0, 0], [7, 7]]] }, "claude");
  const keys = b.scene.elements.map((e) => e.index);
  assert.deepEqual([...keys].sort(), keys, "indices increase in array order");
  assert.ok(keys.every((k) => !k.endsWith("0")));
});
