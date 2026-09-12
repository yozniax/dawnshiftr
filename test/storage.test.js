import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compactState,
  decodeVaultChunks,
  encodeVaultChunks,
  hasUserData,
  pickPersisted,
} from "../js/storage.js";

test("hasUserData ignores empty shells and volume-only bags", () => {
  assert.equal(hasUserData({}), false);
  assert.equal(hasUserData({ volume: 80, savedAt: 9 }), false);
  assert.equal(hasUserData({ favorites: [{ id: "a", title: "A", url: "http://a" }] }), true);
  assert.equal(hasUserData({ notes: { a: { text: "night" } } }), true);
});

test("pickPersisted prefers personal data, then the newest savedAt", () => {
  const empty = { savedAt: 50, volume: 10 };
  const olderFavs = { savedAt: 20, favorites: [{ id: "old" }] };
  const newerFavs = { savedAt: 40, favorites: [{ id: "new" }] };
  const picked = pickPersisted(empty, olderFavs, newerFavs);
  assert.equal(picked.favorites[0].id, "new");
});

test("encodeVaultChunks round-trips favorites and notes", () => {
  const state = {
    savedAt: 123,
    volume: 72,
    favorites: [{ id: "soma", title: "Drone Zone", url: "https://ice.example/drone" }],
    notes: { soma: { text: "Before sleep", title: "Drone Zone", url: "https://ice.example/drone" } },
    hidden: ["x"],
    history: [],
    playlist: [],
    index: 0,
  };
  const restored = decodeVaultChunks(encodeVaultChunks(state));
  assert.equal(restored.volume, 72);
  assert.equal(restored.favorites[0].title, "Drone Zone");
  assert.equal(restored.notes.soma.text, "Before sleep");
  assert.deepEqual(restored.hidden, ["x"]);
});

test("compactState drops blobs and caps history", () => {
  const packed = compactState({
    savedAt: 1,
    favorites: [{ id: "a", title: "A", url: "http://a", file: { nope: true } }],
    history: Array.from({ length: 60 }, (_, i) => ({ id: `h${i}`, title: "H", url: `http://h/${i}` })),
  });
  assert.equal(packed.favorites[0].file, undefined);
  assert.equal(packed.history.length, 40);
});
