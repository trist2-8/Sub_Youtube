chrome.runtime.onInstalled.addListener(() => {
  console.log('Subtitle Grabber v4.2.0 installed');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'DOWNLOAD_TEXT') {
    const filename = sanitizeFilename(message.filename || 'subtitle-grabber.txt');
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

    return true;
  }

  if (message.type === 'OPEN_PINNED_WINDOW') {
    const tabId = Number(message.tabId);
    const url = chrome.runtime.getURL(`pinned.html${Number.isFinite(tabId) && tabId > 0 ? `?tabId=${tabId}` : ''}`);

    chrome.windows.create(
      {
        url,
        type: 'popup',
        width: 460,
        height: 360,
        focused: true,
      },
      (createdWindow) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ ok: true, windowId: createdWindow?.id || null });
      }
    );

    return true;
  }

  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

function sanitizeFilename(name) {
  return (
    String(name || 'subtitle-grabber')
      .replace(/[\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150) || 'subtitle-grabber'
  );
}
