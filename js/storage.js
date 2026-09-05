const KEY = "dawnshiftr-state-v1";
const LEGACY_KEY = "broamp-state-v2";

function chromeStorage() {
  return globalThis.chrome?.storage?.local;
}

export async function loadPersisted() {
  const api = chromeStorage();
  if (api) {
    const bag = await api.get([KEY, LEGACY_KEY]);
    return bag[KEY] || bag[LEGACY_KEY] || {};
  }
  try {
    return JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY) || "{}");
  } catch {
    return {};
  }
}

export async function savePersisted(partial) {
  const prev = await loadPersisted();
  const next = { ...prev, ...partial };
  const api = chromeStorage();
  if (api) {
    await api.set({ [KEY]: next });
  } else {
    localStorage.setItem(KEY, JSON.stringify(next));
  }
  return next;
}
