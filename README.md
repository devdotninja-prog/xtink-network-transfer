# XTink Transfer

Custom web UI for XTEINK / 阅星曈 network file transfer. Static files only — the browser talks **directly** to the reader on your LAN (same model as [bofi.xteink.cn](http://bofi.xteink.cn)).

## Quick start

```bash
cd xtink-network-transfer
python3 -m http.server 8080
```

Open `http://localhost:8080/?ip=YOUR_DEVICE_IP` on a phone or PC on the **same Wi‑Fi** as the reader.

## Device API (implemented)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/status` | Storage + health |
| GET | `/Read_staNameIp` | Device name and IP |
| GET | `/list?dir=/path/` | List files |
| POST | `/edit` | Upload (`FormData`: `data` = file, filename = full path) |
| PUT | `/edit` | Rename (`src`, `path`) or mkdir (`path` ending in `/`) |
| DELETE | `/edit?path=…` | Delete file or folder |

## QR / deep link

Point your reader’s QR code at your hosted copy:

```
https://your-domain/xtink/index.html?ip=10.229.226.142
```

The `ip` query param is optional; the app also tries cached IP and `e-paper.local`.

## Supported uploads (device firmware)

- Books: EPUB, TXT
- Wallpapers: JPG, BMP (480×800)
- Fonts: BIN

## Notes

- Must be on the same network as the device (or its hotspot).
- WeChat in-app browser may block LAN access — open in Safari/Chrome.
- No build step, no npm. Host anywhere as static files.
