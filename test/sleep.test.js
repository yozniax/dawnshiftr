import assert from "node:assert/strict";
import { test } from "node:test";
import { FADE_MS, PT_MINUTES, fadeAmount, formatSleepRemain, isPomodoro, sleepChipLabel, sleepClock } from "../js/sleep.js";

test("sleep chip labels", () => {
  assert.equal(sleepChipLabel(180), "3h");
  assert.equal(sleepChipLabel(25), "PT");
  assert.equal(sleepChipLabel(10), "10");
});

test("pomodoro is 25 minutes and skips fade", () => {
  assert.equal(isPomodoro(25), true);
  assert.equal(isPomodoro(PT_MINUTES), true);
  assert.equal(isPomodoro(10), false);
  assert.equal(fadeAmount(1000, { skipFade: isPomodoro(25) }), 1);
  assert.equal(fadeAmount(1000, { skipFade: isPomodoro(10) }), 1000 / FADE_MS);
});

test("other sleeps fade in the last 15 seconds", () => {
  assert.equal(fadeAmount(null), 1);
  assert.equal(fadeAmount(FADE_MS), 1);
  assert.equal(fadeAmount(FADE_MS / 2), 0.5);
  assert.equal(fadeAmount(0), 0);
});

test("sleep clock copy", () => {
  assert.equal(sleepClock({}).text, "SLEEP IN");
  const pt = sleepClock({ sleepEndsAt: Date.now() + 60_000, sleepMinutes: 25, sleepRemainingMs: 61_000 });
  assert.match(pt.text, /^POMODORO ENDS AT 01:01$/);
  assert.equal(pt.fading, false);
  const sleep = sleepClock({ sleepEndsAt: Date.now() + 1000, sleepMinutes: 10, sleepRemainingMs: 1000 });
  assert.match(sleep.text, /^SLEEPING IN 00:01$/);
  assert.equal(sleep.fading, true);
});

test("format remain", () => {
  assert.equal(formatSleepRemain(0), "00:00");
  assert.equal(formatSleepRemain(125_000), "02:05");
});
