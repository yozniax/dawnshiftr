import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyAmbientAudioSession, freqBytesToBands } from "../js/audio-engine.js";

function tone(hz, { n = 1024, sampleRate = 44100, amp = 220 } = {}) {
  const freq = new Uint8Array(n);
  const nyquist = sampleRate / 2;
  const i = Math.min(n - 1, Math.max(0, Math.round((hz / nyquist) * n)));
  freq[i] = amp;
  if (i + 1 < n) freq[i + 1] = Math.round(amp * 0.4);
  return freq;
}

test("freqBytesToBands puts bass energy in the left bars", () => {
  const bands = freqBytesToBands(tone(70), 7, 44100);
  const bass = Math.max(bands[0], bands[1]);
  const treble = Math.max(bands[5], bands[6]);
  assert.ok(bass > 0.5, `bass ${bass}`);
  assert.ok(treble < 0.05, `treble ${treble}`);
});

test("freqBytesToBands puts treble energy in the right bars", () => {
  const bands = freqBytesToBands(tone(9000), 7, 44100);
  const bass = Math.max(bands[0], bands[1]);
  const treble = Math.max(bands[5], bands[6]);
  assert.ok(treble > 0.5, `treble ${treble}`);
  assert.ok(bass < 0.05, `bass ${bass}`);
});

test("freqBytesToBands keeps a mid tone off the edges", () => {
  const bands = freqBytesToBands(tone(1000), 7, 44100);
  const mid = Math.max(bands[2], bands[3], bands[4]);
  assert.ok(mid > 0.5, `mid ${mid}`);
  assert.ok(bands[0] < mid);
  assert.ok(bands[6] < mid);
});

test("applyAmbientAudioSession is a no-op without navigator APIs", () => {
  assert.equal(applyAmbientAudioSession(undefined), false);
  assert.equal(applyAmbientAudioSession({}), false);
});

test("applyAmbientAudioSession marks the session as ambient and not controlling", () => {
  const cleared = [];
  const nav = {
    audioSession: { type: "auto" },
    mediaSession: {
      metadata: { title: "radio" },
      playbackState: "playing",
      setActionHandler(action, handler) {
        cleared.push([action, handler]);
      },
    },
  };
  assert.equal(applyAmbientAudioSession(nav), true);
  assert.equal(nav.audioSession.type, "ambient");
  assert.equal(nav.mediaSession.metadata, null);
  assert.equal(nav.mediaSession.playbackState, "none");
  assert.ok(cleared.some(([action, handler]) => action === "pause" && handler == null));
});

test("CORS rewrite is scoped to the extension initiator", () => {
  const src = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(src, /initiatorDomains:\s*\[extensionId\]/);
  assert.match(src, /radio-browser\.info/);
});
