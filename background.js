chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const OFFSCREEN_URL = "offscreen.html";

let offscreenPort = null;
const uiPorts = new Set();
const pending = [];

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
    justification: "Keep cliamp radio and local audio playing in the background",
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "open-window", title: "Open cliamp window", contexts: ["action"] });
    chrome.contextMenus.create({ id: "open-tab", title: "Open cliamp in tab", contexts: ["action"] });
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "open-window") {
    chrome.windows.create({
      url: chrome.runtime.getURL("player.html?surface=window"),
      type: "popup",
      width: 460,
      height: 760,
      focused: true,
    });
  }
  if (info.menuItemId === "open-tab") {
    chrome.tabs.create({ url: chrome.runtime.getURL("player.html") });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  await ensureOffscreen();
  if (command === "open-player") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
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

ensureOffscreen().catch(() => {});
