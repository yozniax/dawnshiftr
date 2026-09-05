# DAWNSHIFTr

A compact bedside radio for Chrome (or the local preview). Add a short note to each station, hide ones you don’t want, and use a sleep timer.

## Preview

```sh
npm start
```

Open `http://127.0.0.1:43187`. `/index.html` has install steps.

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
- Sleep timer: last ~15 seconds fade. PT (25 min) says “Your Time is up!” when it ends
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
| `S` | Stations tab |
| `P` | Sleep PT (25 min) |
| `Shift+F` / `T` / `H` / `C` | Fav / stations / history / countries |
| `Esc` | Fav / close |
| `?` | Shortcuts |

## License

MIT.
