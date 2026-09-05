# DAWNSHIFTr

A compact bedside radio for Chrome (or the local preview). Add a short note to each station, hide ones you don’t want, and use a sleep timer.

## Preview

```sh
npm start
```

Open `http://127.0.0.1:43187`. `/index.html` has install steps.

```sh
npm test
```

## Chrome extension

1. `chrome://extensions`
2. Developer mode on
3. Load unpacked → this folder
4. Click the toolbar icon for a small player window. If a YouTube tab is open, that video starts in DAWNSHIFTr so you can set a sleep timer.

Audio keeps playing in an offscreen document if you close the window.

## Features

- Radio Browser search (includes station notes), play history, country lists
- Station notes
- Hide a station with DELETE
- Sleep timer: last ~15 seconds fade, except PT (25 min), which stops without fading and says “Your Time is up!”
- STATIONS tab shows Radio Browser’s POPULAR TOP 50 until you search
- Play the current YouTube tab from the toolbar icon
- Live song title when the stream sends ICY metadata
- Equalizer-style level display while playing

## Keys

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `Enter` | Play cursor |
| `↑` / `↓` | Move cursor |
| `F` / `N` / `X` | Fav / note / delete highlighted |
| `-` / `=` | Volume down / up |
| `S` / `Shift+S` | Stations tab |
| `P` | Pomodoro (25 min) |
| `Shift+F` / `H` / `C` | Fav / history / countries |
| `Esc` | Fav / close |
| `?` | Shortcuts |

## Usage stats

The player sends anonymous listen stats (favorites, listen time per station, session counts, timezone/locale). Country and city are meant to be derived on the ingest server from the request address, which is not stored.

Preview ingest: `POST /v1/ingest` (writes `data/telemetry.jsonl`). Production endpoint is `js/telemetry.js` → `TELEMETRY_REMOTE` (`https://stats.doyo.be/v1/ingest`). Opt out from the Keybind dialog.

Reminder: the ingest host and admin screen to read this data are not built yet.

Privacy notice: `privacy.html`. A terms-of-service page is not required for this free player; a privacy policy is required if stats stay on for a public Chrome Web Store listing.

## License

MIT.
