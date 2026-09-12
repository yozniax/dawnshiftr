import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DOYOBE_PICKS,
  isJcbaUrl,
  isOpusHead,
  isOpusTags,
  jcbaStationId,
  opusHeadInfo,
  splitOggPackets,
} from "../js/jcba.js";

function oggPage(payload) {
  const segs = [];
  for (let left = payload.length; left > 0; ) {
    const n = Math.min(255, left);
    segs.push(n);
    left -= n;
  }
  const out = new Uint8Array(27 + segs.length + payload.length);
  out[0] = 0x4f;
  out[1] = 0x67;
  out[2] = 0x67;
  out[3] = 0x53;
  out[26] = segs.length;
  segs.forEach((n, i) => {
    out[27 + i] = n;
  });
  out.set(payload, 27 + segs.length);
  return out;
}

test("jcbaStationId reads DoYoBe pick urls", () => {
  assert.equal(jcbaStationId("jcba:fmikaru"), "fmikaru");
  assert.equal(jcbaStationId("jcba:radiokawagoe"), "radiokawagoe");
  assert.equal(isJcbaUrl("https://example"), false);
  assert.equal(DOYOBE_PICKS.length, 2);
  assert.ok(DOYOBE_PICKS.every((t) => t.kind === "jcba" && t.country === "JP"));
  assert.ok(DOYOBE_PICKS.every((t) => t.homepage.startsWith("https://")));
});

test("splitOggPackets extracts OpusHead", () => {
  const head = new Uint8Array(19);
  "OpusHead".split("").forEach((ch, i) => {
    head[i] = ch.charCodeAt(0);
  });
  head[8] = 1;
  head[9] = 2;
  head[12] = 0x80;
  head[13] = 0xbb;
  const { packets } = splitOggPackets(oggPage(head));
  assert.equal(packets.length, 1);
  assert.equal(isOpusHead(packets[0]), true);
  assert.equal(isOpusTags(packets[0]), false);
  assert.equal(opusHeadInfo(packets[0]).channels, 2);
  assert.equal(opusHeadInfo(packets[0]).sampleRate, 48000);
});

test("splitOggPackets carries a truncated page", () => {
  const payload = new Uint8Array([1, 2, 3, 4]);
  const page = oggPage(payload);
  const first = splitOggPackets(page.subarray(0, 10));
  assert.equal(first.packets.length, 0);
  const second = splitOggPackets(page.subarray(10), first.carry);
  assert.equal(second.packets.length, 1);
  assert.deepEqual([...second.packets[0]], [1, 2, 3, 4]);
});
