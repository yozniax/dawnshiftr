# Ship DAWNSHIFTr as a Chrome extension

The player is a Manifest V3 extension. Toolbar click opens a popup from the pin. Audio keeps playing in an offscreen document if you close that popup.

## Load unpacked (local)

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → choose `dist/chrome` (created by `npm run pack`)
4. Pin DAWNSHIFTr on the toolbar
5. Click the icon to open the player popup.

Right-click the toolbar icon for a separate window or tab.

Do not load the repository root. That folder includes the preview server (`npm start` / `http://127.0.0.1:43187`), which is not how the extension plays radio. After changing code, run `npm run pack` again, then click **Reload** on `chrome://extensions`.

## Zip for the Chrome Web Store

```sh
npm run pack
```

Upload `dist/dawnshiftr-chrome.zip` at [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

A one-time Google developer registration fee is required. This repo cannot publish for you; sign in with the Google account that should own the listing.

## Listing fields (paste)

**Name:** DAWNSHIFTr

**Summary:** Bedside internet radio. Station notes, sleep timer, live titles.

**Category:** Entertainment

**Language:** English

**Description:**

```
DAWNSHIFTr is a compact bedside radio for Chrome.

• Search Radio Browser stations, keep favorites, and hide stations you do not want
• Add a one-line note to any station
• Sleep timer with a last-15-second fade (PT / Pomodoro stops without fading)
• Live song title when the stream sends ICY metadata
• Radio playback continues after you close the player window

Keyboard: Space play/pause, Enter play the highlighted row, arrows move, F / N / X fav note delete, P pomodoro, S stations, Esc favorites.

Usage stats are anonymous and can be turned off from the Keybind dialog (ℹ or ?). Privacy: https://github.com/yozniax/dawnshiftr/blob/main/privacy.html
```

**Privacy policy URL** (required because usage stats exist):

https://github.com/yozniax/dawnshiftr/blob/main/privacy.html

Screenshots for the listing: `store/screenshots/` (1280×800). Upload at least one of the player shots in the dashboard. Take a STATIONS / playing shot from your own Chrome after Load unpacked if you want a fuller listing.

## Permission justifications (reviewer form)

| Permission | Why |
| --- | --- |
| `offscreen` | Keep radio playing when the window is closed |
| `storage` | Favorites, notes, volume, sleep, stats opt-out |
| `cookies` | Restore snapshot on `www.doyo.be/dawnshiftr-backup` so favorites survive Remove + reinstall. Not used to read other sites. |
| `declarativeNetRequest` | Relax CORS on radio streams so the level meter can read audio |
| `declarativeNetRequestWithHostAccess` | Send the same Radio Browser User-Agent the local preview uses |
| `contextMenus` | Open window or tab |
| `commands` | Media keys and Ctrl+Shift+P to open the player |
| `alarms` | Sleep timer backup if the offscreen page is suspended |
| Host access `<all_urls>` | Station streams are arbitrary http(s) URLs. The player also fetches ICY titles and Radio Browser search. |

Single purpose: internet radio. No other browsing data is read.

## After publish

Updates: bump `version` in `manifest.json`, `npm run pack`, upload a new zip on the same listing.
