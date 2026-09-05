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
4. Click the toolbar icon for a small player window

Audio keeps playing in an offscreen document if you close the window.

## Features

- Radio Browser search, play history, country lists
- Station notes
- Hide a station with DELETE (Show hidden restores them)
- Sleep timer: last ~15 seconds fade, remaining time counts down
- Live song title when the stream sends ICY metadata
- Equalizer-style level display while playing

## Keys

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `Enter` | Play cursor |
| `↑` / `↓` | Move cursor |
| `F` / `M` / `X` | Fav / note / delete highlighted |
| `Shift+F` / `T` / `H` / `C` / `I` | Fav / stations / history / countries / index |
| `S` | Sleep 10 min |
| `Esc` | Index / close |
| `?` | Shortcuts |

## License

MIT.
