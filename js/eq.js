export const EQ_BANDS = [70, 180, 320, 600, 1000, 3000, 6000, 12000, 14000, 16000];

export const EQ_LABELS = ["70", "180", "320", "600", "1k", "3k", "6k", "12k", "14k", "16k"];

export const EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Rock: [5, 4, 2, -1, -2, 2, 4, 5, 5, 5],
  Pop: [2, 1, 0, 2, 4, 4, 2, 0, 1, 2],
  Jazz: [4, 3, 1, 2, -2, -2, 0, 2, 3, 4],
  Classical: [5, 4, 3, 2, -1, -1, 0, 2, 3, 4],
  Electronic: [4, 3, 0, -2, -1, 2, 4, 5, 5, 6],
  "Bass Boost": [8, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  "Treble Boost": [0, 0, 0, 0, 0, 2, 4, 6, 7, 8],
  Vocal: [-2, -1, 0, 2, 5, 5, 3, 1, 0, -1],
  Acoustic: [4, 3, 2, 1, 2, 2, 3, 3, 2, 1],
};

export const EQ_PRESET_NAMES = Object.keys(EQ_PRESETS);

export function clampGain(db) {
  return Math.max(-12, Math.min(12, db));
}

export function formatGain(db) {
  if (db > 0) return `+${db}`;
  return String(db);
}

export function nextPreset(name) {
  const i = EQ_PRESET_NAMES.indexOf(name);
  if (i < 0) return EQ_PRESET_NAMES[0];
  return EQ_PRESET_NAMES[(i + 1) % EQ_PRESET_NAMES.length];
}
