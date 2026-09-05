export function trackKey(t) {
  return t?.id || t?.url || "";
}

export function mergeTracks(primary, extra) {
  const seen = new Set((primary || []).map(trackKey).filter(Boolean));
  const out = [...(primary || [])];
  for (const t of extra || []) {
    const k = trackKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function toggleFavoriteList(favorites, track) {
  if (!track) return { list: favorites || [], added: false, item: null };
  const key = trackKey(track);
  const current = favorites || [];
  const has = current.some((f) => trackKey(f) === key);
  const { file, _blobUrl, blob, ...rest } = track;
  if (has) {
    return { list: current.filter((f) => trackKey(f) !== key), added: false, item: rest };
  }
  return { list: [rest, ...current], added: true, item: rest };
}

export function trackHaystack(t, note = "") {
  return [t?.title, t?.country, t?.tags, note].filter(Boolean).join(" ").toLowerCase();
}

export function tracksForPane(pane, { stations = [], favorites = [], history = [], countries = [] } = {}) {
  if (pane === "stations") return stations;
  if (pane === "fav") return favorites;
  if (pane === "history") return history;
  if (pane === "countries") return countries;
  return [];
}

export function scrollChildIntoContainer(container, child, gutterTop = 0) {
  if (!container || !child) return;
  const box = container.getBoundingClientRect();
  const row = child.getBoundingClientRect();
  const top = box.top + Math.max(0, Number(gutterTop) || 0);
  if (row.top < top) container.scrollTop += row.top - top;
  else if (row.bottom > box.bottom) container.scrollTop += row.bottom - box.bottom;
}

export function trackAtCursor(tracks, cursor, row) {
  const list = tracks || [];
  if (row?.dataset?.key) {
    const found = list.find((t) => trackKey(t) === row.dataset.key);
    if (found) return found;
  }
  const i = row?.dataset?.i != null && row.dataset.i !== "" ? Number(row.dataset.i) : cursor;
  if (Number.isFinite(i) && list[i]) return list[i];
  return list[cursor] || null;
}
