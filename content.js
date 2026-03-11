(() => {
  const BRIDGE_SCRIPT_ID = 'ytsg-page-bridge';
  const REQUEST_EVENT = 'ytsg:request';
  const RESPONSE_EVENT = 'ytsg:response';
  const BRIDGE_READY_EVENT = 'ytsg:bridge-ready';
  const DEFAULT_TIMEOUT_MS = 15000;
  let requestCounter = 0;
  const pendingRequests = new Map();

  ensureBridge();
  window.addEventListener(RESPONSE_EVENT, onBridgeResponse);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || 'Content script error',
          debug: [formatError(error)],
        });
      });
    return true;
  });

  function ensureBridge() {
    if (document.getElementById(BRIDGE_SCRIPT_ID)) return;
    const script = document.createElement('script');
    script.id = BRIDGE_SCRIPT_ID;
    script.src = chrome.runtime.getURL('page-bridge.js');
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
  }

  function onBridgeResponse(event) {
    const detail = event.detail || {};
    const requestId = detail.requestId;
    if (!requestId || !pendingRequests.has(requestId)) return;
    const pending = pendingRequests.get(requestId);
    clearTimeout(pending.timer);
    pendingRequests.delete(requestId);
    pending.resolve(detail.payload);
  }

  function askBridge(action, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      ensureBridge();
      const requestId = `req_${Date.now()}_${++requestCounter}`;
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error(`Bridge timeout for ${action}`));
      }, timeoutMs);

      pendingRequests.set(requestId, { resolve, reject, timer });
      window.dispatchEvent(
        new CustomEvent(REQUEST_EVENT, {
          detail: { requestId, action, payload },
        })
      );
    });
  }

  async function handleMessage(message) {
    if (!message || typeof message !== 'object') {
      return { ok: false, error: 'Invalid message.' };
    }

    if (message.type === 'GET_TRACKS') {
      return askBridge('GET_METADATA', {});
    }

    if (message.type === 'FETCH_TRACK') {
      const track = message.track;
      if (!track) {
        return { ok: false, error: 'Thiếu track để tải.' };
      }

      const bridgeResult = await askBridge('FETCH_TRACK', { track }, 25000);
      if (bridgeResult?.ok && Array.isArray(bridgeResult.cues) && bridgeResult.cues.length) {
        return bridgeResult;
      }

      const fallbackResult = await extractTranscriptFromPanel(track);
      fallbackResult.debug = [
        ...(bridgeResult?.debug || []),
        '--- Transcript panel fallback ---',
        ...(fallbackResult?.debug || []),
      ];

      if (fallbackResult.ok) {
        return fallbackResult;
      }

      return {
        ok: false,
        error:
          fallbackResult.error ||
          bridgeResult?.error ||
          'Không tải được phụ đề bằng timedtext hay transcript panel.',
        debug: fallbackResult.debug,
      };
    }

    if (message.type === 'EXTRACT_PANEL_ONLY') {
      return extractTranscriptFromPanel(message.track || null);
    }

    if (message.type === 'PING') {
      return { ok: true, source: 'content-script' };
    }

    return { ok: false, error: 'Unknown message type.' };
  }

  async function extractTranscriptFromPanel(track) {
    const debug = [];
    const push = (line) => debug.push(line);

    const existing = getTranscriptPanel();
    if (!existing) {
      push('Chưa thấy transcript panel, thử mở panel...');
      const opened = await ensureTranscriptPanelOpen(debug);
      if (!opened) {
        return {
          ok: false,
          error:
            'Không mở được transcript panel tự động. Hãy bấm Show transcript trên YouTube rồi thử lại.',
          debug,
        };
      }
    } else {
      push('Transcript panel đã hiện sẵn trên trang.');
    }

    await waitForTranscriptSegments(debug);

    const panel = getTranscriptPanel();
    if (!panel) {
      return {
        ok: false,
        error: 'Transcript panel không tồn tại sau khi mở.',
        debug,
      };
    }

    if (track) {
      push(
        `Fallback đang đọc transcript panel hiện tại. YouTube có thể không cho đổi đúng track ${track.label} bằng DOM.`
      );
    }

    const cues = parseTranscriptPanel(panel, debug);
    if (!cues.length) {
      return {
        ok: false,
        error: 'Transcript panel đã mở nhưng chưa đọc được đoạn phụ đề nào.',
        debug,
      };
    }

    return {
      ok: true,
      cues,
      sourceFormat: 'transcript-panel',
      source: 'panel',
      debug,
    };
  }

  async function ensureTranscriptPanelOpen(debug) {
    const push = (line) => debug.push(line);

    if (getTranscriptPanel()) {
      push('Panel đã có sẵn, không cần click mở.');
      return true;
    }

    const candidates = findTranscriptButtons();
    push(`Tìm thấy ${candidates.length} nút có khả năng mở transcript.`);

    for (const button of candidates) {
      try {
        button.click();
        push(`Đã click nút: ${button.innerText?.trim() || button.getAttribute('aria-label') || 'unknown'}`);
        await delay(900);
        if (getTranscriptPanel()) {
          push('Transcript panel đã xuất hiện sau khi click.');
          return true;
        }
      } catch (error) {
        push(`Click nút transcript thất bại: ${error.message}`);
      }
    }

    const moreActionsButton = findMoreActionsButton();
    if (moreActionsButton) {
      try {
        moreActionsButton.click();
        push('Đã mở menu More actions.');
        await delay(500);
        const menuItem = findTranscriptMenuItem();
        if (menuItem) {
          menuItem.click();
          push('Đã click menu item Show transcript.');
          await delay(900);
          if (getTranscriptPanel()) {
            push('Transcript panel đã xuất hiện sau menu More actions.');
            return true;
          }
        } else {
          push('Không tìm thấy menu item Show transcript trong menu hiện tại.');
        }
      } catch (error) {
        push(`Mở transcript từ More actions thất bại: ${error.message}`);
      }
    } else {
      push('Không tìm thấy nút More actions.');
    }

    return Boolean(getTranscriptPanel());
  }

  function getTranscriptPanel() {
    const selectors = [
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
      'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]',
      'ytd-transcript-renderer',
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) return node;
    }

    return null;
  }

  function findTranscriptButtons() {
    const buttons = Array.from(document.querySelectorAll('button, tp-yt-paper-button, yt-button-shape button'));
    const phrases = [
      'show transcript',
      'open transcript',
      'transcript',
      'hiện bản chép lời',
      'mở bản chép lời',
      'bản chép lời',
      'bản chép',
    ];

    return buttons.filter((button) => {
      const text = `${button.innerText || ''} ${button.getAttribute('aria-label') || ''}`.toLowerCase();
      if (!text) return false;
      return phrases.some((phrase) => text.includes(phrase));
    });
  }

  function findMoreActionsButton() {
    const candidates = Array.from(document.querySelectorAll('button, yt-button-shape button'));
    const phrases = ['more actions', 'thao tác khác', 'more'];

    for (const button of candidates) {
      const label = `${button.getAttribute('aria-label') || ''} ${button.title || ''}`.toLowerCase();
      if (phrases.some((phrase) => label.includes(phrase))) {
        return button;
      }
    }

    const compact = document.querySelector('ytd-menu-renderer yt-button-shape button');
    return compact || null;
  }

  function findTranscriptMenuItem() {
    const items = Array.from(document.querySelectorAll('tp-yt-paper-item, ytd-menu-service-item-renderer, button'));
    const phrases = [
      'show transcript',
      'open transcript',
      'transcript',
      'hiện bản chép lời',
      'mở bản chép lời',
      'bản chép lời',
    ];

    return (
      items.find((item) => {
        const text = (item.innerText || item.textContent || '').trim().toLowerCase();
        if (!text) return false;
        return phrases.some((phrase) => text.includes(phrase));
      }) || null
    );
  }

  async function waitForTranscriptSegments(debug) {
    const push = (line) => debug.push(line);
    const start = Date.now();
    while (Date.now() - start < 7000) {
      const segments = getTranscriptSegments();
      if (segments.length) {
        push(`Transcript panel đã có ${segments.length} segment element.`);
        return true;
      }
      await delay(300);
    }
    push('Hết thời gian chờ segment trong transcript panel.');
    return false;
  }

  function getTranscriptSegments() {
    const selectors = [
      'ytd-transcript-segment-renderer',
      'yt-formatted-string.segment-text',
      '[data-testid="transcript-segment"]',
    ];

    const segmentNodes = [];
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (nodes.length) {
        segmentNodes.push(...nodes);
        break;
      }
    }

    return segmentNodes;
  }

  function parseTranscriptPanel(panel, debug) {
    const push = (line) => debug.push(line);
    const segmentRenderers = Array.from(panel.querySelectorAll('ytd-transcript-segment-renderer'));

    if (segmentRenderers.length) {
      const cues = segmentRenderers
        .map((node, index) => {
          const timeText =
            node.querySelector('.segment-timestamp')?.textContent ||
            node.querySelector('#start-offset')?.textContent ||
            '';
          const text =
            node.querySelector('.segment-text')?.textContent ||
            node.querySelector('#segment-text')?.textContent ||
            node.textContent ||
            '';

          const normalizedText = normalizeCueText(text);
          if (!normalizedText) return null;

          const startMs = parseClockToMs(timeText);
          return { startMs, endMs: startMs + 2000, text: normalizedText, _index: index };
        })
        .filter(Boolean)
        .map((cue, index, array) => {
          const next = array[index + 1];
          return {
            startMs: cue.startMs,
            endMs: next && next.startMs > cue.startMs ? next.startMs : cue.startMs + 2000,
            text: cue.text,
          };
        });

      push(`Đọc được ${cues.length} cue từ ytd-transcript-segment-renderer.`);
      return cues;
    }

    const rawItems = Array.from(panel.querySelectorAll('button, div, span')).filter((node) => {
      const text = normalizeCueText(node.textContent || '');
      return text && /\d{1,2}:\d{2}/.test(text);
    });

    const cues = [];
    for (const item of rawItems) {
      const text = normalizeCueText(item.textContent || '');
      const match = text.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+([\s\S]+)$/);
      if (!match) continue;
      const startMs = parseClockToMs(match[1]);
      cues.push({ startMs, endMs: startMs + 2000, text: normalizeCueText(match[2]) });
    }

    for (let i = 0; i < cues.length - 1; i += 1) {
      if (cues[i + 1].startMs > cues[i].startMs) {
        cues[i].endMs = cues[i + 1].startMs;
      }
    }

    push(`Đọc được ${cues.length} cue từ text fallback trong transcript panel.`);
    return dedupeCues(cues);
  }

  function dedupeCues(cues) {
    const unique = [];
    const seen = new Set();
    for (const cue of cues) {
      const key = `${cue.startMs}|${cue.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(cue);
    }
    return unique;
  }

  function parseClockToMs(value) {
    const raw = String(value || '').trim().replace(',', '.');
    if (!raw) return 0;
    if (/^\d+(\.\d+)?$/.test(raw)) {
      return Math.round(parseFloat(raw) * 1000);
    }

    const match = raw.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (!match) return 0;
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    const millis = Number((match[4] || '0').padEnd(3, '0'));
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + millis;
  }

  function normalizeCueText(text) {
    return String(text || '')
      .replace(/\u200b/g, '')
      .replace(/\r/g, '')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatError(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    return `${error.name || 'Error'}: ${error.message || 'No message'}`;
  }
})();