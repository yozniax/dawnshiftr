export const THEMES = {
  lamp: {
    bg: "#16110d",
    "bg-elev": "#221a14",
    "bg-card": "#2a2119",
    accent: "#e4a15a",
    text: "#f3e6d4",
    muted: "#a8927c",
    line: "#3d3228",
    warn: "#f0b45a",
    danger: "#e07a62",
  },
  tide: {
    bg: "#0c1416",
    "bg-elev": "#132022",
    "bg-card": "#1a2a2d",
    accent: "#7ec9c0",
    text: "#e4f2f0",
    muted: "#8aa3a0",
    line: "#2a3d40",
    warn: "#e0c56a",
    danger: "#e08a8a",
  },
  paper: {
    bg: "#efe6d6",
    "bg-elev": "#f7f1e6",
    "bg-card": "#fffaf2",
    accent: "#c45c26",
    text: "#2c241c",
    muted: "#7a6d5e",
    line: "#e0d4c2",
    warn: "#b07a18",
    danger: "#b44532",
  },
};

export const THEME_NAMES = Object.keys(THEMES);

export function applyTheme(name) {
  const theme = THEMES[name] || THEMES.lamp;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme)) {
    root.style.setProperty(`--${key}`, value);
  }
}
