import assert from "node:assert/strict";
import { test } from "node:test";
import { isPlayableStation, POPULAR_HEADING, POPULAR_LIMIT, takePlayableStations } from "../js/radio.js";

test("popular copy", () => {
  assert.equal(POPULAR_LIMIT, 50);
  assert.equal(POPULAR_HEADING, "POPULAR TOP 50");
});

test("drops HLS streams", () => {
  assert.equal(isPlayableStation({ url: "https://ice.example/stream.mp3", codec: "MP3", hls: 0 }), true);
  assert.equal(isPlayableStation({ url: "https://x.com/live.m3u8", codec: "AAC", hls: 0 }), false);
  assert.equal(isPlayableStation({ url: "https://x.com/ok", codec: "MP3", hls: 1 }), false);
});

test("keeps Icecast/SHOUTcast HTTP audio", () => {
  assert.equal(
    isPlayableStation({
      name: "France Info",
      url: "http://direct.franceinfo.fr/live/franceinfo-midfi.mp3",
      codec: "MP3",
      hls: 0,
    }),
    true
  );
  assert.equal(
    isPlayableStation({
      name: "Classic Vinyl HD",
      url: "https://icecast.walmradio.com:8443/classic",
      codec: "MP3",
      hls: 0,
    }),
    true
  );
  assert.equal(
    isPlayableStation({
      name: "Lofi Hip Hop Radio",
      url: "https://ice4.somafm.com/groovesalad-128-mp3",
      hls: 0,
    }),
    true
  );
  assert.equal(
    isPlayableStation({
      name: "FM世田谷",
      url: "https://fmsetagaya834.out.airtime.pro/fmsetagaya834_a",
      codec: "MP3",
      hls: 0,
    }),
    true
  );
});

test("drops iHeart HLS and JP terrestrial relays", () => {
  assert.equal(
    isPlayableStation({
      name: "102.7 KIIS FM",
      url: "https://stream.revma.ihrhls.com/zc185",
      codec: "AAC",
      hls: 0,
    }),
    false
  );
  assert.equal(
    isPlayableStation({
      name: "NHK-FM",
      url: "http://mnet.x10.mx/nhkfm.m3u8",
      codec: "AAC+",
      hls: 1,
    }),
    false
  );
  assert.equal(
    isPlayableStation({
      name: "NHK-FM",
      url: "http://unofficial.example:8000/nhkfm",
      codec: "MP3",
      hls: 0,
    }),
    false
  );
  assert.equal(
    isPlayableStation({
      name: "Gotanno FM 89.2",
      url: "https://radio.gotanno.love/;",
      codec: "MP3",
      hls: 0,
    }),
    true
  );
});

test("takePlayableStations caps the list", () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    stationuuid: `id-${i}`,
    name: `S${i}`,
    url: `https://ex.fm/${i}.mp3`,
    codec: "MP3",
    hls: i === 1 ? 1 : 0,
  }));
  const tracks = takePlayableStations(rows, 3);
  assert.equal(tracks.length, 3);
  assert.equal(tracks[0].title, "S0");
  assert.equal(tracks[1].title, "S2");
});
