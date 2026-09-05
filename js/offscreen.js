import { PlayerCore } from "./core.js";

const core = new PlayerCore();
const port = chrome.runtime.connect({ name: "offscreen" });
const BARS = 18;
let lastBins = 0;

await core.hydrate();

core.subscribe((state, kind) => {
  port.postMessage({ type: "state", state, kind });
});

function pumpAnalyser(now) {
  if (core.state.status === "playing" && now - lastBins > 32) {
    lastBins = now;
    port.postMessage({ type: "analyser", bins: core.engine.getSpectrum(BARS) });
  }
  requestAnimationFrame(pumpAnalyser);
}
requestAnimationFrame(pumpAnalyser);

port.onMessage.addListener((msg) => {
  if (msg?.type === "cmd") {
    Promise.resolve(core.command(msg.name, ...(msg.args || [])))
      .then((result) => port.postMessage({ type: "cmd-ok", id: msg.id, result }))
      .catch((err) => port.postMessage({ type: "cmd-err", id: msg.id, error: String(err.message || err) }));
  }
  if (msg?.type === "hello") {
    port.postMessage({ type: "state", state: core.state });
  }
});

port.postMessage({ type: "ready", state: core.state });
