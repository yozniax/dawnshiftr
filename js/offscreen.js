import { applyAmbientAudioSession } from "./audio-engine.js";
import { PlayerCore } from "./core.js";

applyAmbientAudioSession();

const core = new PlayerCore();
const BARS = 7;
const EQ_MS = 40;
let port = null;

await core.hydrate();

function post(msg) {
  try {
    port?.postMessage(msg);
  } catch {
    /* service worker restarted */
  }
}

core.subscribe((state, kind) => {
  post({ type: "state", state, kind });
});

function connect() {
  port = chrome.runtime.connect({ name: "offscreen" });
  port.onMessage.addListener((msg) => {
    if (msg?.type === "cmd") {
      Promise.resolve(core.command(msg.name, ...(msg.args || [])))
        .then((result) => post({ type: "cmd-ok", id: msg.id, result }))
        .catch((err) => post({ type: "cmd-err", id: msg.id, error: String(err.message || err) }));
    }
    if (msg?.type === "hello") {
      post({ type: "state", state: core.state });
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, 250);
  });
  post({ type: "ready", state: core.state });
}

connect();

// rAF does not tick in a hidden offscreen document; the UI then draws fake EQ.
setInterval(() => {
  if (core.state.status !== "playing" && !core.state.playing) return;
  post({ type: "analyser", bins: core.engine.getSpectrum(BARS) });
}, EQ_MS);
