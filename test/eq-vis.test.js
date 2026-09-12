import assert from "node:assert/strict";
import { test } from "node:test";
import { motionLevels, punchLevels } from "../js/eq-vis.js";

test("punchLevels keeps a quiet spectrum off the ceiling", () => {
  const quiet = [0.08, 0.05, 0.04, 0.03, 0.02, 0.03, 0.04];
  const out = punchLevels(quiet, 7);
  assert.ok(out);
  const peak = Math.max(...out.levels);
  assert.ok(peak < 0.7, `peak ${peak}`);
  assert.ok(out.levels[0] > out.levels[4]);
});

test("punchLevels lets a matching peak hit the top", () => {
  const loud = [0.9, 0.5, 0.4, 0.3, 0.2, 0.25, 0.35];
  const out = punchLevels(loud, 7, 0.9);
  assert.ok(Math.max(...out.levels) >= 0.95);
  assert.ok(out.levels[0] > out.levels[4]);
});

test("punchLevels drops when the frame is quieter than the recent peak", () => {
  const loud = punchLevels([0.8, 0.6, 0.5, 0.4, 0.3, 0.35, 0.45], 7);
  const quiet = punchLevels([0.12, 0.08, 0.07, 0.05, 0.04, 0.05, 0.06], 7, loud.peakRef);
  assert.ok(Math.max(...quiet.levels) < 0.35);
});

test("punchLevels leaves empty bins quiet instead of inventing motion", () => {
  assert.equal(punchLevels([0, 0, 0, 0, 0, 0, 0], 7), null);
});

test("motionLevels spans a wide vertical range", () => {
  let lo = 1;
  let hi = 0;
  for (let t = 0; t < 8; t += 0.05) {
    for (const v of motionLevels(t, 7)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  assert.ok(hi - lo > 0.7, `range ${hi - lo}`);
  assert.ok(hi > 0.85, `high ${hi}`);
  assert.ok(lo < 0.12, `low ${lo}`);
});
