import assert from "node:assert/strict";
import { test } from "node:test";
import { parseYouTubeUrl, youtubeTitle, youtubeTrack } from "../js/youtube.js";

test("parseYouTubeUrl watch v=", () => {
  const p = parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(p.videoId, "dQw4w9WgXcQ");
  assert.equal(p.listId, "");
});

test("parseYouTubeUrl shorts and youtu.be", () => {
  assert.equal(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")?.videoId, "dQw4w9WgXcQ");
  assert.equal(parseYouTubeUrl("https://www.youtube.com/shorts/abc123")?.videoId, "abc123");
});

test("parseYouTubeUrl music host", () => {
  const p = parseYouTubeUrl("https://music.youtube.com/watch?v=xyz&list=RDxyz");
  assert.equal(p.videoId, "xyz");
  assert.equal(p.listId, "RDxyz");
});

test("youtubeTitle strips site suffix", () => {
  assert.equal(youtubeTitle("Song Name - YouTube"), "Song Name");
  assert.equal(youtubeTitle("Track - YouTube Music"), "Track");
});

test("youtubeTrack id", () => {
  const t = youtubeTrack({ videoId: "abc", listId: "", url: "https://www.youtube.com/watch?v=abc" }, "Hello - YouTube");
  assert.equal(t.id, "yt:abc");
  assert.equal(t.kind, "youtube");
  assert.equal(t.title, "Hello");
});
