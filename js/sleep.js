export const SLEEP_PRESETS = [180, 120, 60, 55, 30, 25, 10, 5, 3, 1];
export const FADE_MS = 15_000;
export const PT_MINUTES = 25;

export function sleepChipLabel(mins) {
  if (mins === 180) return "3h";
  if (mins === 120) return "2h";
  if (mins === 60) return "1h";
  if (mins === 25) return "PT";
  return String(mins);
}

export function isPomodoro(minutes) {
  return Number(minutes) === PT_MINUTES;
}

export function fadeAmount(remainingMs, { fadeMs = FADE_MS, skipFade = false } = {}) {
  if (remainingMs == null) return 1;
  if (skipFade) return 1;
  if (remainingMs >= fadeMs) return 1;
  return Math.max(0, remainingMs / fadeMs);
}

export function formatSleepRemain(ms) {
  const sec = Math.max(0, Math.ceil(Number(ms) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function sleepClock(state) {
  const remaining = state?.sleepEndsAt
    ? state.sleepRemainingMs ?? Math.max(0, state.sleepEndsAt - Date.now())
    : 0;
  if (!state?.sleepEndsAt) {
    return { text: "SLEEP", counting: false, fading: false, remaining };
  }
  const pt = isPomodoro(state.sleepMinutes);
  const remain = formatSleepRemain(remaining);
  return {
    text: pt ? `POMODORO ENDS AT ${remain}` : `SLEEPING IN ${remain}`,
    counting: true,
    fading: !pt && remaining <= FADE_MS,
    remaining,
  };
}
