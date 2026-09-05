import assert from "node:assert/strict";
import { test } from "node:test";
import { motionLevels, punchLevels } from "../js/eq-vis.js";

test("punchLevels scales a quiet spectrum up to a tall peak", () => {
  const quiet = [0.08, 0.05, 0.04, 0.03, 0.02, 0.03, 0.04];
  const out = punchLevels(quiet, 7);
  assert.ok(out);
  const peak = Math.max(...out);
  assert.ok(peak >= 0.9, `peak ${peak}`);
  assert.ok(out[0] > out[4]);
});

test("punchLevels leaves empty bins for motion fallback", () => {
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
});
