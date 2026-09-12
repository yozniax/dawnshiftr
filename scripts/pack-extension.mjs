#!/usr/bin/env node
/**
 * Build a clean Chrome extension (unpacked folder + Web Store zip).
 * Preview-only files (server.mjs, tests, store copy) stay out of the package.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const unpacked = join(dist, "chrome");
const zipName = "dawnshiftr-chrome.zip";
const out = join(dist, zipName);

const files = [
  "manifest.json",
  "background.js",
  "player.html",
  "offscreen.html",
  "privacy.html",
  "rules.json",
  "LICENSE",
  "css",
  "js",
  "icons",
  "audio",
];

for (const rel of files) {
  statSync(join(root, rel));
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(unpacked, { recursive: true });

function keep(src) {
  const base = src.split("/").pop();
  if (!base) return true;
  if (base === ".DS_Store" || base.endsWith(".map") || base === "__pycache__") return false;
  return true;
}

for (const rel of files) {
  cpSync(join(root, rel), join(unpacked, rel), { recursive: true, filter: keep });
}

const zip = spawnSync("zip", ["-r", "-q", out, "."], { cwd: unpacked, stdio: "inherit" });
if (zip.status !== 0) {
  console.error("zip failed");
  process.exit(zip.status || 1);
}

const kb = Math.round(statSync(out).size / 1024);
console.log(`Wrote unpacked ${unpacked}`);
console.log(`Wrote ${out} (${kb} KB)`);
console.log("Load unpacked: chrome://extensions → Developer mode → Load unpacked → dist/chrome");
console.log("Chrome Web Store: upload dist/dawnshiftr-chrome.zip (see store/CHROME.md)");
