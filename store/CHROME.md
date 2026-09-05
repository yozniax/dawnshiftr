# Ship DAWNSHIFTr as a Chrome extension

The player is a Manifest V3 extension. Toolbar click opens a compact window. Audio keeps playing in an offscreen document if you close that window.

## Load unpacked (local)

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → choose this repository folder (the one that contains `manifest.json`)
4. Pin DAWNSHIFTr on the toolbar
5. Click the icon. A YouTube tab in Chrome starts here so you can set sleep.

Right-click the toolbar icon for a tab or side-panel view.

Do not load the `dist/` folder. Load the repo root.

## Zip for the Chrome Web Store

```sh
npm run pack
```

Upload `dist/dawnshiftr-chrome.zip` at [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

A one-time Google developer registration fee is required. This repo cannot publish for you; sign in with the Google account that should own the listing.

## Listing fields (paste)

**Name:** DAWNSHIFTr

**Summary:** Bedside internet radio. Station notes, sleep timer, live titles, and play the current YouTube tab.

**Category:** Entertainment

**Language:** English

**Description:**

```
DAWNSHIFTr is a compact bedside radio for Chrome.

• Search Radio Browser stations, keep favorites, and hide stations you do not want
• Add a one-line note to any station
• Sleep timer with a last-15-second fade (PT / Pomodoro stops without fading)
• Live song title when the stream sends ICY metadata
• Click the toolbar icon on a YouTube tab to play that video here with a sleep timer
• Playback continues after you close the player window

Keyboard: Space play/pause, Enter play the highlighted row, arrows move, F / N / X fav note delete, P pomodoro, S stations, Esc favorites.

Usage stats are anonymous and can be turned off from the Keybind dialog (ℹ or ?). Privacy: https://github.com/yozniax/dawnshiftr/blob/main/privacy.html
```

**Privacy policy URL** (required because usage stats exist):

https://github.com/yozniax/dawnshiftr/blob/main/privacy.html

Screenshots for the listing: `store/screenshots/` (1280×800). Upload at least one of the player shots in the dashboard. Take a STATIONS / playing shot from your own Chrome after Load unpacked if you want a fuller listing.

## Permission justifications (reviewer form)

| Permission | Why |
| --- | --- |
| `sidePanel` | Optional side-panel player |
| `offscreen` | Keep radio / YouTube audio playing when the window is closed |
| `storage` | Favorites, notes, volume, sleep, stats opt-out |
| `declarativeNetRequest` | Relax CORS on radio streams so the level meter can read audio |
| `contextMenus` | Open window / tab / side panel; play this YouTube page |
| `commands` | Media keys and Ctrl+Shift+P to open the player |
| `alarms` | Sleep timer backup if the offscreen page is suspended |
| `tabs` | Find an open YouTube tab to play in the player |
| `activeTab` | Play the tab you clicked the toolbar icon on |
| Host access `<all_urls>` | Station streams are arbitrary http(s) URLs. The player also fetches ICY titles and Radio Browser search. |

Single purpose: internet radio (plus the current YouTube tab in the same player). No other browsing data is read.

## After publish

Updates: bump `version` in `manifest.json`, `npm run pack`, upload a new zip on the same listing.
