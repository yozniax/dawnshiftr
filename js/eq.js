export function clampTone(db) {
  return Math.max(-12, Math.min(12, Math.round(Number(db) || 0)));
}

export const TONE_DEFAULT = { bass: 0, mid: 0, treble: 0 };
