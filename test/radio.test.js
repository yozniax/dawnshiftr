import assert from "node:assert/strict";
import { test } from "node:test";
import { isPlayableStation, POPULAR_HEADING, POPULAR_LIMIT, takePlayableStations } from "../js/radio.js";

test("popular copy", () => {
  assert.equal(POPULAR_LIMIT, 50);
  assert.equal(POPULAR_HEADING, "POPULAR TOP 50");
});

test("drops HLS streams", () => {
  assert.equal(isPlayableStation({ url: "https://x.com/stream.mp3", hls: 0 }), true);
  assert.equal(isPlayableStation({ url: "https://x.com/live.m3u8", hls: 0 }), false);
  assert.equal(isPlayableStation({ url: "https://x.com/ok", hls: 1 }), false);
});

test("takePlayableStations caps the list", () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    stationuuid: `id-${i}`,
    name: `S${i}`,
    url: `https://ex.fm/${i}.mp3`,
    hls: i === 1 ? 1 : 0,
  }));
  const tracks = takePlayableStations(rows, 3);
  assert.equal(tracks.length, 3);
  assert.equal(tracks[0].title, "S0");
  assert.equal(tracks[1].title, "S2");
});
