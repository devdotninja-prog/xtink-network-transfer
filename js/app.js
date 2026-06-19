import {
  DeviceAPI,
  resolveHost,
  writeIpCache,
  parseIpFromUrl,
  joinPath,
  formatBytes,
  normalizeDir,
  moveDestPath,
  moveBlockedReason,
  parentDir,
  _selfCheck,
} from "./device-api.js";

const api = new DeviceAPI();
const state = {
  connected: false,
  host: "",
  deviceName: "",
  cwd: "/",
  entries: [],
  selected: new Set(),
  status: null,
  moveSources: [],
  movePickerCwd: "/",
  moveFolders: [],
};

const $ = (sel) => document.querySelector(sel);

function toast(msg, kind = "info") {
  const el = $("#toast");
  el.textContent = msg;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 3500);
}

function setConnUI(connected, message = "") {
  state.connected = connected;
  document.body.dataset.connected = connected ? "yes" : "no";
  $("#conn-dot").dataset.state = connected ? "online" : "offline";
  $("#conn-label").textContent = connected
    ? `${state.deviceName || "Device"} · ${state.host}`
    : message || "Offline";
}

function renderBreadcrumb() {
  const parts = state.cwd.split("/").filter(Boolean);
  const root = document.createElement("button");
  root.type = "button";
  root.className = "crumb";
  root.textContent = "root";
  root.onclick = () => navigate("/");
  $("#breadcrumb").replaceChildren(root);

  let acc = "";
  for (const p of parts) {
    acc += `/${p}`;
    const sep = document.createElement("span");
    sep.className = "crumb-sep";
    sep.textContent = "/";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "crumb";
    btn.textContent = p;
    const path = `${acc}/`;
    btn.onclick = () => navigate(path);
    $("#breadcrumb").append(sep, btn);
  }
}

function iconFor(entry) {
  if (entry.type === "dir") return "▸";
  const n = entry.name.toLowerCase();
  if (/\.(epub|txt|pdf|mobi)$/.test(n)) return "◈";
  if (/\.(jpg|jpeg|png|bmp|gif)$/.test(n)) return "◫";
  if (/\.(bin)$/.test(n)) return "A";
  return "·";
}

function renderFiles() {
  const list = $("#file-list");
  list.replaceChildren();

  const sorted = [...state.entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  if (!sorted.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Empty folder — drop files here to upload";
    list.append(empty);
    return;
  }

  for (const e of sorted) {
    const row = document.createElement("div");
    row.className = "file-row";
    row.dataset.path = e.path;
    row.dataset.type = e.type;
    if (state.selected.has(e.path)) row.classList.add("selected");

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = state.selected.has(e.path);
    check.onchange = () => {
      if (check.checked) state.selected.add(e.path);
      else state.selected.delete(e.path);
      row.classList.toggle("selected", check.checked);
      updateSelectionBar();
    };

    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.textContent = iconFor(e);

    const name = document.createElement("button");
    name.type = "button";
    name.className = "file-name";
    name.textContent = e.name;
    name.onclick = () => {
      if (e.type === "dir") navigate(e.path);
      else state.selected.add(e.path), renderFiles(), updateSelectionBar();
    };

    const size = document.createElement("span");
    size.className = "file-size";
    size.textContent = e.type === "dir" ? "—" : formatBytes(e.size);

    const actions = document.createElement("div");
    actions.className = "file-actions";
    const ren = document.createElement("button");
    ren.type = "button";
    ren.textContent = "Rename";
    ren.onclick = () => renameEntry(e);
    const mov = document.createElement("button");
    mov.type = "button";
    mov.textContent = "Move";
    mov.onclick = () => openMoveDialog([e.path]);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "Delete";
    del.onclick = () => deleteEntry(e);
    actions.append(ren, mov, del);

    row.append(check, icon, name, size, actions);
    list.append(row);
  }
}

function updateSelectionBar() {
  const n = state.selected.size;
  $("#selection-bar").hidden = n === 0;
  $("#sel-count").textContent = `${n} selected`;
}

function renderStatus() {
  const s = state.status;
  if (!s) return;
  const free = s.totalBytes - s.usedBytes;
  $("#storage-text").textContent = `${formatBytes(free)} free of ${formatBytes(s.totalBytes)}`;
  $("#storage-bar").style.width = s.totalBytes
    ? `${Math.round((s.usedBytes / s.totalBytes) * 100)}%`
    : "0%";
  $("#fs-type").textContent = s.fsType;
  $("#device-id").textContent = s.deviceId || "—";
}

async function navigate(dir) {
  state.cwd = dir.endsWith("/") ? dir : `${dir}/`;
  state.selected.clear();
  updateSelectionBar();
  renderBreadcrumb();
  await refreshList();
}

async function refreshList() {
  try {
    state.entries = await api.listDir(state.cwd);
    renderFiles();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function connect(manualIp) {
  const ipInput = $("#ip-input").value.trim();
  const host = manualIp || ipInput || parseIpFromUrl();
  if (host) api.setHost(host);

  setConnUI(false, "Connecting…");
  $("#connect-btn").disabled = true;

  try {
    const resolved = host ? (api.setHost(host), host) : await resolveHost(api);
    if (!(await api.ping())) throw new Error("Device not responding");

    api.setHost(resolved);
    state.host = resolved;
    const [status, info] = await Promise.all([api.getStatus(), api.getDeviceInfo()]);
    state.status = status;
    state.deviceName = info.deviceName;
    writeIpCache(resolved, info.deviceName);

    setConnUI(true);
    renderStatus();
    await navigate(state.cwd);
    toast(`Connected to ${info.deviceName}`, "ok");
  } catch (err) {
    setConnUI(false, "Offline");
    toast(err.message, "error");
  } finally {
    $("#connect-btn").disabled = false;
  }
}

async function uploadFiles(files) {
  if (!state.connected) return toast("Connect to device first", "error");
  const arr = [...files];
  if (!arr.length) return;

  const panel = $("#upload-panel");
  panel.hidden = false;
  const items = $("#upload-items");
  items.replaceChildren();

  for (const file of arr) {
    const dest = joinPath(state.cwd, file.name);
    const row = document.createElement("div");
    row.className = "upload-row";
    row.innerHTML = `<span class="upload-name"></span><div class="upload-track"><div class="upload-fill"></div></div><span class="upload-pct">0%</span>`;
    row.querySelector(".upload-name").textContent = file.name;
    items.append(row);
    const fill = row.querySelector(".upload-fill");
    const pct = row.querySelector(".upload-pct");

    try {
      await api.upload(file, dest, (p) => {
        fill.style.width = `${p}%`;
        pct.textContent = `${p}%`;
      });
      row.classList.add("done");
      pct.textContent = "✓";
    } catch (err) {
      row.classList.add("fail");
      pct.textContent = "✗";
      toast(`${file.name}: ${err.message}`, "error");
    }
  }

  await refreshList();
  setTimeout(() => {
    panel.hidden = true;
  }, 2000);
}

async function deleteEntry(entry) {
  if (!confirm(`Delete ${entry.name}?`)) return;
  try {
    await api.delete(entry.path);
    state.selected.delete(entry.path);
    toast("Deleted", "ok");
    await refreshList();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function renameEntry(entry) {
  const next = prompt("New name", entry.name);
  if (!next || next === entry.name) return;
  const parent = state.cwd;
  const dest = joinPath(parent, next) + (entry.type === "dir" ? "/" : "");
  try {
    await api.rename(entry.path, dest);
    toast("Renamed", "ok");
    await refreshList();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function deleteSelected() {
  if (!state.selected.size) return;
  if (!confirm(`Delete ${state.selected.size} item(s)?`)) return;
  for (const path of [...state.selected]) {
    try {
      await api.delete(path);
    } catch (err) {
      toast(`${path}: ${err.message}`, "error");
    }
  }
  state.selected.clear();
  updateSelectionBar();
  await refreshList();
}

async function createFolder() {
  const name = prompt("Folder name");
  if (!name?.trim()) return;
  try {
    await api.mkdir(state.cwd, name.trim());
    toast("Folder created", "ok");
    await refreshList();
  } catch (err) {
    toast(err.message, "error");
  }
}

function basename(path) {
  const p = path.endsWith("/") ? path.slice(0, -1) : path;
  return p.split("/").pop() || path;
}

function renderMoveBreadcrumb() {
  const parts = state.movePickerCwd.split("/").filter(Boolean);
  const nav = $("#move-breadcrumb");
  const root = document.createElement("button");
  root.type = "button";
  root.className = "crumb";
  root.textContent = "root";
  root.onclick = () => movePickerNavigate("/");
  nav.replaceChildren(root);

  let acc = "";
  for (const p of parts) {
    acc += `/${p}`;
    const sep = document.createElement("span");
    sep.className = "crumb-sep";
    sep.textContent = "/";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "crumb";
    btn.textContent = p;
    const path = `${acc}/`;
    btn.onclick = () => movePickerNavigate(path);
    nav.append(sep, btn);
  }
}

function updateMoveHereButton() {
  const dest = normalizeDir(state.movePickerCwd);
  const blocked = state.moveSources.map((s) => moveBlockedReason(s, dest)).find(Boolean);
  const btn = $("#move-here-btn");
  btn.disabled = !!blocked;
  $("#move-hint").textContent = blocked || `Destination: ${dest}`;
}

async function renderMovePicker() {
  renderMoveBreadcrumb();
  const list = $("#move-folder-list");
  list.replaceChildren();

  try {
    const entries = await api.listDir(state.movePickerCwd);
    state.moveFolders = entries.filter((e) => e.type === "dir");
    const blockedSet = new Set(
      state.moveSources.filter((s) => s.endsWith("/")).map((s) => normalizeDir(s))
    );

    if (!state.moveFolders.length) {
      const empty = document.createElement("p");
      empty.className = "move-empty";
      empty.textContent = "No subfolders — use Move here for this location";
      list.append(empty);
    } else {
      for (const dir of state.moveFolders) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "move-folder-row";
        const isBlocked = [...blockedSet].some(
          (src) => dir.path === src || dir.path.startsWith(src)
        );
        row.disabled = isBlocked;
        row.innerHTML = `<span class="file-icon">▸</span><span>${dir.name}</span>`;
        row.onclick = () => !isBlocked && movePickerNavigate(dir.path);
        list.append(row);
      }
    }
  } catch (err) {
    const errEl = document.createElement("p");
    errEl.className = "move-empty";
    errEl.textContent = err.message;
    list.append(errEl);
  }

  updateMoveHereButton();
}

async function movePickerNavigate(dir) {
  state.movePickerCwd = normalizeDir(dir);
  await renderMovePicker();
}

async function openMoveDialog(sources) {
  if (!sources.length) return;
  state.moveSources = sources;
  state.movePickerCwd = normalizeDir(parentDir(sources[0]));

  const names = sources.map(basename).join(", ");
  $("#move-sources").textContent =
    sources.length === 1 ? `Moving: ${names}` : `Moving ${sources.length} items: ${names}`;

  const dlg = $("#move-dialog");
  dlg.showModal();
  await renderMovePicker();
}

function closeMoveDialog() {
  $("#move-dialog").close();
  state.moveSources = [];
}

async function executeMove() {
  const dest = normalizeDir(state.movePickerCwd);
  const sources = [...state.moveSources];
  const blocked = sources.map((s) => moveBlockedReason(s, dest)).find(Boolean);
  if (blocked) return toast(blocked, "error");

  closeMoveDialog();
  let ok = 0;
  for (const src of sources) {
    const target = moveDestPath(src, dest);
    try {
      await api.move(src, target);
      state.selected.delete(src);
      ok++;
    } catch (err) {
      toast(`${basename(src)}: ${err.message}`, "error");
    }
  }
  if (ok) {
    toast(ok === 1 ? "Moved" : `Moved ${ok} items`, "ok");
    updateSelectionBar();
    await refreshList();
  }
}

function setupDropZone() {
  const zone = $("#drop-zone");
  for (const ev of ["dragenter", "dragover"]) {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add("dragover");
    });
  }
  for (const ev of ["dragleave", "drop"]) {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
    });
  }
  zone.addEventListener("drop", (e) => uploadFiles(e.dataTransfer.files));
}

function init() {
  _selfCheck();

  const qip = parseIpFromUrl();
  if (qip) $("#ip-input").value = qip;

  $("#connect-btn").onclick = () => connect();
  $("#refresh-btn").onclick = () => state.connected && refreshList();
  $("#mkdir-btn").onclick = createFolder;
  $("#file-input").onchange = (e) => uploadFiles(e.target.files);
  $("#upload-btn").onclick = () => $("#file-input").click();
  $("#delete-sel-btn").onclick = deleteSelected;
  $("#move-sel-btn").onclick = () => openMoveDialog([...state.selected]);
  $("#clear-sel-btn").onclick = () => {
    state.selected.clear();
    updateSelectionBar();
    renderFiles();
  };

  $("#move-here-btn").onclick = executeMove;
  $("#move-cancel-btn").onclick = closeMoveDialog;
  $("#move-close-btn").onclick = closeMoveDialog;
  $("#move-dialog").addEventListener("cancel", closeMoveDialog);

  setupDropZone();
  if (qip) connect(qip);
}

init();
