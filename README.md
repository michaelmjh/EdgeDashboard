# 🦆 Duck Dashboard

*DuckGenerator Dashboard Edition.* A Manifest V3 extension for Microsoft Edge and Google Chrome that replaces the New Tab page with a friendly productivity dashboard.

- Greeting, date and clock (updates every minute)
- Google and DuckDuckGo search, each with its own 10 recent searches
- Quick links: add, edit, delete, drag to reorder
- Five colour-coded sticky notes with auto-save, counts and timestamps
- Weather for Glasgow, London, Edinburgh or anywhere else
- Light, dark or system theme

No frameworks, no CDNs, no backend. Everything is stored in `chrome.storage.local`.

## Install

1. Open `edge://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.
4. Open a new tab. Edge may ask whether to keep the new page; choose **Keep changes**.

## Sync with Sticky Notes

If the Sticky Notes extension (michaelmjh/NotepadExtension) is installed in the same browser, the five notes sync both ways as you type. The link icon beside the notes title shows when it's connected; Settings → Notes shows the status.

First-time link: load both extensions, then click **Reload** on Sticky Notes once in the extensions page.

The dashboard has a fixed extension ID (`kgnlnhdenhgddbggpccmpodgogfhkggh`) from the `key` in `manifest.json`, so Sticky Notes can find it. Edits made while one side is missing are kept and merged when both are back. If both change the same note at once, the latest edit wins.

## Weather setup

Weather works straight away with demo data. For live weather, open **Settings → Weather** and either:

- **OpenWeatherMap**: create a free account at openweathermap.org, copy your key from *API keys*, paste it in and save. New keys can take a couple of hours to activate.
- **Open-Meteo**: pick it as the provider. Free, no key.

Results are cached for 30 minutes. There is no background polling; use the refresh button for an instant update.

Adding a provider: call `WeatherService.registerProvider(id, { label, needsKey, fetch(location, prefs) })` in `weather.js` and return the normalised shape documented at the top of that file.

## Keyboard

| Keys | Action |
| --- | --- |
| Ctrl + 1 to 5 | Switch note (Alt + 1 to 5 also works, in case the browser keeps Ctrl + number for tabs) |
| ← → on note tabs | Move between notes |
| ↓ ↑ in a search box | Browse recent searches |
| Alt + ← → on a quick link | Move the link |
| Esc | Close dialogs and menus |

## Files

- `manifest.json`
- `newtab.html`, `newtab.css`, `newtab.js` (header, search, links, notes, weather widget)
- `weather.js` (provider layer and icons)
- `storage.js` (storage wrapper, defaults, theme boot)
- `settings.js` (settings dialog)
- `notesync.js`, `background.js` (Sticky Notes sync)
- `icons/` (16, 48 and 128 px)

## Permissions

- `storage`: saves your notes, links and settings locally
- `favicon`: shows site icons on quick links, read from the browser's own cache
- Host access to OpenWeatherMap and Open-Meteo only, for weather
