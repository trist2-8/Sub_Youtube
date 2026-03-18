const PIN_PREFS_KEY = 'ytSubtitleGrabberPinPrefsV1';
const DEFAULT_PIN_PREFS = {
  default: { width: 780, height: 560, mode: 'dual', syncPreset: 'smooth' },
  youtube: { width: 780, height: 560, mode: 'dual', syncPreset: 'smooth' },
  netflix: { width: 920, height: 620, mode: 'review', syncPreset: 'smooth' },
};

const pinWindowRegistry = new Map();
const windowKeyRegistry = new Map();

chrome.runtime.onInstalled.addListener(() => {
  console.log('YT Subtitle Grabber v4.12.0 installed');
});

chrome.windows.onRemoved.addListener((windowId) => {
  const key = windowKeyRegistry.get(windowId);
  if (!key) return;
  windowKeyRegistry.delete(windowId);
  pinWindowRegistry.delete(key);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'DOWNLOAD_TEXT') {
    handleDownloadText(message, sendResponse);
    return true;
  }

  if (message.type === 'OPEN_PINNED_WINDOW') {
    openPinnedWindow(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Không mở được cửa sổ ghim.' }));
    return true;
  }

  if (message.type === 'GET_PINNED_WINDOW_STATE') {
    handlePinnedWindowState(message, sendResponse);
    return true;
  }

  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

function handleDownloadText(message, sendResponse) {
  const filename = sanitizeFilename(message.filename || 'youtube-subtitles.txt');
  const content = typeof message.content === 'string' ? message.content : '';
  const mime = message.mime || 'text/plain;charset=utf-8';
  const url = `data:${mime},${encodeURIComponent(content)}`;

  chrome.downloads.download(
    {
      url,
      filename,
      saveAs: true,
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true, downloadId });
    }
  );
}

function handlePinnedWindowState(message, sendResponse) {
  const tabId = Number(message.tabId);
  const platform = normalizePlatform(message.platform);
  const key = getPinWindowKey(platform, tabId);
  const existingWindowId = pinWindowRegistry.get(key);

  if (existingWindowId == null) {
    sendResponse({ ok: true, isOpen: false, windowId: null });
    return;
  }

  chrome.windows.get(existingWindowId, {}, (existingWindow) => {
    if (chrome.runtime.lastError || !existingWindow?.id) {
      pinWindowRegistry.delete(key);
      windowKeyRegistry.delete(existingWindowId);
      sendResponse({ ok: true, isOpen: false, windowId: null });
      return;
    }

    sendResponse({
      ok: true,
      isOpen: true,
      windowId: existingWindowId,
      focused: Boolean(existingWindow.focused),
    });
  });
}

async function openPinnedWindow(message) {
  const tabId = Number(message?.tabId);
  const platform = normalizePlatform(message?.platform);
  const reopen = Boolean(message?.reopen);

  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error('Không tìm thấy tab video hợp lệ để ghim.');
  }

  const pinPrefs = await chrome.storage.local.get(PIN_PREFS_KEY);
  const prefs = resolvePinPrefs(pinPrefs?.[PIN_PREFS_KEY], platform);
  const pinUrl = buildPinnedUrl(tabId, platform, prefs.mode);
  const key = getPinWindowKey(platform, tabId);
  const existingWindowId = pinWindowRegistry.get(key);

  if (existingWindowId != null) {
    const existingWindow = await getWindowSafe(existingWindowId);
    if (existingWindow?.id) {
      if (!reopen) {
        await chrome.windows.update(existingWindow.id, { focused: true, width: prefs.width, height: prefs.height });
        return { ok: true, reused: true, windowId: existingWindow.id };
      }
      await chrome.windows.remove(existingWindow.id).catch(() => {});
    }
    pinWindowRegistry.delete(key);
    windowKeyRegistry.delete(existingWindowId);
  }

  const created = await chrome.windows.create({
    url: pinUrl,
    type: 'popup',
    focused: true,
    width: clampDimension(prefs.width, 380, 1400),
    height: clampDimension(prefs.height, 260, 1200),
  });

  if (!created?.id) {
    throw new Error('Chrome không tạo được cửa sổ ghim.');
  }

  pinWindowRegistry.set(key, created.id);
  windowKeyRegistry.set(created.id, key);
  return { ok: true, reused: false, windowId: created.id };
}

function resolvePinPrefs(savedPrefs, platform) {
  const merged = {
    default: { ...DEFAULT_PIN_PREFS.default, ...(savedPrefs?.default || {}) },
    youtube: { ...DEFAULT_PIN_PREFS.youtube, ...(savedPrefs?.youtube || {}) },
    netflix: { ...DEFAULT_PIN_PREFS.netflix, ...(savedPrefs?.netflix || {}) },
  };
  const key = platform === 'youtube' || platform === 'netflix' ? platform : 'default';
  const prefs = { ...merged.default, ...(merged[key] || {}) };

  if (prefs.mode === 'compact') {
    prefs.width = Math.min(Math.max(Number(prefs.width) || 520, 420), 760);
    prefs.height = Math.min(Math.max(Number(prefs.height) || 340, 260), 540);
  } else if (prefs.mode === 'review') {
    prefs.width = Math.max(Number(prefs.width) || 620, platform === 'netflix' ? 760 : 680);
    prefs.height = Math.max(Number(prefs.height) || 420, 560);
  } else {
    prefs.width = Math.max(Number(prefs.width) || 520, platform === 'netflix' ? 680 : 560);
    prefs.height = Math.max(Number(prefs.height) || 360, platform === 'netflix' ? 480 : 420);
  }

  return prefs;
}

function buildPinnedUrl(tabId, platform, mode) {
  const url = new URL(chrome.runtime.getURL('pinned.html'));
  url.searchParams.set('tabId', String(tabId));
  url.searchParams.set('platform', platform);
  url.searchParams.set('mode', mode || 'dual');
  return url.toString();
}

function normalizePlatform(platform) {
  return ['youtube', 'netflix'].includes(String(platform)) ? String(platform) : 'default';
}

function getPinWindowKey(platform, tabId) {
  return `${platform}:${Number(tabId) || 0}`;
}

function clampDimension(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function getWindowSafe(windowId) {
  return new Promise((resolve) => {
    chrome.windows.get(windowId, {}, (windowInfo) => {
      if (chrome.runtime.lastError || !windowInfo?.id) {
        resolve(null);
        return;
      }
      resolve(windowInfo);
    });
  });
}

function sanitizeFilename(name) {
  return (
    String(name || 'youtube-subtitles')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150) || 'youtube-subtitles'
  );
}

