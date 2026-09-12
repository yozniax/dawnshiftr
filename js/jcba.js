const JCBA_PREFIX = "jcba:";
const SELECT_URL = "https://api.radimo.smen.biz/api/v1/select_stream";
const WS_PROTOCOL = "listener.fmplapla.com";

export const DOYOBE_PICKS_HEADING = "DOYOBE PICKS";

export const DOYOBE_PICKS = [
  {
    title: "FMいかる",
    url: "jcba:fmikaru",
    id: "jcba:fmikaru",
    kind: "jcba",
    country: "JP",
    tags: "community,kyoto,ayabe",
    homepage: "https://fmikaru.jp/",
    social: ["https://www.facebook.com/Fmikaru/"],
  },
  {
    title: "ラジオ川越",
    url: "jcba:radiokawagoe",
    id: "jcba:radiokawagoe",
    kind: "jcba",
    country: "JP",
    tags: "community,saitama,kawagoe",
    homepage: "https://radiokawagoe.com/",
    social: [
      "https://x.com/radiokawagoe",
      "https://www.instagram.com/radiokawagoe/",
      "https://www.facebook.com/radiokawagoe",
    ],
  },
];

export function jcbaStationId(url) {
  const s = String(url || "");
  return s.startsWith(JCBA_PREFIX) ? s.slice(JCBA_PREFIX.length) : "";
}

export function isJcbaUrl(url) {
  return Boolean(jcbaStationId(url));
}

export function doyobePicks() {
  return DOYOBE_PICKS.map((s) => ({ ...s }));
}

function concatBytes(parts) {
  const list = parts.filter((p) => p && p.length);
  if (!list.length) return new Uint8Array(0);
  if (list.length === 1) return list[0];
  const n = list.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of list) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function splitOggPackets(bytes, carry = { rest: new Uint8Array(0), cont: [] }) {
  const data = concatBytes([carry.rest, bytes]);
  let offset = 0;
  const packets = [];
  let cont = carry.cont || [];
  while (offset + 27 <= data.length) {
    if (data[offset] !== 0x4f || data[offset + 1] !== 0x67 || data[offset + 2] !== 0x67 || data[offset + 3] !== 0x53) {
      offset += 1;
      continue;
    }
    const nseg = data[offset + 26];
    const headerSize = 27 + nseg;
    if (offset + headerSize > data.length) break;
    let payloadLen = 0;
    for (let i = 0; i < nseg; i++) payloadLen += data[offset + 27 + i];
    if (offset + headerSize + payloadLen > data.length) break;
    const table = data.subarray(offset + 27, offset + 27 + nseg);
    const payload = data.subarray(offset + headerSize, offset + headerSize + payloadLen);
    let p = 0;
    for (let i = 0; i < nseg; i++) {
      const len = table[i];
      cont.push(payload.subarray(p, p + len));
      p += len;
      if (len < 255) {
        packets.push(concatBytes(cont));
        cont = [];
      }
    }
    offset += headerSize + payloadLen;
  }
  return { packets, carry: { rest: data.subarray(offset), cont } };
}

function startsWithAscii(packet, ascii) {
  if (!packet || packet.length < ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (packet[i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

export function isOpusHead(packet) {
  return startsWithAscii(packet, "OpusHead") && packet.length >= 19;
}

export function isOpusTags(packet) {
  return startsWithAscii(packet, "OpusTags");
}

export function opusHeadInfo(packet) {
  if (!isOpusHead(packet)) return { channels: 2, sampleRate: 48000 };
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  return {
    channels: packet[9] || 2,
    sampleRate: view.getUint32(12, true) || 48000,
  };
}

export async function selectJcbaStream(stationId) {
  const id = encodeURIComponent(stationId);
  const res = await fetch(`${SELECT_URL}?station=${id}&channel=0&quality=high&burst=5`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`jcba ${res.status}`);
  const data = await res.json();
  if (!data?.location || !data?.token) throw new Error("jcba stream missing");
  return data;
}

export class JcbaSession {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.dest = dest;
    this.ws = null;
    this.decoder = null;
    this.carry = { rest: new Uint8Array(0), cont: [] };
    this.nextTime = 0;
    this.sources = new Set();
    this.live = false;
    this.ready = false;
    this.channels = 2;
    this.sampleRate = 48000;
    this.ts = 0;
    this.onPlaying = null;
    this.onError = null;
  }

  async start(stationId) {
    this.stop();
    if (typeof AudioDecoder === "undefined") throw new Error("Opus decoder unavailable");
    const { location, token } = await selectJcbaStream(stationId);
    const decoder = new AudioDecoder({
      output: (frame) => this.enqueue(frame),
      error: (err) => this.onError?.(err.message || "jcba decode"),
    });
    this.decoder = decoder;
    this.ws = new WebSocket(location, [WS_PROTOCOL]);
    this.ws.binaryType = "arraybuffer";
    this.ws.addEventListener("open", () => {
      this.ws?.send(token);
      this.live = true;
    });
    this.ws.addEventListener("message", (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      this.ingest(new Uint8Array(ev.data));
    });
    this.ws.addEventListener("error", () => this.onError?.("jcba socket"));
    this.ws.addEventListener("close", () => {
      this.live = false;
    });
  }

  ingest(bytes) {
    const { packets, carry } = splitOggPackets(bytes, this.carry);
    this.carry = carry;
    for (const packet of packets) {
      if (!packet.length) continue;
      if (isOpusHead(packet)) {
        const info = opusHeadInfo(packet);
        this.channels = info.channels;
        this.sampleRate = info.sampleRate;
        const description = packet.slice().buffer;
        this.decoder.configure({
          codec: "opus",
          numberOfChannels: this.channels,
          sampleRate: this.sampleRate,
          description,
        });
        this.ready = true;
        continue;
      }
      if (isOpusTags(packet) || !this.ready) continue;
      try {
        this.decoder.decode(new EncodedAudioChunk({
          type: "key",
          timestamp: this.ts,
          data: packet,
        }));
        this.ts += 20_000;
      } catch (err) {
        this.onError?.(err.message || "jcba packet");
      }
    }
  }

  enqueue(frame) {
    try {
      const frames = frame.numberOfFrames;
      const buf = this.ctx.createBuffer(frame.numberOfChannels, frames, frame.sampleRate);
      for (let c = 0; c < frame.numberOfChannels; c++) {
        const plane = new Float32Array(frames);
        try {
          frame.copyTo(plane, { planeIndex: c, format: "f32-planar" });
        } catch {
          frame.copyTo(plane, { planeIndex: c });
        }
        buf.copyToChannel(plane, c);
      }
      frame.close();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.dest);
      src.onended = () => this.sources.delete(src);
      const now = this.ctx.currentTime;
      if (this.nextTime < now + 0.08) this.nextTime = now + 0.08;
      src.start(this.nextTime);
      this.nextTime += buf.duration;
      this.sources.add(src);
      this.onPlaying?.();
    } catch (err) {
      try {
        frame.close();
      } catch {
        /* closed */
      }
      this.onError?.(err.message || "jcba play");
    }
  }

  stop() {
    this.live = false;
    this.ready = false;
    this.ts = 0;
    this.nextTime = 0;
    this.carry = { rest: new Uint8Array(0), cont: [] };
    try {
      this.ws?.close();
    } catch {
      /* empty */
    }
    this.ws = null;
    try {
      this.decoder?.close();
    } catch {
      /* empty */
    }
    this.decoder = null;
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        /* ended */
      }
    }
    this.sources.clear();
  }
}
