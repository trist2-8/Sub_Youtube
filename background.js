const PIN_PREFS_KEY = "ytSubtitleGrabberPinPrefsV1";
const PINNED_HTML_URL = chrome.runtime.getURL("pinned.html");
const DEFAULT_PIN_PREFS = {
  default: { width: 980, height: 720, mode: "dual" },
  youtube: { width: 1040, height: 760, mode: "dual" },
  netflix: { width: 1220, height: 860, mode: "review" },
};

chrome.runtime.onInstalled.addListener(() => {
  console.log("YT Subtitle Grabber installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "DOWNLOAD_TEXT") {
    handleDownloadText(message, sendResponse);
    return true;
  }

  if (message.type === "OPEN_PINNED_WINDOW") {
    handleOpenPinnedWindow(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Không mở được cửa sổ ghim." }));
    return true;
  }

  if (message.type === "GET_PINNED_WINDOW_STATE") {
    handleGetPinnedWindowState(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Không đọc được trạng thái cửa sổ ghim." }));
    return true;
  }

  if (message.type === "PING") {
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

function handleDownloadText(message, sendResponse) {
  const filename = sanitizeFilename(message.filename || "youtube-subtitles.txt");
  const content = typeof message.content === "string" ? message.content : "";
  const mime = message.mime || "text/plain;charset=utf-8";
  const url = `data:${mime},${encodeURIComponent(content)}`;

  chrome.downloads.download({ url, filename, saveAs: true }, (downloadId) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      return;
    }
    sendResponse({ ok: true, downloadId });
  });
}

async function handleOpenPinnedWindow(message) {
  const rawTabId = Number(message?.tabId);
  if (!Number.isFinite(rawTabId) || rawTabId <= 0) {
    return { ok: false, error: "Không tìm thấy tab video để ghim." };
  }

  const platform = normalizePlatform(message?.platform);
  const reopen = Boolean(message?.reopen);
  const existing = reopen ? null : await findPinnedWindow(rawTabId, platform);

  if (existing?.windowId) {
    await chrome.windows.update(existing.windowId, { focused: true });
    if (existing.pinnedTabId) {
      await chrome.tabs.update(existing.pinnedTabId, { active: true });
    }
    return { ok: true, reused: true, windowId: existing.windowId, tabId: rawTabId, platform };
  }

  const prefs = await getPinPrefsForPlatform(platform);
  const url = buildPinnedUrl(rawTabId, platform, prefs.mode);
  const created = await chrome.windows.create({
    url,
    type: "popup",
    focused: true,
    width: clamp(Math.round(Number(prefs.width) || DEFAULT_PIN_PREFS.default.width), 520, 2200),
    height: clamp(Math.round(Number(prefs.height) || DEFAULT_PIN_PREFS.default.height), 420, 1600),
  });

  return {
    ok: true,
    reused: false,
    windowId: created?.id || null,
    pinnedTabId: created?.tabs?.[0]?.id || null,
    tabId: rawTabId,
    platform,
  };
}

async function handleGetPinnedWindowState(message) {
  const rawTabId = Number(message?.tabId);
  const platform = normalizePlatform(message?.platform);
  if (!Number.isFinite(rawTabId) || rawTabId <= 0) {
    return { ok: true, isOpen: false, windowId: null };
  }

  const existing = await findPinnedWindow(rawTabId, platform);
  if (!existing?.windowId) {
    return { ok: true, isOpen: false, windowId: null };
  }

  const win = await chrome.windows.get(existing.windowId);
  return {
    ok: true,
    isOpen: true,
    windowId: existing.windowId,
    focused: Boolean(win?.focused),
    pinnedTabId: existing.pinnedTabId || null,
  };
}

async function findPinnedWindow(targetTabId, platform) {
  const tabs = await chrome.tabs.query({ url: `${PINNED_HTML_URL}*` });
  for (const tab of tabs) {
    try {
      const url = new URL(tab.url || "");
      if (!url.href.startsWith(PINNED_HTML_URL)) continue;
      const linkedTabId = Number(url.searchParams.get("tabId"));
      const linkedPlatform = normalizePlatform(url.searchParams.get("platform"));
      if (linkedTabId !== targetTabId) continue;
      if (platform && linkedPlatform && linkedPlatform !== platform) continue;
      if (!tab.windowId) continue;
      return { windowId: tab.windowId, pinnedTabId: tab.id || null, url: tab.url || "" };
    } catch {
      // ignore malformed URL
    }
  }
  return null;
}

async function getPinPrefsForPlatform(platform) {
  const stored = await chrome.storage.local.get(PIN_PREFS_KEY).catch(() => ({}));
  const allPrefs = stored?.[PIN_PREFS_KEY] && typeof stored[PIN_PREFS_KEY] === "object" ? stored[PIN_PREFS_KEY] : {};
  const base = { ...DEFAULT_PIN_PREFS.default, ...(DEFAULT_PIN_PREFS[platform] || {}) };
  const saved = allPrefs?.[platform] && typeof allPrefs[platform] === "object" ? allPrefs[platform] : {};
  return { ...base, ...saved };
}

function buildPinnedUrl(tabId, platform, mode) {
  const params = new URLSearchParams();
  params.set("tabId", String(tabId));
  if (platform) params.set("platform", platform);
  if (mode) params.set("mode", mode);
  return `${PINNED_HTML_URL}?${params.toString()}`;
}

function normalizePlatform(value) {
  const raw = String(value || "").toLowerCase();
  return raw === "youtube" || raw === "netflix" ? raw : "default";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeFilename(name) {
  return (
    String(name || "youtube-subtitles")
      .replace(/[\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 150) || "youtube-subtitles"
  );
}
