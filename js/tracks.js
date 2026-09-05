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
