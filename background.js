import { handleVaultMessage } from "./js/storage.js";

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
    width: 560,
    height: 640,
    focused: true,
  });
  playerWindowId = win?.id ?? null;
}

async function openPlayerPopup() {
  try {
    if (chrome.action?.openPopup) {
      await chrome.action.openPopup();
      return;
    }
  } catch {
    /* no toolbar host window, or popup already open */
  }
  await openPlayerWindow();
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

chrome.windows.onRemoved.addListener((id) => {
  if (id === playerWindowId) playerWindowId = null;
});

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "open-window", title: "Open DAWNSHIFTr window", contexts: ["action"] });
    chrome.contextMenus.create({ id: "open-tab", title: "Open DAWNSHIFTr in tab", contexts: ["action"] });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "open-window") {
    openPlayerWindow();
  }
  if (info.menuItemId === "open-tab") {
    chrome.tabs.create({ url: chrome.runtime.getURL("player.html") });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  await ensureOffscreen();
  if (command === "open-player") {
    await openPlayerPopup();
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const work = handleVaultMessage(msg);
  if (!work) return;
  work.then((data) => sendResponse(data)).catch((err) => sendResponse({ error: String(err) }));
  return true;
});
