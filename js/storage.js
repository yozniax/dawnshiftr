const KEY = "broamp-state-v2";

function chromeStorage() {
  return globalThis.chrome?.storage?.local;
}

export async function loadPersisted() {
  const api = chromeStorage();
  if (api) {
    const bag = await api.get(KEY);
    return bag[KEY] || {};
  }
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
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
