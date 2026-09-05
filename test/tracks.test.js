import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeTracks, toggleFavoriteList, trackHaystack, trackKey, tracksForPane, scrollChildIntoContainer } from "../js/tracks.js";

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

test("stations pane keeps popular rows even without a search", () => {
  const popular = [{ id: "1" }, { id: "2" }];
  assert.equal(tracksForPane("stations", { stations: popular }).length, 2);
  assert.equal(tracksForPane("history", { history: [{ id: "h" }] }).length, 1);
});

test("scrollChildIntoContainer only moves the list scrollTop", () => {
  const container = {
    scrollTop: 80,
    getBoundingClientRect: () => ({ top: 200, bottom: 400 }),
  };
  const below = { getBoundingClientRect: () => ({ top: 420, bottom: 450 }) };
  scrollChildIntoContainer(container, below);
  assert.equal(container.scrollTop, 130);
  const above = { getBoundingClientRect: () => ({ top: 160, bottom: 190 }) };
  scrollChildIntoContainer(container, above);
  assert.equal(container.scrollTop, 90);
});
