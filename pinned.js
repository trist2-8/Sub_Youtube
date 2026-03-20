const STORAGE_KEY = 'ytSubtitleGrabberSettingsV8';
const ORIGINAL_LANGUAGE_SENTINEL = '__original__';

const refreshBtn = document.getElementById('refreshPinnedBtn');
const titleEl = document.getElementById('pinTitle');
const platformChipEl = document.getElementById('pinPlatformChip');
const statusChipEl = document.getElementById('pinStatusChip');
const timeChipEl = document.getElementById('pinTimeChip');
const countChipEl = document.getElementById('pinCountChip');
const sourceLabelEl = document.getElementById('pinSourceLabel');
const outputLabelEl = document.getElementById('pinOutputLabel');
const sourceTextEl = document.getElementById('pinSourceText');
const outputTextEl = document.getElementById('pinOutputText');
const footerNoteEl = document.getElementById('pinFooterNote');
const transcriptTitleEl = document.getElementById('pinTranscriptTitle');
const transcriptHintEl = document.getElementById('pinTranscriptHint');
const transcriptListEl = document.getElementById('pinTranscriptList');
const autoScrollBtn = document.getElementById('pinAutoScrollBtn');
const copyTranscriptBtn = document.getElementById('pinCopyTranscriptBtn');

const params = new URLSearchParams(location.search);
const targetTabIdFromUrl = Number(params.get('tabId')) || null;

const state = {
  tabId: targetTabIdFromUrl,
  lastUrl: '',
  platform: '',
  settings: {
    preferredTargetLanguage: ORIGINAL_LANGUAGE_SENTINEL,
    youtubeLeadMs: 220,
  },
  sourceLabel: 'Original',
  outputLabel: 'Translation',
  sourceCues: [],
  outputCues: [],
  transcriptRows: [],
  playbackTimer: null,
  liveTimer: null,
  refreshWatcher: null,
  playbackBaseMs: 0,
  playbackPerfMs: 0,
  playbackRate: 1,
  playbackIsPlaying: false,
  playbackTimeMs: 0,
  activeIndex: -1,
  activeTimelineIndex: -1,
  liveText: '',
  autoScroll: true,
  lastRenderedActiveIndex: -1,
  renderNonce: 0,
  liveCaptureOnly: false,
  lastCaptionText: '',
};

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error(error);
    setStatus(error?.message || 'Không khởi tạo được cửa sổ ghim.');
  });
});

refreshBtn?.addEventListener('click', () => loadPinnedData({ force: true }));
autoScrollBtn?.addEventListener('click', () => {
  state.autoScroll = !state.autoScroll;
  autoScrollBtn.classList.toggle('is-active', state.autoScroll);
  autoScrollBtn.textContent = state.autoScroll ? 'Auto' : 'Manual';
  if (state.autoScroll) ensureActiveRowVisible();
});
copyTranscriptBtn?.addEventListener('click', async () => {
  try {
    const text = buildTranscriptExportText();
    if (!text) {
      setStatus('Chưa có transcript để sao chép.');
      return;
    }
    await navigator.clipboard.writeText(text);
    setStatus('Đã copy full transcript');
  } catch (error) {
    setStatus(error?.message || 'Không copy được transcript.');
  }
});
transcriptListEl?.addEventListener('click', async (event) => {
  const row = event.target.closest('.pin-transcript-row');
  if (!row) return;
  const index = Number(row.dataset.index);
  const item = state.transcriptRows[index];
  if (!item || !Number.isFinite(item.startMs)) return;
  try {
    await executeInPage(pageSeekPlaybackPinned, [item.startMs]);
    setStatus(`Seek ${formatTimestamp(item.startMs)}`);
  } catch (error) {
    setStatus(error?.message || 'Không seek được video.');
  }
});
window.addEventListener('beforeunload', stopAllTimers);

async function init() {
  await loadSettings();
  autoScrollBtn.classList.toggle('is-active', state.autoScroll);
  autoScrollBtn.textContent = state.autoScroll ? 'Auto' : 'Manual';
  setStatus('Đang kết nối với tab video…');
  await loadPinnedData({ force: true });
  state.refreshWatcher = window.setInterval(async () => {
    const tab = await getTargetTab();
    if (!tab?.url) return;
    if (tab.url !== state.lastUrl) {
      await loadPinnedData({ force: true });
    }
  }, 1200);
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const saved = stored?.[STORAGE_KEY];
    if (saved && typeof saved === 'object') state.settings = { ...state.settings, ...saved };
  } catch {
    // ignore
  }
  const lead = Number(state.settings.youtubeLeadMs);
  state.settings.youtubeLeadMs = Number.isFinite(lead) ? lead : 220;
}

async function getTargetTab() {
  if (state.tabId) {
    try {
      const tab = await chrome.tabs.get(state.tabId);
      if (tab?.id) return tab;
    } catch {
      state.tabId = null;
    }
  }
  const tabs = await chrome.tabs.query({});
  const supported = tabs
    .filter((tab) => detectPlatform(tab.url))
    .sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0];
  if (supported?.id) {
    state.tabId = supported.id;
    return supported;
  }
  return tabs.sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0] || null;
}

function detectPlatform(url) {
  const raw = String(url || '');
  if (/^https:\/\/(www|m|music)\.youtube\.com\/(watch|shorts)/.test(raw)) return 'youtube';
  if (/^https:\/\/(www\.)?netflix\.com\/watch\//.test(raw)) return 'netflix';
  return '';
}

async function executeInPage(func, args = []) {
  const tab = await getTargetTab();
  if (!tab?.id) throw new Error('Không tìm thấy tab đang mở.');
  state.tabId = tab.id;
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func,
    args,
  });
  return results?.[0]?.result;
}

async function loadPinnedData({ force = false } = {}) {
  stopPlaybackTimer();
  stopLiveCapture();
  state.sourceCues = [];
  state.outputCues = [];
  state.transcriptRows = [];
  state.activeIndex = -1;
  state.activeTimelineIndex = -1;
  state.lastRenderedActiveIndex = -1;
  state.liveText = '';
  state.liveCaptureOnly = false;
  state.lastCaptionText = '';
  const tab = await getTargetTab();
  if (!tab?.url) {
    setEmptyPinnedState('Không tìm thấy tab video.', 'Waiting for subtitle…', 'Chưa có dữ liệu dịch hoặc song ngữ.');
    return;
  }

  state.lastUrl = tab.url;
  state.platform = detectPlatform(tab.url);
  platformChipEl.textContent = state.platform ? state.platform.toUpperCase() : 'Unsupported';
  titleEl.textContent = tab.title || 'Video';

  if (state.platform === 'youtube') {
    await loadYoutubePinned(force);
    return;
  }
  if (state.platform === 'netflix') {
    await loadNetflixPinned(force);
    return;
  }

  setEmptyPinnedState('Tab hiện tại không phải YouTube hoặc Netflix.', 'Waiting for subtitle…', 'Mở video YouTube hoặc Netflix rồi bấm nút ghim từ popup chính.');
}

async function loadYoutubePinned(force) {
  const metadata = await executeInPage(pageGetYoutubeMetadataPinned, []);
  if (!metadata?.ok || !metadata.sourceTracks?.length) {
    setEmptyPinnedState(metadata?.error || 'Không đọc được phụ đề YouTube.', 'Waiting for subtitle…', 'Video YouTube này chưa có phụ đề hoặc chưa đọc được track.');
    return;
  }

  const sourceTrack = metadata.sourceTracks[Math.max(0, metadata.defaultSourceIndex || 0)];
  state.sourceLabel = sourceTrack.name || sourceTrack.languageCode || 'Original';
  sourceLabelEl.textContent = state.sourceLabel;
  outputLabelEl.textContent = 'Output';
  transcriptTitleEl.textContent = 'YouTube full transcript';
  transcriptHintEl.textContent = 'Bản pin giữ toàn bộ cue từ đầu đến cuối. Bấm vào dòng để tua video.';
  footerNoteEl.textContent = 'YouTube pin ưu tiên full timed transcript, đồng thời vẫn highlight theo câu đang phát.';

  const sourceResult = await executeInPage(pageFetchYoutubeTrackPinned, [sourceTrack]);
  if (!sourceResult?.ok || !sourceResult.cues?.length) {
    setEmptyPinnedState(sourceResult?.error || 'Không tải được phụ đề YouTube.', 'Waiting for subtitle…', 'Không tải được nội dung phụ đề YouTube.');
    return;
  }

  state.sourceCues = sourceResult.cues;
  state.outputCues = [];

  const targetLanguage = state.settings.preferredTargetLanguage || ORIGINAL_LANGUAGE_SENTINEL;
  if (targetLanguage !== ORIGINAL_LANGUAGE_SENTINEL && sourceTrack.isTranslatable) {
    const targetMeta = metadata.translationLanguages.find((item) => item.languageCode === targetLanguage);
    const translationRequest = {
      ...sourceTrack,
      isTranslation: true,
      sourceLanguageCode: sourceTrack.languageCode,
      targetLanguageCode: targetLanguage,
      targetLanguageName: targetMeta?.name || targetLanguage,
    };
    const translationResult = await executeInPage(pageFetchYoutubeTrackPinned, [translationRequest]);
    if (translationResult?.ok && translationResult.cues?.length) {
      state.outputCues = translationResult.cues;
      outputLabelEl.textContent = targetMeta?.name || targetLanguage;
    }
  }

  if (!state.outputCues.length) outputLabelEl.textContent = 'Output';
  rebuildTranscriptRowsFromCues();
  setStatus('Live sync');
  startPlaybackTimer();
}

async function loadNetflixPinned(force) {
  const metadata = await executeInPage(pageGetNetflixMetadataPinned, []);
  if (!metadata?.ok || !metadata.sourceTracks?.length) {
    setEmptyPinnedState(metadata?.error || 'Không đọc được metadata Netflix.', 'Waiting for subtitle…', 'Netflix chưa expose subtitle track nào. Hãy bật phụ đề trong player rồi refresh.');
    return;
  }

  const sourceTrack = metadata.sourceTracks[Math.max(0, metadata.defaultSourceIndex || 0)];
  state.sourceLabel = sourceTrack.name || sourceTrack.languageCode || 'Original';
  state.liveCaptureOnly = sourceTrack.fetchStrategy === 'liveCapture';
  sourceLabelEl.textContent = state.sourceLabel;
  outputLabelEl.textContent = sourceTrack.fetchStrategy === 'liveCapture' ? 'Session log' : 'Output';
  transcriptTitleEl.textContent = sourceTrack.fetchStrategy === 'liveCapture' ? 'Netflix live capture timeline' : 'Netflix full transcript';
  footerNoteEl.textContent = 'Netflix pin sẽ ưu tiên full track; nếu title không lộ full transcript thì pin sẽ tự bám subtitle đang hiện và tích lũy transcript theo phiên.';
  transcriptHintEl.textContent = sourceTrack.fetchStrategy === 'liveCapture'
    ? 'Live capture sẽ được giữ lại theo thời gian từ lúc pin bắt đầu chạy.'
    : 'Pin sẽ dùng text track khi có, đồng thời tiếp tục bám subtitle đang hiện để tránh mất dòng hiện tại.';

  const sourceResult = await executeInPage(pageFetchNetflixTrackPinned, [sourceTrack]);
  if (sourceResult?.ok && sourceResult.cues?.length) {
    state.sourceCues = sourceResult.cues;
    state.outputCues = [];
    rebuildTranscriptRowsFromCues();
    setStatus('Live sync');
    startPlaybackTimer();
    startLiveCapture();
    return;
  }

  state.sourceCues = [];
  state.outputCues = [];
  state.transcriptRows = [];
  renderTranscriptList();
  renderTexts('Waiting for subtitle…', 'Đang chuyển sang live capture subtitle đang hiển thị.');
  setStatus('Live capture');
  startPlaybackTimer();
  startLiveCapture();
}

function rebuildTranscriptRowsFromCues() {
  state.transcriptRows = state.sourceCues.map((cue, index) => {
    const outputCue = state.outputCues.length ? findBestOutputCue(cue, state.outputCues, index) : null;
    return {
      startMs: cue.startMs,
      endMs: cue.endMs,
      source: cue.text || '',
      output: outputCue?.text || '',
      kind: 'cue',
    };
  });
  renderTranscriptList();
  updateTextsFromCues();
}

function renderTranscriptList() {
  const rows = state.transcriptRows || [];
  countChipEl.textContent = `${rows.length} dòng`;
  if (!transcriptListEl) return;
  transcriptListEl.innerHTML = '';
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'pin-empty-state';
    empty.textContent = 'Chưa có transcript để hiển thị.';
    transcriptListEl.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  rows.forEach((row, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'pin-transcript-row';
    if (index === state.activeTimelineIndex) item.classList.add('is-active');
    item.dataset.index = String(index);
    item.innerHTML = `
      <div class="pin-transcript-time">${formatTimestamp(row.startMs)}</div>
      <div class="pin-transcript-col source">
        <strong>${escapeHtml(state.sourceLabel || 'Source')}</strong>
        <p>${escapeHtml(row.source || '')}</p>
      </div>
      <div class="pin-transcript-col output">
        <strong>${escapeHtml(state.outputLabel || 'Output')}</strong>
        <p>${escapeHtml(row.output || '—')}</p>
      </div>
    `;
    fragment.appendChild(item);
  });
  transcriptListEl.appendChild(fragment);
  ensureActiveRowVisible();
}

function updateActiveTranscriptRow() {
  if (!transcriptListEl) return;
  if (state.lastRenderedActiveIndex === state.activeTimelineIndex) return;
  const previous = transcriptListEl.querySelector('.pin-transcript-row.is-active');
  previous?.classList.remove('is-active');
  if (state.activeTimelineIndex >= 0) {
    const current = transcriptListEl.querySelector(`.pin-transcript-row[data-index="${state.activeTimelineIndex}"]`);
    current?.classList.add('is-active');
  }
  state.lastRenderedActiveIndex = state.activeTimelineIndex;
  ensureActiveRowVisible();
}

function ensureActiveRowVisible() {
  if (!state.autoScroll || !transcriptListEl || state.activeTimelineIndex < 0) return;
  const current = transcriptListEl.querySelector(`.pin-transcript-row[data-index="${state.activeTimelineIndex}"]`);
  current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function appendLiveTranscriptRow(text, timeMs) {
  const normalized = normalizePinnedText(text);
  if (!normalized) return;
  const stamp = Math.max(0, Number(timeMs) || 0);
  const previous = state.transcriptRows[state.transcriptRows.length - 1];
  if (previous && normalizeCompareText(previous.source) === normalizeCompareText(normalized)) {
    previous.endMs = Math.max(previous.endMs || previous.startMs || 0, stamp + 2200);
    previous.output = 'Netflix live capture';
    state.activeTimelineIndex = state.transcriptRows.length - 1;
    updateActiveTranscriptRow();
    return;
  }
  state.transcriptRows.push({
    startMs: stamp,
    endMs: stamp + 2200,
    source: normalized,
    output: 'Netflix live capture',
    kind: 'live',
  });
  state.activeTimelineIndex = state.transcriptRows.length - 1;
  renderTranscriptList();
}

function setEmptyPinnedState(statusText, sourceText, outputText) {
  setStatus(statusText);
  renderTexts(sourceText, outputText);
  state.transcriptRows = [];
  renderTranscriptList();
}

function stopAllTimers() {
  stopPlaybackTimer();
  stopLiveCapture();
  if (state.refreshWatcher) {
    clearInterval(state.refreshWatcher);
    state.refreshWatcher = null;
  }
}

function stopPlaybackTimer() {
  if (state.playbackTimer) {
    clearInterval(state.playbackTimer);
    state.playbackTimer = null;
  }
}

function stopLiveCapture() {
  if (state.liveTimer) {
    clearInterval(state.liveTimer);
    state.liveTimer = null;
  }
  state.liveText = '';
  state.liveCaptureOnly = false;
  state.lastCaptionText = '';
}

function startPlaybackTimer() {
  stopPlaybackTimer();
  state.playbackTimer = window.setInterval(async () => {
    try {
      const snapshot = await executeInPage(pageGetPlaybackSnapshotPinned, []);
      if (!snapshot?.ok) return;
      state.playbackBaseMs = Math.max(0, Number(snapshot.currentTimeMs) || 0);
      state.playbackPerfMs = performance.now();
      state.playbackRate = Number(snapshot.playbackRate || 1) || 1;
      state.playbackIsPlaying = Boolean(snapshot.isPlaying);
      state.lastCaptionText = normalizePinnedText(snapshot.captionText || '');
      syncPlayback();
    } catch {
      // ignore
    }
  }, 200);
}

function estimatePlaybackTime() {
  const delta = state.playbackIsPlaying ? Math.max(0, performance.now() - state.playbackPerfMs) * state.playbackRate : 0;
  const leadMs = state.platform === 'youtube' ? Number(state.settings.youtubeLeadMs || 0) : 0;
  return Math.max(0, Math.round(state.playbackBaseMs + delta + leadMs));
}

function findCueIndex(cues, timeMs, activeIndex) {
  if (!cues.length) return -1;
  const activeCue = cues[activeIndex];
  if (activeCue && timeMs >= activeCue.startMs - 40 && timeMs < activeCue.endMs + 100) return activeIndex;
  for (let idx = Math.max(0, activeIndex - 2); idx <= Math.min(cues.length - 1, activeIndex + 2); idx += 1) {
    if (cues[idx] && timeMs >= cues[idx].startMs - 30 && timeMs < cues[idx].endMs + 90) return idx;
  }
  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const cue = cues[mid];
    if (timeMs < cue.startMs) high = mid - 1;
    else if (timeMs >= cue.endMs) low = mid + 1;
    else return mid;
  }
  const candidate = Math.max(0, Math.min(cues.length - 1, low));
  if (Math.abs((cues[candidate]?.startMs || 0) - timeMs) <= 450) return candidate;
  return -1;
}

function syncPlayback() {
  state.playbackTimeMs = estimatePlaybackTime();

  if (state.sourceCues.length) {
    const idx = findCueIndex(state.sourceCues, state.playbackTimeMs, state.activeIndex);
    if (idx !== state.activeIndex) {
      state.activeIndex = idx;
      state.activeTimelineIndex = idx;
      updateTextsFromCues();
      updateActiveTranscriptRow();
    }
  }

  if (state.platform === 'netflix' && state.lastCaptionText) {
    const activeText = state.activeIndex >= 0 && state.sourceCues[state.activeIndex]
      ? normalizeCompareText(state.sourceCues[state.activeIndex].text || '')
      : '';
    const liveText = normalizeCompareText(state.lastCaptionText);
    if (!activeText || activeText !== liveText) {
      appendLiveTranscriptRow(state.lastCaptionText, state.playbackTimeMs);
      renderTexts(
        state.lastCaptionText,
        state.liveCaptureOnly
          ? 'Netflix live capture đang được lưu theo thời gian.'
          : 'Đang hiển thị subtitle trực tiếp từ player Netflix.'
      );
    }
  }

  timeChipEl.textContent = formatTimestamp(state.playbackTimeMs);
  if (state.platform === 'netflix') {
    statusChipEl.textContent = state.lastCaptionText ? 'Live capture' : (state.playbackIsPlaying ? 'Playing' : 'Paused');
  } else {
    statusChipEl.textContent = state.playbackIsPlaying ? 'Playing' : 'Paused';
  }
}

function updateTextsFromCues() {
  if (state.activeIndex < 0 || !state.sourceCues[state.activeIndex]) {
    renderTexts(
      state.platform === 'netflix' && state.lastCaptionText ? state.lastCaptionText : 'Waiting for subtitle…',
      state.outputCues.length
        ? 'Đang chờ câu dịch kế tiếp…'
        : state.platform === 'netflix'
          ? 'Netflix đang bám subtitle trực tiếp từ player nếu text track chưa đủ.'
          : 'Chưa có dữ liệu dịch hoặc song ngữ.'
    );
    return;
  }
  const sourceCue = state.sourceCues[state.activeIndex];
  let outputText = 'Chưa có dữ liệu dịch hoặc song ngữ.';
  if (state.outputCues.length) {
    const outputCue = findBestOutputCue(sourceCue, state.outputCues, state.activeIndex);
    if (outputCue?.text) outputText = outputCue.text;
  } else if (state.platform === 'netflix') {
    outputText = 'Netflix full transcript';
  }
  renderTexts(sourceCue.text || 'Waiting for subtitle…', outputText);
}

function findBestOutputCue(sourceCue, cues, preferredIndex) {
  const byIndex = cues[preferredIndex];
  if (byIndex && Math.abs((byIndex.startMs || 0) - sourceCue.startMs) <= 2200) return byIndex;
  let best = null;
  let delta = Number.POSITIVE_INFINITY;
  for (const cue of cues) {
    const d = Math.abs((cue.startMs || 0) - sourceCue.startMs);
    if (d < delta) {
      delta = d;
      best = cue;
    }
  }
  return delta <= 2600 ? best : null;
}

function startLiveCapture() {
  stopLiveCapture();
  state.liveTimer = window.setInterval(async () => {
    try {
      const snapshot = await executeInPage(pageGetNetflixLiveSnapshotPinned, []);
      if (!snapshot?.ok) return;
      state.playbackTimeMs = Math.max(0, Number(snapshot.currentTimeMs) || 0);
      timeChipEl.textContent = formatTimestamp(state.playbackTimeMs);
      statusChipEl.textContent = snapshot.text ? 'Live capture' : 'Waiting';
      if (snapshot.text && snapshot.text !== state.liveText) {
        state.liveText = snapshot.text;
        renderTexts(snapshot.text, 'Netflix live capture đang được lưu theo thời gian.');
        appendLiveTranscriptRow(snapshot.text, state.playbackTimeMs);
      }
      updateActiveTranscriptRow();
    } catch {
      // ignore
    }
  }, 160);
}

function normalizePinnedText(text) {
  return String(text || '')
    .replace(/\u200b/g, '')
    .replace(/\r/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeCompareText(text) {
  return normalizePinnedText(text).toLowerCase();
}

function renderTexts(sourceText, outputText) {
  sourceTextEl.textContent = sourceText || 'Waiting for subtitle…';
  outputTextEl.textContent = outputText || 'Chưa có dữ liệu dịch hoặc song ngữ.';
}

function setStatus(text) {
  statusChipEl.textContent = text || 'Ready';
}

function buildTranscriptExportText() {
  if (!state.transcriptRows.length) return '';
  return state.transcriptRows.map((row) => {
    const time = formatTimestamp(row.startMs);
    const output = row.output ? `\n${state.outputLabel || 'Output'}: ${row.output}` : '';
    return `[${time}] ${state.sourceLabel || 'Source'}: ${row.source}${output}`;
  }).join('\n\n');
}

function formatTimestamp(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pageSeekPlaybackPinned(timeMs) {
  try {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy player HTML5.' };
    video.currentTime = Math.max(0, Number(timeMs || 0) / 1000);
    return { ok: true, currentTimeMs: Math.round(Number(video.currentTime || 0) * 1000) };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không seek được video.' };
  }
}

function pageGetPlaybackSnapshotPinned() {
  function collectCaptionText() {
    const hostname = String(location.hostname || '').toLowerCase();
    const selectors = hostname.includes('netflix.com')
      ? [
          '[data-uia="player-subtitle"]',
          '[data-uia="subtitle-text"]',
          '.player-timedtext',
          '.player-timedtext-text-container',
          '[class*="timedtext"] [class*="text"]',
          '.watch-video--player-view [class*="timedtext"]',
        ]
      : [
          '.ytp-caption-segment',
          '.captions-text .caption-visual-line',
          '.ytp-caption-window-container .caption-window',
          '.ytp-caption-window-container',
        ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      const parts = nodes
        .map((node) => normalizePinnedText(node.innerText || node.textContent || ''))
        .filter(Boolean);
      if (parts.length) return parts.join('\n');
    }
    return '';
  }

  try {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy player HTML5.' };
    return {
      ok: true,
      currentTimeMs: Math.round(Number(video.currentTime || 0) * 1000),
      playbackRate: Number(video.playbackRate || 1) || 1,
      isPlaying: !video.paused && !video.ended && Number(video.readyState || 0) >= 2,
      captionText: collectCaptionText(),
      url: location.href,
    };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không đọc được trạng thái player.' };
  }
}

function pageGetYoutubeMetadataPinned() {
  function getTextFromRuns(node) {
    if (!node) return '';
    if (typeof node.simpleText === 'string') return node.simpleText;
    if (Array.isArray(node.runs)) return node.runs.map((item) => item.text || '').join('');
    return '';
  }
  function normalizeBaseUrl(url) {
    try { return new URL(String(url || '').replace(/\\u0026/g, '&'), location.href).toString(); } catch { return ''; }
  }
  function getPlayerResponse() {
    try {
      const player = document.getElementById('movie_player');
      const response = player?.getPlayerResponse?.();
      if (response && typeof response === 'object') return response;
    } catch {}
    try {
      if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
    } catch {}
    try {
      const raw = window.ytplayer?.config?.args?.player_response;
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  }
  const playerResponse = getPlayerResponse();
  if (!playerResponse) return { ok: false, error: 'Không đọc được player response từ trang YouTube.' };
  const renderer = playerResponse?.captions?.playerCaptionsTracklistRenderer;
  const captionTracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
  const translationLanguages = Array.isArray(renderer?.translationLanguages) ? renderer.translationLanguages : [];
  const sourceTracks = captionTracks.map((track, index) => ({
    index,
    label: `${getTextFromRuns(track.name) || track.languageCode || 'unknown'} [${track.languageCode || 'unknown'}]${track.kind === 'asr' ? ' • auto' : ''}`,
    languageCode: track.languageCode || 'unknown',
    baseUrl: normalizeBaseUrl(track.baseUrl),
    kind: track.kind || 'standard',
    name: getTextFromRuns(track.name) || track.languageCode || 'unknown',
    vssId: track.vssId || '',
    isAuto: track.kind === 'asr',
    isTranslatable: Boolean(track.isTranslatable),
    isTranslation: false,
    sourceLanguageCode: track.languageCode || 'unknown',
  }));
  const langs = translationLanguages
    .map((lang) => ({ languageCode: lang?.languageCode || '', name: getTextFromRuns(lang?.languageName) || lang?.languageCode || '' }))
    .filter((item) => item.languageCode);
  return { ok: true, sourceTracks, translationLanguages: langs, defaultSourceIndex: 0 };
}

async function pageFetchYoutubeTrackPinned(track) {
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
  function decodeHtmlEntities(text) {
    const el = document.createElement('textarea');
    el.innerHTML = text;
    return el.value;
  }
  function parseClockToMs(value) {
    const raw = String(value || '').trim().replace(',', '.');
    if (!raw) return 0;
    if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(parseFloat(raw) * 1000);
    const match = raw.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!match) return 0;
    return Number(match[1] || 0) * 3600000 + Number(match[2] || 0) * 60000 + Number(match[3] || 0) * 1000 + Number((match[4] || '0').padEnd(3, '0'));
  }
  function parseXml(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
    const legacyTexts = Array.from(xml.querySelectorAll('text'));
    if (legacyTexts.length) {
      return legacyTexts.map((node) => {
        const startMs = Math.round((parseFloat(node.getAttribute('start') || '0') || 0) * 1000);
        const durMs = Math.round((parseFloat(node.getAttribute('dur') || '0') || 0) * 1000);
        const endMs = durMs > 0 ? startMs + durMs : startMs + 1800;
        const html = Array.from(node.childNodes).map((child) => child.textContent || '').join('');
        const text = normalizeCueText(decodeHtmlEntities(html || node.textContent || ''));
        return text ? { startMs, endMs, text } : null;
      }).filter(Boolean);
    }
    const timed = Array.from(xml.querySelectorAll('p'));
    return timed.map((node) => {
      const startMs = parseClockToMs(node.getAttribute('begin') || node.getAttribute('start') || '0');
      const endMs = parseClockToMs(node.getAttribute('end') || '0');
      const durMs = parseClockToMs(node.getAttribute('dur') || '0');
      const finalEnd = endMs > startMs ? endMs : startMs + (durMs > 0 ? durMs : 1800);
      const text = normalizeCueText(decodeHtmlEntities(node.textContent || ''));
      return text ? { startMs, endMs: finalEnd, text } : null;
    }).filter(Boolean);
  }
  function parseJsonText(text) {
    try {
      const data = JSON.parse(text);
      const events = Array.isArray(data?.events) ? data.events : [];
      return events.map((event) => {
        const startMs = Number(event.tStartMs || event.tStartMs === 0 ? event.tStartMs : 0);
        const durMs = Number(event.dDurationMs || 0);
        const segs = Array.isArray(event.segs) ? event.segs : [];
        const textValue = normalizeCueText(segs.map((seg) => decodeHtmlEntities(seg.utf8 || '')).join(''));
        return textValue ? { startMs, endMs: durMs > 0 ? startMs + durMs : startMs + 1800, text: textValue } : null;
      }).filter(Boolean);
    } catch {
      return [];
    }
  }
  function parseVtt(vttText) {
    const blocks = String(vttText || '')
      .replace(/^WEBVTT.*?(\n\n|\r\n\r\n)/s, '')
      .split(/\r?\n\r?\n/)
      .map((block) => block.trim())
      .filter(Boolean);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split(/\r?\n/).filter(Boolean);
      if (!lines.length) continue;
      const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
      if (timeLineIndex < 0) continue;
      const [startRaw, endRaw] = lines[timeLineIndex].split('-->').map((part) => String(part || '').trim().split(' ')[0]);
      const textValue = normalizeCueText(lines.slice(timeLineIndex + 1).join('\n'));
      if (!textValue) continue;
      const startMs = parseClockToMs(startRaw);
      const endMs = parseClockToMs(endRaw);
      cues.push({ startMs, endMs: endMs > startMs ? endMs : startMs + 1800, text: textValue });
    }
    return cues;
  }
  async function fetchText(url) {
    try {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      const text = await response.text();
      return { ok: response.ok, text };
    } catch (error) {
      return { ok: false, text: '', error: error?.message || 'fetch failed' };
    }
  }
  try {
    const variants = [
      { fmt: 'json3', parser: parseJsonText },
      { fmt: 'srv3', parser: parseXml },
      { fmt: 'vtt', parser: parseVtt },
      { fmt: '', parser: (text) => parseXml(text).length ? parseXml(text) : parseVtt(text) },
    ];
    for (const variant of variants) {
      const url = new URL(track.baseUrl, location.href);
      if (variant.fmt) url.searchParams.set('fmt', variant.fmt);
      else url.searchParams.delete('fmt');
      if (track.isTranslation && track.targetLanguageCode) url.searchParams.set('tlang', track.targetLanguageCode);
      const result = await fetchText(url.toString());
      const raw = String(result.text || '').trim();
      if (!raw) continue;
      const cues = variant.parser(raw);
      if (cues.length) return { ok: true, cues };
    }
    return { ok: false, error: 'Timedtext không trả về cue nào có thể parse.' };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không tải được timedtext.' };
  }
}

function pageGetNetflixMetadataPinned() {
  try {
    const video = document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy video Netflix đang phát.' };
    const textTracks = Array.from(video.textTracks || []).filter((track) => ['subtitles', 'captions'].includes(String(track.kind || '').toLowerCase()));
    const activeIndex = textTracks.findIndex((track) => String(track.mode || '').toLowerCase() === 'showing');
    const sourceTracks = textTracks.map((track, index) => ({
      index,
      platform: 'netflix',
      fetchStrategy: 'textTrack',
      textTrackIndex: index,
      label: `${track.label || track.language || `track-${index + 1}`} [${track.language || `track-${index + 1}`}]`,
      languageCode: track.language || `track-${index + 1}`,
      name: track.label || track.language || `track-${index + 1}`,
    }));
    sourceTracks.push({
      index: sourceTracks.length,
      platform: 'netflix',
      fetchStrategy: 'liveCapture',
      textTrackIndex: -1,
      label: 'Live capture',
      languageCode: 'live',
      name: 'Live capture',
    });
    return { ok: true, sourceTracks, defaultSourceIndex: activeIndex >= 0 ? activeIndex : 0 };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không đọc được metadata Netflix.' };
  }
}

async function pageFetchNetflixTrackPinned(track) {
  function normalizeText(value) {
    return String(value || '').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  }
  if (track?.fetchStrategy === 'liveCapture') return { ok: false, liveCaptureOnly: true };
  try {
    const video = document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy video Netflix.' };
    const textTracks = Array.from(video.textTracks || []).filter((candidate) => ['subtitles', 'captions'].includes(String(candidate.kind || '').toLowerCase()));
    const selectedTrack = textTracks[Number(track.textTrackIndex)] || textTracks[0] || null;
    if (!selectedTrack) return { ok: false, liveCaptureOnly: true };
    const restore = textTracks.map((candidate) => String(candidate.mode || 'disabled'));
    textTracks.forEach((candidate) => { candidate.mode = candidate === selectedTrack ? 'hidden' : 'disabled'; });
    let cues = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 220));
      cues = Array.from(selectedTrack.cues || []).map((cue) => ({
        startMs: Math.round(Number(cue.startTime || 0) * 1000),
        endMs: Math.round(Number(cue.endTime || 0) * 1000),
        text: normalizeText(cue.text || ''),
      })).filter((cue) => cue.text);
      if (cues.length) break;
    }
    textTracks.forEach((candidate, index) => { try { candidate.mode = restore[index] || 'disabled'; } catch {} });
    return cues.length ? { ok: true, cues } : { ok: false, liveCaptureOnly: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không đọc được subtitle Netflix.', liveCaptureOnly: true };
  }
}

function pageGetNetflixLiveSnapshotPinned() {
  function normalizeText(value) {
    return String(value || '').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  }
  const video = document.querySelector('video');
  if (!video) return { ok: false, error: 'Không tìm thấy video.' };
  const selectors = [
    '[data-uia="player-subtitle"]',
    '[data-uia="subtitle-text"]',
    '.player-timedtext',
    '.player-timedtext-text-container',
    '[class*="timedtext"] [class*="text"]',
    '.watch-video--player-view [class*="timedtext"]',
  ];
  let text = '';
  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector));
    const parts = nodes.map((node) => normalizeText(node.innerText || node.textContent || '')).filter(Boolean);
    if (parts.length) {
      text = parts.join('\n');
      break;
    }
  }
  return {
    ok: true,
    currentTimeMs: Math.round(Number(video.currentTime || 0) * 1000),
    playbackRate: Number(video.playbackRate || 1) || 1,
    isPlaying: !video.paused && !video.ended && Number(video.readyState || 0) >= 2,
    text,
  };
}
