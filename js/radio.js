export const FEATURED = [
  {
    title: "Lofi Hip Hop Radio",
    url: "https://ice4.somafm.com/groovesalad-128-mp3",
    tags: "lofi,chill",
    homepage: "https://somafm.com/groovesalad/",
  },
  {
    title: "EDM Pulse",
    url: "https://ice4.somafm.com/thetrip-128-mp3",
    tags: "edm,trance",
    homepage: "https://somafm.com/thetrip/",
  },
  {
    title: "Synthwave Nights",
    url: "https://stream.nightride.fm/nightride.m4a",
    tags: "synthwave",
    homepage: "https://nightride.fm/",
  },
  {
    title: "Space Station",
    url: "https://ice4.somafm.com/spacestation-128-mp3",
    tags: "ambient,space",
    homepage: "https://somafm.com/spacestation/",
  },
  {
    title: "Vaporwave",
    url: "https://ice4.somafm.com/vaporwaves-128-mp3",
    tags: "vaporwave",
    homepage: "https://somafm.com/vaporwaves/",
  },
  {
    title: "Beat Blender",
    url: "https://ice4.somafm.com/beatblender-128-mp3",
    tags: "downtempo",
    homepage: "https://somafm.com/beatblender/",
  },
  {
    title: "Drone Zone",
    url: "https://ice4.somafm.com/dronezone-128-mp3",
    tags: "ambient,drone",
    homepage: "https://somafm.com/dronezone/",
  },
  {
    title: "Lush",
    url: "https://ice4.somafm.com/lush-128-mp3",
    tags: "vocal,chill",
    homepage: "https://somafm.com/lush/",
  },
  {
    title: "Secret Agent",
    url: "https://ice4.somafm.com/secretagent-128-mp3",
    tags: "lounge",
    homepage: "https://somafm.com/secretagent/",
  },
  {
    title: "Indie Pop Rocks",
    url: "https://ice4.somafm.com/indiepop-128-mp3",
    tags: "indie",
    homepage: "https://somafm.com/indiepop/",
  },
  {
    title: "DEF CON Radio",
    url: "https://ice4.somafm.com/defcon-128-mp3",
    tags: "electronic",
    homepage: "https://somafm.com/defcon/",
  },
  {
    title: "Synphaera",
    url: "https://ice4.somafm.com/synphaera-128-mp3",
    tags: "ambient",
    homepage: "https://somafm.com/synphaera/",
  },
];

const API_HOSTS = [
  "https://de1.api.radio-browser.info",
  "https://fi1.api.radio-browser.info",
  "https://all.api.radio-browser.info",
];

let cachedHost = null;

async function api(path) {
  const hosts = cachedHost ? [cachedHost, ...API_HOSTS.filter((h) => h !== cachedHost)] : API_HOSTS;
  let lastError = null;
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}${path}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      cachedHost = host;
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Radio Browser unreachable");
}

export function toTrack(station, extra = {}) {
  return {
    id: station.stationuuid || station.url,
    title: (station.name || station.title || "Unknown").trim(),
    url: station.url_resolved || station.url,
    tags: station.tags || "",
    country: station.countrycode || station.country || "",
    codec: station.codec || "",
    bitrate: station.bitrate || 0,
    homepage: station.homepage || "",
    favicon: station.favicon || "",
    kind: "radio",
    ...extra,
  };
}

export function featuredTracks() {
  return FEATURED.map((s, i) => toTrack(s, { id: `featured-${i}` }));
}

export async function searchStations({ name = "", tag = "", country = "", limit = 40 } = {}) {
  const params = new URLSearchParams({
    hidebroken: "true",
    order: "clickcount",
    reverse: "true",
    limit: String(limit),
  });
  if (name) params.set("name", name);
  if (tag) params.set("tag", tag);
  if (country) params.set("countrycode", country);
  const rows = await api(`/json/stations/search?${params}`);
  return (rows || [])
    .filter((s) => s.url_resolved || s.url)
    .map((s) => toTrack(s));
}

export async function topStations(limit = 40) {
  const rows = await api(
    `/json/stations/search?hidebroken=true&order=clickcount&reverse=true&limit=${limit}`
  );
  return (rows || []).filter((s) => s.url_resolved || s.url).map((s) => toTrack(s));
}

export async function stationsByCountry(code, limit = 80) {
  return searchStations({ country: code, limit });
}

export const REGIONS = [
  { name: "United States", code: "US" },
  { name: "Japan", code: "JP" },
  { name: "United Kingdom", code: "GB" },
  { name: "Germany", code: "DE" },
  { name: "France", code: "FR" },
  { name: "Canada", code: "CA" },
  { name: "Australia", code: "AU" },
  { name: "Brazil", code: "BR" },
  { name: "Netherlands", code: "NL" },
  { name: "Sweden", code: "SE" },
  { name: "South Korea", code: "KR" },
  { name: "Spain", code: "ES" },
  { name: "Italy", code: "IT" },
  { name: "Poland", code: "PL" },
  { name: "Norway", code: "NO" },
  { name: "Finland", code: "FI" },
  { name: "India", code: "IN" },
  { name: "Mexico", code: "MX" },
];

export async function resolveClick(uuid) {
  if (!uuid || String(uuid).startsWith("featured-")) return null;
  try {
    const rows = await api(`/json/url/${uuid}`);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row?.url || null;
  } catch {
    return null;
  }
}

export function isWebPreview() {
  return typeof location !== "undefined" && (location.protocol === "http:" || location.protocol === "https:");
}

export function fetchableUrl(url) {
  if (!url) return url;
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  if (isWebPreview()) return `/proxy?url=${encodeURIComponent(url)}`;
  return url;
}

export function playableUrl(url) {
  if (!url) return url;
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  return url;
}

export async function parsePlaylist(text, sourceUrl) {
  const tracks = [];
  const lines = text.replace(/\r/g, "").split("\n");
  if (/\[playlist\]/i.test(text)) {
    const files = {};
    const titles = {};
    for (const line of lines) {
      const fm = line.match(/^File(\d+)=(.+)$/i);
      const tm = line.match(/^Title(\d+)=(.+)$/i);
      if (fm) files[fm[1]] = fm[2].trim();
      if (tm) titles[tm[1]] = tm[2].trim();
    }
    for (const [n, url] of Object.entries(files)) {
      tracks.push({
        id: url,
        title: titles[n] || url,
        url: absUrl(url, sourceUrl),
        kind: "stream",
      });
    }
    return tracks;
  }
  let pendingTitle = null;
  for (const line of lines) {
    if (!line || line.startsWith("#EXTM3U")) continue;
    if (line.startsWith("#EXTINF:")) {
      pendingTitle = line.split(",").slice(1).join(",").trim() || null;
      continue;
    }
    if (line.startsWith("#")) continue;
    const url = absUrl(line.trim(), sourceUrl);
    tracks.push({
      id: url,
      title: pendingTitle || url,
      url,
      kind: "stream",
    });
    pendingTitle = null;
  }
  return tracks;
}

function absUrl(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

export async function loadFromUrl(raw) {
  const url = raw.trim();
  if (!url) throw new Error("empty url");
  const lower = url.split("?")[0].toLowerCase();
  if (lower.endsWith(".m3u") || lower.endsWith(".m3u8") || lower.endsWith(".pls")) {
    const fetchUrl = fetchableUrl(url);
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`playlist ${res.status}`);
    const text = await res.text();
    const tracks = await parsePlaylist(text, url);
    if (!tracks.length) throw new Error("empty playlist");
    return tracks;
  }
  return [
    {
      id: url,
      title: url.replace(/^https?:\/\//, "").slice(0, 48),
      url,
      kind: "stream",
    },
  ];
}
