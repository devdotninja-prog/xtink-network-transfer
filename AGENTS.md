# XTink Transfer — agent guide

**XTink Transfer** is a static web UI for XTEINK / 阅星曈 e-paper readers. It replaces the official [bofi.xteink.cn](http://bofi.xteink.cn) file manager with a custom UX while using the same on-device HTTP API.

## Tech stack

| Layer | Choice |
|-------|--------|
| UI | Vanilla HTML + CSS + ES modules |
| Build | None — host as static files |
| Runtime | Browser only (phone or desktop on same LAN as reader) |
| Backend | None — browser talks **directly** to the reader |

## Commands

```bash
cd xtink-network-transfer
python3 -m http.server 8080
# http://localhost:8080/?ip=DEVICE_IP
```

Verify path helpers:

```bash
node --input-type=module -e "import { _selfCheck } from './js/device-api.js'; _selfCheck();"
```

No `npm install`, no bundler, no `.env`.

## Directory layout

```
xtink-network-transfer/
  index.html          # Shell + move dialog
  css/style.css       # E-paper inspired theme
  js/device-api.js    # Reader LAN client + path helpers + IP cache
  js/app.js           # UI state, file browser, uploads, move picker
  README.md           # User-facing usage
  .AGENTS.md          # This file
```

## Architecture

```
Static host (your server or python -m http.server)
    ↓ serves HTML/CSS/JS only
Browser (app.js)
    ↓ fetch / XMLHttpRequest to http://DEVICE_IP/...
XTEINK reader (embedded HTTP server on LAN)
```

**Rules:**

- **Never proxy device traffic** through your static host. Files and metadata stay on the LAN.
- **`device-api.js`** owns all device HTTP calls and pure path/IP helpers. No DOM access.
- **`app.js`** owns UI state and DOM. Calls `DeviceAPI` methods only.
- **Connection order:** `?ip=` query → `localStorage` cache → `e-paper.local` mDNS → `/Read_staNameIp` to cache real IP.

## Device API contract

Base URL: `http://{host}/` where `{host}` is an IP or `e-paper.local`.

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| GET | `/status` | — | Storage, `isOk`, filesystem type |
| GET | `/Read_staNameIp` | — | Plain text: `{deviceName} {ip}` |
| GET | `/list?dir=/path/` | — | JSON array: `{ name, type: "dir"\|"file", size }` |
| POST | `/edit` | `FormData`: field `data` = file; filename arg = full dest path | Upload |
| PUT | `/edit` | `FormData`: `path`, `src` | Rename / move |
| PUT | `/edit` | `FormData`: `path` ending in `/` | Create folder |
| DELETE | `/edit?path=…` | — | Delete file or folder |

Move/rename is the same operation: `PUT /edit` with `src` (old path) and `path` (new path). Use `moveDestPath()` and `moveBlockedReason()` in `device-api.js` before moving.

## `js/device-api.js` exports

| Export | Role |
|--------|------|
| `DeviceAPI` | Class: `ping`, `getStatus`, `getDeviceInfo`, `listDir`, `upload`, `delete`, `rename`, `move`, `mkdir` |
| `resolveHost` | Smart connect without manual IP |
| `parseIpFromUrl` | Read `?ip=` from `window.location` |
| `readIpCache` / `writeIpCache` | `localStorage` key `xtink-device-ip` |
| `joinPath`, `normalizeDir`, `parentDir`, `moveDestPath`, `moveBlockedReason` | Path logic for UI + move guardrails |
| `formatBytes` | Display helper |
| `_selfCheck` | Assert-based smoke test for path helpers |

## `js/app.js` responsibilities

- Connection UI and status bar (`/status`, `/Read_staNameIp`)
- File list with breadcrumbs, multi-select, drag-and-drop upload
- Per-row and batch **Move** via `<dialog id="move-dialog">` folder picker
- Toasts, upload progress panel

Global UI state lives in one `state` object at top of `app.js`. Prefer extending that over new globals.

## Coding conventions

Follow workspace **ponytail lazy senior** rules:

- No frameworks or new dependencies unless explicitly requested.
- No build step or TypeScript unless the user asks.
- Keep `device-api.js` free of DOM; keep `app.js` free of raw XHR except through `DeviceAPI`.
- Minimize scope — match existing naming, ES module style, and e-paper visual tokens in `css/style.css`.
- Non-trivial path/connection logic must keep `_selfCheck()` passing.
- Mark intentional shortcuts with `ponytail:` comments (name ceiling + upgrade path).

## Deep links

```
index.html?ip=10.229.226.142
```

Reader QR codes can point at any hosted copy of this app with the same `?ip=` param.

## Supported file types (device firmware)

- Books: EPUB, TXT
- Wallpapers: JPG, BMP (480×800)
- Fonts: BIN

TXT encoding detection (BOFI feature) is **not** implemented yet.

## Known constraints

- User must be on the **same Wi‑Fi or hotspot** as the reader.
- WeChat in-app browser often blocks LAN access — recommend Safari/Chrome.
- Reader Wi‑Fi is typically **2.4 GHz** only.
- CORS is not an issue when calling the device IP directly from a page served elsewhere (browser treats device as a different origin but simple requests usually work; uploads use `XMLHttpRequest` + `FormData`).

## Out of scope (unless explicitly requested)

- npm/Vite/React build pipeline
- Server-side proxy or cloud file storage
- User accounts or auth
- TXT charset conversion
- SD card advanced endpoints (`/Read_sdInit`, `/Put_sdFrequency`, etc.)

## Verification checklist

- [ ] `node --input-type=module -e "import { _selfCheck } from './js/device-api.js'; _selfCheck();"` prints ok
- [ ] Static server serves `index.html` at `/`
- [ ] With reader on LAN: connect via IP shows storage + file list
- [ ] Upload lands in current directory
- [ ] Move single file and multi-select move work; cannot move folder into itself
- [ ] `?ip=` auto-connects on load

## Adding features

1. Device behavior first — confirm endpoint in BOFI source or on-hardware before coding.
2. Add or extend methods on `DeviceAPI` in `device-api.js`.
3. Wire UI in `app.js` + `index.html` + `css/style.css` as needed.
4. Extend `_selfCheck()` if you add pure path/connection helpers.
5. Update `README.md` only when user-facing behavior changes.
