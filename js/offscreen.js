import { PlayerCore } from "./core.js";

const core = new PlayerCore();
const port = chrome.runtime.connect({ name: "offscreen" });

await core.hydrate();

core.subscribe((state, kind) => {
  port.postMessage({ type: "state", state, kind });
});

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
