#!/usr/bin/env node
/**
 * Build a Chrome Web Store zip (unpacked extension, no preview server / tests).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
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
mkdirSync(dist, { recursive: true });

const zip = spawnSync(
  "zip",
  ["-r", "-q", out, ...files, "-x", "*.DS_Store", "*__pycache__*", "*.map"],
  { cwd: root, stdio: "inherit" },
);

if (zip.status !== 0) {
  console.error("zip failed");
  process.exit(zip.status || 1);
}

const kb = Math.round(statSync(out).size / 1024);
console.log(`Wrote ${out} (${kb} KB)`);
console.log("Load unpacked: chrome://extensions → Developer mode → Load unpacked → this repo folder");
console.log("Chrome Web Store: upload dist/dawnshiftr-chrome.zip (see store/CHROME.md)");
