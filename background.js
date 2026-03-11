chrome.runtime.onInstalled.addListener(() => {
  console.log('YT Subtitle Grabber v3 installed');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'DOWNLOAD_TEXT') {
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
    String(name || 'youtube-subtitles')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150) || 'youtube-subtitles'
  );
}