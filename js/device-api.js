/** XTEINK reader LAN API — browser talks directly to the device. */
export class DeviceAPI {
  constructor(host = "e-paper.local") {
    this.setHost(host);
  }

  setHost(host) {
    const h = (host || "e-paper.local").replace(/^https?:\/\//, "").replace(/\/$/, "");
    this.host = h;
    this.baseUrl = `http://${h}`;
  }

  async ping(timeoutMs = 5000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/status`, { signal: ctrl.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  async getStatus() {
    const data = await this._json("GET", "/status");
    return {
      fsType: data.type || "LittleFS",
      ok: data.isOk === "true" || data.isOk === true,
      totalBytes: Number(data.totalBytes) || 0,
      usedBytes: Number(data.usedBytes) || 0,
      deviceId: data.id || "",
      unsupportedFiles: data.unsupportedFiles || "",
    };
  }

  async getDeviceInfo() {
    const text = await this._text("GET", "/Read_staNameIp");
    const [deviceName, ip] = String(text).trim().split(/\s+/);
    return { deviceName: deviceName || "XT-EPD", ip: ip || "0.0.0.0" };
  }

  async listDir(dir = "/") {
    const normalized = dir.endsWith("/") ? dir : `${dir}/`;
    const items = await this._json("GET", `/list?dir=${encodeURIComponent(normalized)}`);
    if (!Array.isArray(items)) throw new Error("Invalid list response");
    return items.map((e) => ({
      name: e.name || "",
      type: e.type === "dir" ? "dir" : "file",
      size: Number(e.size) || 0,
      path: `${normalized}${e.name}${e.type === "dir" ? "/" : ""}`,
    }));
  }

  async upload(file, destPath, onProgress) {
    const path = destPath.startsWith("/") ? destPath : `/${destPath}`;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100);
          try {
            resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
          } catch {
            resolve(xhr.responseText);
          }
        } else {
          reject(new Error(`Upload failed: HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.ontimeout = () => reject(new Error("Upload timed out"));
      xhr.open("POST", `${this.baseUrl}/edit`);
      xhr.timeout = 120000;
      const fd = new FormData();
      fd.append("data", file, path);
      xhr.send(fd);
    });
  }

  async delete(path) {
    return this._json("DELETE", `/edit?path=${encodeURIComponent(path)}`);
  }

  async rename(src, dest) {
    const fd = new FormData();
    fd.append("path", dest);
    fd.append("src", src);
    return this._request("PUT", "/edit", fd);
  }

  move(src, dest) {
    return this.rename(src, dest);
  }

  async mkdir(parentDir, name) {
    const base = parentDir.endsWith("/") ? parentDir : `${parentDir}/`;
    const path = `${base}${name}/`;
    const fd = new FormData();
    fd.append("path", path);
    return this._request("PUT", "/edit", fd);
  }

  async _json(method, path) {
    const text = await this._request(method, path);
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async _text(method, path) {
    return this._request(method, path);
  }

  _request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
        else reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.ontimeout = () => reject(new Error("Request timed out"));
      xhr.open(method, `${this.baseUrl}${path}`);
      xhr.timeout = 10000;
      xhr.send(body);
    });
  }
}

const CACHE_KEY = "xtink-device-ip";

export function readIpCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.ts > (data.ttl || 3600000)) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeIpCache(ip, deviceName = "") {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ ip, deviceName, ts: Date.now(), ttl: 3600000 })
  );
}

export function parseIpFromUrl() {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  if (!p.has("ip")) return null;
  const ip = p.get("ip")?.replace(/^"|"$/g, "").trim();
  return ip || null;
}

/** Try ?ip= → cache → mDNS hostname → resolve IP via device. */
export async function resolveHost(api) {
  const fromUrl = parseIpFromUrl();
  if (fromUrl) {
    api.setHost(fromUrl);
    if (await api.ping(3000)) return fromUrl;
  }

  const cached = readIpCache();
  if (cached?.ip) {
    api.setHost(cached.ip);
    if (await api.ping(2000)) return cached.ip;
  }

  const hostname = "e-paper.local";
  api.setHost(hostname);
  if (await api.ping(5000)) {
    try {
      const info = await api.getDeviceInfo();
      if (info.ip && info.ip !== "0.0.0.0") {
        writeIpCache(info.ip, info.deviceName);
        api.setHost(info.ip);
        return info.ip;
      }
    } catch {
      /* keep hostname */
    }
    return hostname;
  }

  throw new Error("Cannot reach device. Same Wi‑Fi? Enter IP manually.");
}

export function joinPath(dir, name) {
  const base = dir.endsWith("/") ? dir : `${dir}/`;
  return `${base}${name}`;
}

export function normalizeDir(dir) {
  if (!dir || dir === "/") return "/";
  return dir.endsWith("/") ? dir : `${dir}/`;
}

export function parentDir(path) {
  const p = path.endsWith("/") ? path.slice(0, -1) : path;
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : `${p.slice(0, i)}/`;
}

export function moveDestPath(srcPath, destDir) {
  const isDir = srcPath.endsWith("/");
  const base = isDir ? srcPath.slice(0, -1) : srcPath;
  const name = base.split("/").pop();
  return joinPath(normalizeDir(destDir), name) + (isDir ? "/" : "");
}

/** Returns error message, or null if move is allowed. */
export function moveBlockedReason(src, destDir) {
  const dest = normalizeDir(destDir);
  if (src.endsWith("/") && (dest === src || dest.startsWith(src))) {
    return "Cannot move a folder into itself";
  }
  if (moveDestPath(src, dest) === src) return "Already in this folder";
  if (parentDir(src) === dest) return "Already in this folder";
  return null;
}

export function formatBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${parseFloat((n / 1024 ** i).toFixed(i ? 1 : 0))} ${u[i]}`;
}

/** ponytail: ceiling O(1) path join; upgrade path = add normalize/.. guard if needed */
export function _selfCheck() {
  console.assert(joinPath("/", "a.epub") === "/a.epub");
  console.assert(joinPath("/books", "x") === "/books/x");
  console.assert(moveDestPath("/a.epub", "/books") === "/books/a.epub");
  console.assert(moveDestPath("/foo/", "/bar") === "/bar/foo/");
  console.assert(moveBlockedReason("/foo/", "/foo/bar/") !== null);
  console.assert(formatBytes(1536) === "1.5 KB");
  console.assert(parseIpFromUrl() === null || typeof parseIpFromUrl() === "string");
  console.log("device-api self-check ok");
}
