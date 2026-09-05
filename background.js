import { parseYouTubeUrl } from "./js/youtube.js";

const OFFSCREEN_URL = "offscreen.html";
const PLAYER_URL = "player.html?surface=window";

let offscreenPort = null;
const uiPorts = new Set();
const pending = [];
let playerWindowId = null;

async function hasOffscreen() {
  if (chrome.offscreen.hasDocument) return chrome.offscreen.hasDocument();
  const ctxs = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  return ctxs.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Keep DAWNSHIFTr radio playing in the background",
  });
}

function sendToOffscreen(msg) {
  if (offscreenPort) offscreenPort.postMessage(msg);
  else pending.push(msg);
}

function broadcast(msg) {
  for (const port of uiPorts) {
    try {
      port.postMessage(msg);
    } catch {
      uiPorts.delete(port);
    }
  }
}

async function openPlayerWindow() {
  if (playerWindowId != null) {
    try {
      await chrome.windows.update(playerWindowId, { focused: true, drawAttention: true });
      return;
    } catch {
      playerWindowId = null;
    }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(PLAYER_URL),
    type: "popup",
    width: 380,
    height: 600,
    focused: true,
  });
  playerWindowId = win?.id ?? null;
}

function youtubeFromTab(tab) {
  const parsed = parseYouTubeUrl(tab?.url || "");
  if (!parsed) return null;
  return { ...parsed, title: tab.title || "YouTube", url: tab.url };
}

async function findYouTubeTab(clickedTab) {
  const direct = youtubeFromTab(clickedTab);
  if (direct) return direct;
  const windows = await chrome.tabs.query({ currentWindow: true });
  for (const tab of windows) {
    const hit = youtubeFromTab(tab);
    if (hit) return hit;
  }
  const all = await chrome.tabs.query({});
  for (const tab of all) {
    const hit = youtubeFromTab(tab);
    if (hit) return hit;
  }
  return null;
}

async function playYouTubeTab(tab) {
  await ensureOffscreen();
  const yt = await findYouTubeTab(tab);
  if (yt) sendToOffscreen({ type: "cmd", name: "playYouTube", args: [yt] });
  return Boolean(yt);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "offscreen") {
    offscreenPort = port;
    while (pending.length) offscreenPort.postMessage(pending.shift());
    port.onMessage.addListener((msg) => {
      if (msg.type === "state" || msg.type === "analyser" || msg.type === "ready") {
        broadcast(msg.type === "ready" ? { type: "state", state: msg.state } : msg);
      }
    });
    port.onDisconnect.addListener(() => {
      offscreenPort = null;
    });
    return;
  }

  if (port.name === "ui") {
    uiPorts.add(port);
    ensureOffscreen()
      .then(() => sendToOffscreen({ type: "hello" }))
      .catch((err) => port.postMessage({ type: "state-error", error: String(err) }));
    port.onMessage.addListener((msg) => sendToOffscreen(msg));
    port.onDisconnect.addListener(() => uiPorts.delete(port));
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  await playYouTubeTab(tab);
  openPlayerWindow();
});

chrome.windows.onRemoved.addListener((id) => {
  if (id === playerWindowId) playerWindowId = null;
});

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "open-window", title: "Open DAWNSHIFTr window", contexts: ["action"] });
    chrome.contextMenus.create({ id: "open-tab", title: "Open DAWNSHIFTr in tab", contexts: ["action"] });
    chrome.contextMenus.create({ id: "open-side", title: "Open side panel", contexts: ["action"] });
    chrome.contextMenus.create({ id: "play-youtube", title: "Play YouTube tab in DAWNSHIFTr", contexts: ["action"] });
    chrome.contextMenus.create({
      id: "play-youtube-page",
      title: "Play this tab in DAWNSHIFTr",
      contexts: ["page"],
      documentUrlPatterns: ["*://*.youtube.com/*", "*://youtu.be/*", "*://*.youtube-nocookie.com/*", "*://music.youtube.com/*"],
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  setupContextMenus();
  if (details.reason === "install") openPlayerWindow();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "open-window") {
    openPlayerWindow();
  }
  if (info.menuItemId === "open-tab") {
    chrome.tabs.create({ url: chrome.runtime.getURL("player.html") });
  }
  if (info.menuItemId === "open-side") {
    const windowId = tab?.windowId ?? (await chrome.windows.getCurrent()).id;
    await chrome.sidePanel.open({ windowId });
  }
  if (info.menuItemId === "play-youtube" || info.menuItemId === "play-youtube-page") {
    await playYouTubeTab(tab);
    openPlayerWindow();
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  await ensureOffscreen();
  if (command === "open-player") {
    await openPlayerWindow();
    return;
  }
  const map = {
    "play-pause": ["toggle"],
    "next-track": ["next"],
    "prev-track": ["prev"],
  };
  const args = map[command];
  if (args) sendToOffscreen({ type: "cmd", name: args[0], args: [] });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "sleep-stop") return;
  await ensureOffscreen();
  sendToOffscreen({ type: "cmd", name: "finishSleepTimer", args: [] });
});

ensureOffscreen().catch(() => {});
