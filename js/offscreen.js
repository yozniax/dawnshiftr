import { PlayerCore } from "./core.js";

const core = new PlayerCore();
const port = chrome.runtime.connect({ name: "offscreen" });

await core.hydrate();

core.subscribe((state, kind) => {
  port.postMessage({ type: "state", state, kind });
});

let analyserTimer = 0;
function pumpAnalyser() {
  const a = core.getAnalyser();
  if (a && core.state.status === "playing") {
    port.postMessage({
      type: "analyser",
      payload: { freq: Array.from(a.freq), time: Array.from(a.time) },
    });
  }
}

analyserTimer = setInterval(pumpAnalyser, 45);

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
