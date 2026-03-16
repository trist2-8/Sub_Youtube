const STORAGE_KEY = 'ytSubtitleGrabberSettingsV8';
const ORIGINAL_LANGUAGE_SENTINEL = '__original__';

const refreshBtn = document.getElementById('refreshPinnedBtn');
const titleEl = document.getElementById('pinTitle');
const platformChipEl = document.getElementById('pinPlatformChip');
const statusChipEl = document.getElementById('pinStatusChip');
const timeChipEl = document.getElementById('pinTimeChip');
const reviewCountEl = document.getElementById('pinReviewCount');
const sourceLabelEl = document.getElementById('pinSourceLabel');
const outputLabelEl = document.getElementById('pinOutputLabel');
const sourceTextEl = document.getElementById('pinSourceText');
const outputTextEl = document.getElementById('pinOutputText');
const reviewLogEl = document.getElementById('pinReviewLog');
const logHintEl = document.getElementById('pinLogHint');
const footerNoteEl = document.getElementById('pinFooterNote');

const params = new URLSearchParams(location.search);
const targetTabIdFromUrl = Number(params.get('tabId')) || null;

const PIN_SNAPSHOT_MS = 100;
const PIN_RENDER_MS = 30;
const PIN_LIVE_CAPTURE_MS = 140;
const PIN_STALE_MS = 900;
const PIN_DEFAULT_YT_LEAD_MS = 320;
const PIN_MAX_REVIEW_ITEMS = 300;

const state = {
  tabId: targetTabIdFromUrl,
  lastUrl: '',
  platform: '',
  isLoading: false,
  settings: {
    preferredTargetLanguage: ORIGINAL_LANGUAGE_SENTINEL,
    youtubeLeadMs: PIN_DEFAULT_YT_LEAD_MS,
  },
  sourceLabel: 'Original',
  outputLabel: 'Translation',
  sourceCues: [],
  outputCues: [],
  playbackSnapshotTimer: null,
  playbackRenderTimer: null,
  liveTimer: null,
  refreshWatcher: null,
  playbackBaseMs: 0,
  playbackPerfMs: 0,
  playbackRate: 1,
  playbackIsPlaying: false,
  playbackTimeMs: 0,
  lastPlaybackSnapshotAt: 0,
  activeIndex: -1,
  liveText: '',
  reviewEntries: [],
};

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error(error);
    setStatus(error?.message || 'Không khởi tạo được cửa sổ ghim.');
  });
});

refreshBtn?.addEventListener('click', () => loadPinnedData({ force: true }));
window.addEventListener('beforeunload', stopAllTimers);

async function init() {
  await loadSettings();
  renderTexts('Waiting for subtitle…', 'Chưa có dữ liệu dịch hoặc song ngữ.');
  renderReviewLog();
  setStatus('Đang kết nối với tab video…');
  await loadPinnedData({ force: true });
  state.refreshWatcher = window.setInterval(async () => {
    const tab = await getTargetTab();
    if (!tab?.url || state.isLoading) return;
    const urlChanged = tab.url !== state.lastUrl;
    const idle = !state.playbackSnapshotTimer && !state.liveTimer;
    if (urlChanged || idle) {
      await loadPinnedData({ force: true, preserveHistory: !urlChanged });
    }
  }, 1500);
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const saved = stored?.[STORAGE_KEY];
    if (saved && typeof saved === 'object') {
      state.settings = { ...state.settings, ...saved };
    }
  } catch {
    // ignore
  }
  const lead = Number(state.settings.youtubeLeadMs);
  state.settings.youtubeLeadMs = Number.isFinite(lead) ? lead : PIN_DEFAULT_YT_LEAD_MS;
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
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const supported = tabs.find((tab) => detectPlatform(tab.url));
  if (supported?.id) {
    state.tabId = supported.id;
    return supported;
  }
  return tabs[0] || null;
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

async function loadPinnedData({ force = false, preserveHistory = true } = {}) {
  if (state.isLoading && !force) return;
  state.isLoading = true;
  stopPlaybackTimer();
  stopLiveCapture();
  const tab = await getTargetTab();
  if (!tab?.url) {
    state.isLoading = false;
    setStatus('Không tìm thấy tab video.');
    renderTexts('Waiting for subtitle…', 'Mở YouTube hoặc Netflix rồi bấm ghim từ popup chính.');
    return;
  }

  const platform = detectPlatform(tab.url);
  const sameVideo = state.lastUrl && state.lastUrl === tab.url;
  if (!preserveHistory || !sameVideo) {
    state.reviewEntries = [];
    renderReviewLog();
  }

  state.lastUrl = tab.url;
  state.platform = platform;
  platformChipEl.textContent = platform ? platform.toUpperCase() : 'Unsupported';
  titleEl.textContent = tab.title || 'Video';
  sourceLabelEl.textContent = 'Original';
  outputLabelEl.textContent = 'Output';

  try {
    if (platform === 'youtube') {
      await loadYoutubePinned();
    } else if (platform === 'netflix') {
      await loadNetflixPinned();
    } else {
      renderTexts('Waiting for subtitle…', 'Mở video YouTube hoặc Netflix rồi bấm nút ghim từ popup chính.');
      setStatus('Tab hiện tại không phải YouTube hoặc Netflix.');
      footerNoteEl.textContent = 'Cửa sổ ghim chỉ hoạt động với YouTube hoặc Netflix.';
    }
  } finally {
    state.isLoading = false;
  }
}

async function loadYoutubePinned() {
  footerNoteEl.textContent = 'Cửa sổ ghim tự chạy riêng để bạn theo dõi subtitle khi popup chính đã đóng.';
  logHintEl.textContent = 'Tự lưu khi câu YouTube chuyển cue';
  const metadata = await executeInPage(pageGetYoutubeMetadataPinned, []);
  if (!metadata?.ok || !metadata.sourceTracks?.length) {
    renderTexts('Waiting for subtitle…', 'Video YouTube này chưa có phụ đề hoặc chưa đọc được track.');
    setStatus(metadata?.error || 'Không đọc được phụ đề YouTube.');
    return;
  }

  const sourceTrack = metadata.sourceTracks[Math.max(0, metadata.defaultSourceIndex || 0)];
  state.sourceLabel = sourceTrack.name || sourceTrack.languageCode || 'Original';
  sourceLabelEl.textContent = state.sourceLabel;

  const sourceResult = await executeInPage(pageFetchYoutubeTrackPinned, [sourceTrack]);
  if (!sourceResult?.ok || !sourceResult.cues?.length) {
    renderTexts('Waiting for subtitle…', 'Không tải được nội dung phụ đề YouTube.');
    setStatus(sourceResult?.error || 'Không tải được phụ đề YouTube.');
    return;
  }

  state.sourceCues = sourceResult.cues;
  state.outputCues = [];
  outputLabelEl.textContent = 'Output';

  const targetLanguage = state.settings.preferredTargetLanguage || ORIGINAL_LANGUAGE_SENTINEL;
  if (targetLanguage !== ORIGINAL_LANGUAGE_SENTINEL && sourceTrack.isTranslatable) {
    const targetMeta = (metadata.translationLanguages || []).find((item) => item.languageCode === targetLanguage);
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

  renderTexts('Waiting for subtitle…', state.outputCues.length ? 'Đang chờ câu dịch khớp theo thời gian…' : 'Chế độ ghim đang theo dõi phụ đề gốc.');
  setStatus('Live sync');
  startPlaybackTimer();
}

async function loadNetflixPinned() {
  footerNoteEl.textContent = 'Nếu Netflix không lộ full track, cửa sổ ghim sẽ giữ lại toàn bộ live capture theo thời gian.';
  logHintEl.textContent = 'Tự lưu khi subtitle Netflix đổi dòng';
  const metadata = await executeInPage(pageGetNetflixMetadataPinned, []);
  if (!metadata?.ok || !metadata.sourceTracks?.length) {
    renderTexts('Waiting for subtitle…', 'Netflix chưa expose subtitle track nào. Hãy bật phụ đề trong player rồi refresh.');
    setStatus(metadata?.error || 'Không đọc được metadata Netflix.');
    return;
  }

  const sourceTrack = metadata.sourceTracks[Math.max(0, metadata.defaultSourceIndex || 0)];
  state.sourceLabel = sourceTrack.name || sourceTrack.languageCode || 'Original';
  sourceLabelEl.textContent = state.sourceLabel;
  outputLabelEl.textContent = 'Output';

  const sourceResult = await executeInPage(pageFetchNetflixTrackPinned, [sourceTrack]);
  if (sourceResult?.ok && sourceResult.cues?.length) {
    state.sourceCues = sourceResult.cues;
    state.outputCues = [];
    renderTexts('Waiting for subtitle…', 'Title Netflix này cho phép đọc full transcript.');
    setStatus('Live sync');
    startPlaybackTimer();
    return;
  }

  state.sourceCues = [];
  state.outputCues = [];
  renderTexts('Waiting for subtitle…', 'Đang live capture subtitle đang hiển thị.');
  setStatus('Live capture');
  startLiveCapture();
}

function startPlaybackTimer() {
  stopPlaybackTimer();
  state.activeIndex = -1;
  state.playbackSnapshotTimer = window.setInterval(syncPlaybackSnapshot, PIN_SNAPSHOT_MS);
  state.playbackRenderTimer = window.setInterval(syncPlayback, PIN_RENDER_MS);
  syncPlaybackSnapshot();
}

function stopPlaybackTimer() {
  if (state.playbackSnapshotTimer) {
    clearInterval(state.playbackSnapshotTimer);
    state.playbackSnapshotTimer = null;
  }
  if (state.playbackRenderTimer) {
    clearInterval(state.playbackRenderTimer);
    state.playbackRenderTimer = null;
  }
  state.activeIndex = -1;
}

function stopLiveCapture() {
  if (state.liveTimer) {
    clearInterval(state.liveTimer);
    state.liveTimer = null;
  }
  state.liveText = '';
}

function stopAllTimers() {
  stopPlaybackTimer();
  stopLiveCapture();
  if (state.refreshWatcher) {
    clearInterval(state.refreshWatcher);
    state.refreshWatcher = null;
  }
}

async function syncPlaybackSnapshot() {
  try {
    const snapshot = await executeInPage(pageGetPlaybackSnapshotPinned, []);
    if (!snapshot?.ok) return;
    state.playbackBaseMs = Math.max(0, Number(snapshot.currentTimeMs) || 0);
    state.playbackPerfMs = performance.now();
    state.playbackRate = Math.max(0.1, Number(snapshot.playbackRate) || 1);
    state.playbackIsPlaying = Boolean(snapshot.isPlaying);
    state.lastPlaybackSnapshotAt = Date.now();
  } catch {
    // ignore
  }
}

function estimatePlaybackTime() {
  let value = Number(state.playbackBaseMs) || 0;
  if (state.playbackIsPlaying) {
    value += (performance.now() - state.playbackPerfMs) * state.playbackRate;
  }
  if (state.platform === 'youtube') {
    value += Number(state.settings.youtubeLeadMs) || 0;
  }
  return Math.max(0, value);
}

function findCueIndex(cues, timeMs, activeIndex) {
  if (!cues.length) return -1;
  const activeCue = cues[activeIndex];
  const inCue = (cue, ms) => ms >= cue.startMs - 50 && ms < cue.endMs + 120;
  if (activeCue && inCue(activeCue, timeMs)) return activeIndex;
  for (let step = 1; step <= 3; step += 1) {
    const next = cues[activeIndex + step];
    if (next && inCue(next, timeMs)) return activeIndex + step;
    const prev = cues[activeIndex - step];
    if (prev && inCue(prev, timeMs)) return activeIndex - step;
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
  if (Math.abs((cues[candidate]?.startMs || 0) - timeMs) <= 520) return candidate;
  const prev = candidate - 1;
  if (prev >= 0 && Math.abs((cues[prev]?.endMs || 0) - timeMs) <= 380) return prev;
  return -1;
}

function syncPlayback() {
  if (!state.sourceCues.length) return;
  if (Date.now() - (state.lastPlaybackSnapshotAt || 0) > PIN_STALE_MS) {
    state.playbackIsPlaying = false;
  }
  state.playbackTimeMs = estimatePlaybackTime();
  const idx = findCueIndex(state.sourceCues, state.playbackTimeMs, state.activeIndex);
  const changed = idx !== state.activeIndex;
  if (changed) {
    state.activeIndex = idx;
    updateTextsFromCues();
    if (idx >= 0) appendReviewEntryFromActiveCue();
  }
  timeChipEl.textContent = formatTimestamp(state.playbackTimeMs);
  statusChipEl.textContent = state.playbackIsPlaying ? 'Playing' : 'Paused';
}

function updateTextsFromCues() {
  if (state.activeIndex < 0 || !state.sourceCues[state.activeIndex]) {
    renderTexts('Waiting for subtitle…', state.outputCues.length ? 'Đang chờ câu dịch kế tiếp…' : 'Chưa có dữ liệu dịch hoặc song ngữ.');
    return;
  }
  const sourceCue = state.sourceCues[state.activeIndex];
  let outputText = 'Chưa có dữ liệu dịch hoặc song ngữ.';
  if (state.outputCues.length) {
    const outputCue = findBestOutputCue(sourceCue, state.outputCues, state.activeIndex);
    if (outputCue?.text) outputText = outputCue.text;
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

function appendReviewEntryFromActiveCue() {
  const cue = state.sourceCues[state.activeIndex];
  if (!cue?.text) return;
  let outputText = '';
  if (state.outputCues.length) {
    const out = findBestOutputCue(cue, state.outputCues, state.activeIndex);
    if (out?.text) outputText = out.text;
  }
  appendReviewEntry({
    timeMs: cue.startMs,
    sourceText: cue.text,
    outputText,
    mode: state.platform === 'youtube' ? 'Cue' : 'Transcript',
  });
}

function appendReviewEntry({ timeMs, sourceText, outputText = '', mode = '' }) {
  const source = String(sourceText || '').trim();
  const output = String(outputText || '').trim();
  if (!source) return;
  const last = state.reviewEntries[state.reviewEntries.length - 1];
  if (last && last.sourceText === source && last.outputText === output) {
    last.timeMs = Math.max(last.timeMs, Number(timeMs) || 0);
    renderReviewLog();
    return;
  }
  state.reviewEntries.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timeMs: Math.max(0, Number(timeMs) || 0),
    sourceText: source,
    outputText: output,
    mode,
  });
  if (state.reviewEntries.length > PIN_MAX_REVIEW_ITEMS) {
    state.reviewEntries.splice(0, state.reviewEntries.length - PIN_MAX_REVIEW_ITEMS);
  }
  renderReviewLog();
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
      const text = String(snapshot.text || '').trim();
      if (!text) return;
      if (text !== state.liveText) {
        state.liveText = text;
        renderTexts(text, 'Live capture đang giữ lại toàn bộ các dòng đã bắt được.');
        appendReviewEntry({
          timeMs: state.playbackTimeMs,
          sourceText: text,
          outputText: '',
          mode: 'Live',
        });
      }
    } catch {
      // ignore
    }
  }, PIN_LIVE_CAPTURE_MS);
}

function renderTexts(sourceText, outputText) {
  sourceTextEl.textContent = sourceText || 'Waiting for subtitle…';
  outputTextEl.textContent = outputText || 'Chưa có dữ liệu dịch hoặc song ngữ.';
}

function renderReviewLog() {
  reviewCountEl.textContent = `${state.reviewEntries.length} dòng`;
  if (!reviewLogEl) return;
  if (!state.reviewEntries.length) {
    reviewLogEl.innerHTML = '<div class="pin-log-empty">Chưa có dòng nào được lưu. Khi subtitle đổi dòng, lịch sử sẽ xuất hiện ở đây.</div>';
    return;
  }
  const items = state.reviewEntries
    .map((entry, index) => {
      const isActive = index === state.reviewEntries.length - 1;
      return `
        <article class="pin-log-item${isActive ? ' is-active' : ''}">
          <div class="pin-log-top">
            <span class="pin-log-time">${escapeHtml(formatTimestamp(entry.timeMs))}</span>
            <span class="pin-log-mode">${escapeHtml(entry.mode || '')}</span>
          </div>
          <div class="pin-log-source">${escapeHtml(entry.sourceText)}</div>
          ${entry.outputText ? `<div class="pin-log-output">${escapeHtml(entry.outputText)}</div>` : ''}
        </article>
      `;
    })
    .join('');
  reviewLogEl.innerHTML = items;
  reviewLogEl.scrollTop = reviewLogEl.scrollHeight;
}

function setStatus(text) {
  statusChipEl.textContent = text || 'Ready';
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
}

function formatTimestamp(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function pageGetPlaybackSnapshotPinned() {
  try {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy player HTML5.' };
    return {
      ok: true,
      currentTimeMs: Math.round(Number(video.currentTime || 0) * 1000),
      playbackRate: Number(video.playbackRate || 1) || 1,
      isPlaying: !video.paused && !video.ended && Number(video.readyState || 0) >= 2,
      url: location.href,
    };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không đọc được trạng thái player.' };
  }
}

function pageGetYoutubeMetadataPinned() {
  const debug = [];
  function push(message) { debug.push(String(message)); }
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
  if (!playerResponse) return { ok: false, error: 'Không đọc được player response từ trang YouTube.', debug };
  const renderer = playerResponse?.captions?.playerCaptionsTracklistRenderer;
  const captionTracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
  const translationLanguages = Array.isArray(renderer?.translationLanguages) ? renderer.translationLanguages : [];
  push(`captionTracks=${captionTracks.length}`);
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
  const langs = translationLanguages.map((lang) => ({ languageCode: lang?.languageCode || '', name: getTextFromRuns(lang?.languageName) || lang?.languageCode || '' })).filter((item) => item.languageCode);
  return {
    ok: true,
    sourceTracks,
    translationLanguages: langs,
    defaultSourceIndex: 0,
    debug,
  };
}

async function pageFetchYoutubeTrackPinned(track) {
  function normalizeCueText(text) {
    return String(text || '').replace(/\u200b/g, '').replace(/\r/g, '').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
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
    const texts = Array.from(xml.querySelectorAll('text'));
    return texts.map((node) => {
      const startMs = Math.round((parseFloat(node.getAttribute('start') || '0') || 0) * 1000);
      const durMs = Math.round((parseFloat(node.getAttribute('dur') || '0') || 0) * 1000);
      const endMs = durMs > 0 ? startMs + durMs : startMs + 1800;
      const html = Array.from(node.childNodes).map((child) => child.textContent || '').join('');
      const text = normalizeCueText(decodeHtmlEntities(html || node.textContent || ''));
      return text ? { startMs, endMs, text } : null;
    }).filter(Boolean);
  }
  function parseVtt(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const lines = block.split('\n');
        const timing = lines.find((line) => line.includes('-->'));
        if (!timing) return null;
        const parts = timing.split(/\s+-->\s+/);
        if (parts.length !== 2) return null;
        const startMs = parseClockToMs(parts[0].split(' ')[0]);
        const endMs = parseClockToMs(parts[1].split(' ')[0]);
        const body = normalizeCueText(lines.slice(lines.indexOf(timing) + 1).join('\n'));
        return body ? { startMs, endMs: endMs > startMs ? endMs : startMs + 1800, text: body } : null;
      })
      .filter(Boolean);
  }
  function parseJson(data) {
    const events = Array.isArray(data?.events) ? data.events : [];
    return events.map((event) => {
      const startMs = Number(event.tStartMs || event.tStartMs === 0 ? event.tStartMs : 0);
      const durMs = Number(event.dDurationMs || 0);
      const segs = Array.isArray(event.segs) ? event.segs : [];
      const text = normalizeCueText(segs.map((seg) => decodeHtmlEntities(seg.utf8 || '')).join(''));
      return text ? { startMs, endMs: durMs > 0 ? startMs + durMs : startMs + 1800, text } : null;
    }).filter(Boolean);
  }
  function parseJsonText(raw) {
    let text = String(raw || '').trim();
    if (!text) return null;
    text = text.replace(/^\)\]\}'\s*/, '');
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  async function fetchAndParse(url) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return [];
    const raw = await response.text();
    if (!raw.trim()) return [];
    const jsonData = parseJsonText(raw);
    if (jsonData) {
      const cues = parseJson(jsonData);
      if (cues.length) return cues;
    }
    if (/^WEBVTT/i.test(raw) || raw.includes('-->')) {
      const cues = parseVtt(raw);
      if (cues.length) return cues;
    }
    if (raw.includes('<text') || raw.includes('<transcript')) {
      const cues = parseXml(raw);
      if (cues.length) return cues;
    }
    return [];
  }

  try {
    const candidates = [];
    const base = new URL(track.baseUrl, location.href);
    if (track.isTranslation && track.targetLanguageCode) base.searchParams.set('tlang', track.targetLanguageCode);
    const jsonUrl = new URL(base.toString());
    jsonUrl.searchParams.set('fmt', 'json3');
    candidates.push(jsonUrl.toString());
    const vttUrl = new URL(base.toString());
    vttUrl.searchParams.set('fmt', 'vtt');
    candidates.push(vttUrl.toString());
    candidates.push(base.toString());

    for (const candidate of candidates) {
      const cues = await fetchAndParse(candidate);
      if (cues.length) return { ok: true, cues };
    }

    return { ok: false, error: 'Timedtext không trả về cue nào có thể parse.' };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không tải được timedtext.' };
  }
}

function pageGetNetflixMetadataPinned() {
  const debug = [];
  const push = (line) => debug.push(String(line));
  try {
    const video = document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy video Netflix đang phát.', debug };
    const textTracks = Array.from(video.textTracks || []).filter((track) => ['subtitles', 'captions'].includes(String(track.kind || '').toLowerCase()));
    const activeIndex = textTracks.findIndex((track) => String(track.mode || '').toLowerCase() === 'showing');
    push(`textTracks=${textTracks.length}`);
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
    return { ok: true, sourceTracks, defaultSourceIndex: activeIndex >= 0 ? activeIndex : 0, debug };
  } catch (error) {
    push(error?.message || 'Unknown error');
    return { ok: false, error: error?.message || 'Không đọc được metadata Netflix.', debug };
  }
}

async function pageFetchNetflixTrackPinned(track) {
  function normalizeText(value) { return String(value || '').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').replace(/[ \t]{2,}/g, ' ').trim(); }
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
