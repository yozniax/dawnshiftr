import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeTracks, toggleFavoriteList, trackHaystack, trackKey } from "../js/tracks.js";

test("trackKey prefers id", () => {
  assert.equal(trackKey({ id: "a", url: "http://x" }), "a");
  assert.equal(trackKey({ url: "http://x" }), "http://x");
  assert.equal(trackKey(null), "");
});

test("new favorites are prepended", () => {
  const a = { id: "a", title: "A" };
  const b = { id: "b", title: "B" };
  const first = toggleFavoriteList([], b);
  assert.deepEqual(first.list.map(trackKey), ["b"]);
  assert.equal(first.added, true);
  const second = toggleFavoriteList(first.list, a);
  assert.deepEqual(second.list.map(trackKey), ["a", "b"]);
  const removed = toggleFavoriteList(second.list, a);
  assert.deepEqual(removed.list.map(trackKey), ["b"]);
  assert.equal(removed.added, false);
});

test("mergeTracks keeps first copy", () => {
  const out = mergeTracks([{ id: "a" }], [{ id: "a" }, { id: "b" }]);
  assert.deepEqual(out.map(trackKey), ["a", "b"]);
});

test("haystack includes notes", () => {
  assert.match(trackHaystack({ title: "Soma", tags: "chill" }, "night work"), /night work/);
});
