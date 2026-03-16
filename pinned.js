const STORAGE_KEY = 'ytSubtitleGrabberSettingsV8';
const ORIGINAL_LANGUAGE_SENTINEL = '__original__';
const MAX_LOG_ITEMS = 250;
const SNAPSHOT_INTERVAL_MS = 220;
const RENDER_INTERVAL_MS = 45;
const LIVE_INTERVAL_MS = 140;

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
const logListEl = document.getElementById('pinLogList');
const logHintEl = document.getElementById('pinLogHint');

const params = new URLSearchParams(location.search);
const targetTabIdFromUrl = Number(params.get('tabId')) || null;

const state = {
  tabId: targetTabIdFromUrl,
  lastUrl: '',
  platform: '',
  isLoading: false,
  settings: {
    preferredTargetLanguage: ORIGINAL_LANGUAGE_SENTINEL,
    youtubeLeadMs: 320,
  },
  sourceLabel: 'Original',
  outputLabel: 'Output',
  sourceCues: [],
  outputCues: [],
  reviewEntries: [],
  playbackSnapshotTimer: null,
  playbackRenderTimer: null,
  liveTimer: null,
  refreshWatcher: null,
  playbackBaseMs: 0,
  playbackPerfMs: 0,
  playbackRate: 1,
  playbackIsPlaying: false,
  playbackTimeMs: 0,
  activeIndex: -1,
  lastRenderedSourceText: '',
  lastRenderedOutputText: '',
  lastLogKey: '',
  liveText: '',
  liveType: '',
};

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error(error);
    setStatus(error?.message || 'Không khởi tạo được cửa sổ ghim.');
  });
});

refreshBtn?.addEventListener('click', () => loadPinnedData({ force: true, resetLog: false }));
window.addEventListener('beforeunload', stopAllTimers);

async function init() {
  await loadSettings();
  renderReviewLog();
  setStatus('Đang kết nối với tab video…');
  await loadPinnedData({ force: true, resetLog: true });
  state.refreshWatcher = window.setInterval(async () => {
    const tab = await getTargetTab();
    if (!tab?.url) return;
    if (tab.url !== state.lastUrl) {
      await loadPinnedData({ force: true, resetLog: true });
    }
  }, 1200);
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
  state.settings.youtubeLeadMs = Number.isFinite(lead) ? lead : 320;
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

async function loadPinnedData({ force = false, resetLog = false } = {}) {
  if (state.isLoading && !force) return;
  state.isLoading = true;
  stopPlaybackTimers();
  stopLiveCapture();

  const tab = await getTargetTab();
  if (!tab?.url) {
    state.isLoading = false;
    setStatus('Không tìm thấy tab video.');
    renderTexts('Waiting for subtitle…', 'Mở YouTube hoặc Netflix rồi bấm ghim từ popup chính.');
    return;
  }

  const sameVideo = state.lastUrl && state.lastUrl === tab.url;
  if (resetLog || !sameVideo) {
    state.reviewEntries = [];
    state.lastLogKey = '';
    renderReviewLog();
  }

  state.lastUrl = tab.url;
  state.platform = detectPlatform(tab.url);
  state.sourceCues = [];
  state.outputCues = [];
  state.activeIndex = -1;
  state.lastRenderedSourceText = '';
  state.lastRenderedOutputText = '';
  state.liveText = '';
  state.liveType = '';
  updateCountChip(0);

  platformChipEl.textContent = state.platform ? state.platform.toUpperCase() : 'Unsupported';
  titleEl.textContent = tab.title || 'Video';
  sourceLabelEl.textContent = 'Original';
  outputLabelEl.textContent = 'Output';

  try {
    if (state.platform === 'youtube') {
      await loadYoutubePinned();
    } else if (state.platform === 'netflix') {
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
  footerNoteEl.textContent = 'Pin YouTube sẽ ưu tiên full timedtext. Nếu timedtext lỗi, pin tự chuyển sang live caption overlay.';
  logHintEl.textContent = 'Tự lưu mỗi khi YouTube đổi câu';

  const metadata = await executeInPage(pageGetYoutubeMetadataPinned, []);
  if (!metadata?.ok || !metadata.sourceTracks?.length) {
    renderTexts('Waiting for subtitle…', 'Video YouTube này chưa có phụ đề hoặc chưa đọc được track.');
    setStatus(metadata?.error || 'Không đọc được metadata YouTube.');
    return;
  }

  const sourceTrack = metadata.sourceTracks[Math.max(0, metadata.defaultSourceIndex || 0)];
  state.sourceLabel = sourceTrack.name || sourceTrack.languageCode || 'Original';
  sourceLabelEl.textContent = state.sourceLabel;
  outputLabelEl.textContent = 'Output';

  const sourceResult = await executeInPage(pageFetchYoutubeTrackPinned, [sourceTrack]);
  if (sourceResult?.ok && sourceResult.cues?.length) {
    state.sourceCues = sourceResult.cues;
    updateCountChip(state.sourceCues.length);

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

    renderTexts('Waiting for subtitle…', state.outputCues.length ? 'Đang chờ câu dịch khớp theo thời gian…' : 'Đang theo dõi phụ đề gốc từ timedtext.');
    setStatus('Live sync');
    startPlaybackTimers();
    return;
  }

  renderTexts('Waiting for subtitle…', 'Timedtext không parse được. Pin chuyển sang live caption overlay để vẫn theo dõi được subtitle.');
  setStatus(sourceResult?.error || 'Live overlay');
  updateCountChip(0);
  startLiveCapture('youtube');
}

async function loadNetflixPinned() {
  footerNoteEl.textContent = 'Nếu title Netflix không lộ full track, cửa sổ ghim sẽ giữ lại toàn bộ live capture theo thời gian.';
  logHintEl.textContent = 'Tự lưu mỗi khi Netflix đổi câu';

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
    updateCountChip(state.sourceCues.length);
    renderTexts('Waiting for subtitle…', 'Title Netflix này cho phép đọc full transcript.');
    setStatus('Live sync');
    startPlaybackTimers();
    return;
  }

  renderTexts('Waiting for subtitle…', 'Đang live capture subtitle Netflix đang hiển thị.');
  setStatus('Live capture');
  updateCountChip(state.reviewEntries.length);
  startLiveCapture('netflix');
}

function startPlaybackTimers() {
  stopPlaybackTimers();
  state.activeIndex = -1;
  state.playbackSnapshotTimer = window.setInterval(syncPlaybackSnapshot, SNAPSHOT_INTERVAL_MS);
  state.playbackRenderTimer = window.setInterval(syncPlayback, RENDER_INTERVAL_MS);
  syncPlaybackSnapshot();
}

function stopPlaybackTimers() {
  if (state.playbackSnapshotTimer) {
    clearInterval(state.playbackSnapshotTimer);
    state.playbackSnapshotTimer = null;
  }
  if (state.playbackRenderTimer) {
    clearInterval(state.playbackRenderTimer);
    state.playbackRenderTimer = null;
  }
}

function stopLiveCapture() {
  if (state.liveTimer) {
    clearInterval(state.liveTimer);
    state.liveTimer = null;
  }
  state.liveText = '';
  state.liveType = '';
}

function stopAllTimers() {
  stopPlaybackTimers();
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
  if (activeCue && timeMs >= activeCue.startMs - 35 && timeMs < activeCue.endMs + 95) return activeIndex;
  for (let step = 1; step <= 3; step += 1) {
    const idx = activeIndex + step;
    if (cues[idx] && timeMs >= cues[idx].startMs - 35 && timeMs < cues[idx].endMs + 95) return idx;
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
  if (!state.sourceCues.length) return;
  state.playbackTimeMs = estimatePlaybackTime();
  timeChipEl.textContent = formatTimestamp(state.playbackTimeMs);
  statusChipEl.textContent = state.playbackIsPlaying ? 'Playing' : 'Paused';

  const idx = findCueIndex(state.sourceCues, state.playbackTimeMs, state.activeIndex);
  if (idx !== state.activeIndex) {
    state.activeIndex = idx;
    updateTextsFromCues();
  }
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
  appendReviewEntry({
    timeMs: sourceCue.startMs,
    sourceText: sourceCue.text || '',
    outputText,
    type: state.platform === 'youtube' ? 'YouTube cue' : 'Cue',
  });
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

function startLiveCapture(platform) {
  stopLiveCapture();
  const snapshotFunc = platform === 'youtube' ? pageGetYoutubeLiveSnapshotPinned : pageGetNetflixLiveSnapshotPinned;
  state.liveType = platform;
  state.liveTimer = window.setInterval(async () => {
    try {
      const snapshot = await executeInPage(snapshotFunc, []);
      if (!snapshot?.ok) return;
      state.playbackTimeMs = Math.max(0, Number(snapshot.currentTimeMs) || 0);
      timeChipEl.textContent = formatTimestamp(state.playbackTimeMs);
      statusChipEl.textContent = snapshot.text ? (platform === 'youtube' ? 'Live overlay' : 'Live capture') : 'Waiting';
      if (snapshot.text && snapshot.text !== state.liveText) {
        state.liveText = snapshot.text;
        const outputText = platform === 'youtube'
          ? 'Đang theo dõi caption overlay của YouTube vì timedtext không parse được ở tab này.'
          : 'Netflix không cung cấp full transcript cho title này.';
        renderTexts(snapshot.text, outputText);
        appendReviewEntry({
          timeMs: state.playbackTimeMs,
          sourceText: snapshot.text,
          outputText,
          type: platform === 'youtube' ? 'YouTube live' : 'Netflix live',
        });
      }
    } catch {
      // ignore
    }
  }, LIVE_INTERVAL_MS);
}

function renderTexts(sourceText, outputText) {
  const normalizedSource = String(sourceText || 'Waiting for subtitle…').trim() || 'Waiting for subtitle…';
  const normalizedOutput = String(outputText || 'Chưa có dữ liệu dịch hoặc song ngữ.').trim() || 'Chưa có dữ liệu dịch hoặc song ngữ.';
  sourceTextEl.textContent = normalizedSource;
  outputTextEl.textContent = normalizedOutput;
  state.lastRenderedSourceText = normalizedSource;
  state.lastRenderedOutputText = normalizedOutput;
}

function appendReviewEntry({ timeMs = 0, sourceText = '', outputText = '', type = 'Cue' }) {
  const source = String(sourceText || '').trim();
  const output = String(outputText || '').trim();
  if (!source) return;
  const key = `${type}|${source}|${output}`;
  if (key === state.lastLogKey) return;
  state.lastLogKey = key;
  state.reviewEntries.unshift({
    timeMs: Math.max(0, Number(timeMs) || 0),
    sourceText: source,
    outputText: output,
    type,
  });
  if (state.reviewEntries.length > MAX_LOG_ITEMS) state.reviewEntries.length = MAX_LOG_ITEMS;
  updateCountChip(state.reviewEntries.length || state.sourceCues.length);
  renderReviewLog();
}

function renderReviewLog() {
  if (!logListEl) return;
  if (!state.reviewEntries.length) {
    logListEl.classList.add('empty');
    logListEl.innerHTML = '<div class="pin-log-empty">Chưa có dòng nào được lưu. Khi subtitle đổi dòng, lịch sử sẽ xuất hiện ở đây.</div>';
    return;
  }
  logListEl.classList.remove('empty');
  logListEl.innerHTML = state.reviewEntries.map((entry) => {
    return `
      <article class="pin-log-item">
        <div class="pin-log-meta">
          <span class="pin-log-time">${escapeHtml(formatTimestamp(entry.timeMs))}</span>
          <span class="pin-log-type">${escapeHtml(entry.type)}</span>
        </div>
        <div class="pin-log-source">${escapeHtml(entry.sourceText).replace(/\n/g, '<br>')}</div>
        <div class="pin-log-output">${escapeHtml(entry.outputText).replace(/\n/g, '<br>')}</div>
      </article>
    `;
  }).join('');
}

function updateCountChip(value) {
  const count = Math.max(0, Number(value) || 0);
  countChipEl.textContent = `${count} dòng`;
}

function setStatus(text) {
  statusChipEl.textContent = text || 'Ready';
}

function formatTimestamp(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  const push = (message) => debug.push(String(message));

  function getTextFromRuns(node) {
    if (!node) return '';
    if (typeof node.simpleText === 'string') return node.simpleText;
    if (Array.isArray(node.runs)) return node.runs.map((item) => item.text || '').join('');
    return '';
  }

  function normalizeBaseUrl(url) {
    try {
      return new URL(String(url || '').replace(/\\u0026/g, '&'), location.href).toString();
    } catch {
      return '';
    }
  }

  function extractBalancedJson(source, assignmentIndex) {
    const start = source.indexOf('{', assignmentIndex);
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escaping = false;
    for (let i = start; i < source.length; i += 1) {
      const char = source[i];
      if (inString) {
        if (escaping) escaping = false;
        else if (char === '\\') escaping = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(start, i + 1);
      }
    }
    return null;
  }

  function tryParsePlayerResponseFromScripts() {
    const markers = [
      'var ytInitialPlayerResponse = ',
      'ytInitialPlayerResponse = ',
      'window["ytInitialPlayerResponse"] = ',
      'ytplayer.config = ',
    ];
    const scripts = Array.from(document.scripts).map((script) => script.textContent || '').filter(Boolean);
    for (const source of scripts) {
      for (const marker of markers) {
        const markerIndex = source.indexOf(marker);
        if (markerIndex === -1) continue;
        const jsonText = extractBalancedJson(source, markerIndex + marker.length);
        if (!jsonText) continue;
        try {
          const parsed = JSON.parse(jsonText);
          if (marker === 'ytplayer.config = ') {
            const raw = parsed?.args?.player_response;
            if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw;
          } else {
            return parsed;
          }
        } catch (error) {
          push(`Parse script marker thất bại (${marker}): ${error.message}`);
        }
      }
    }
    return null;
  }

  function getPlayerResponse() {
    try {
      const player = document.getElementById('movie_player');
      const response = player?.getPlayerResponse?.();
      if (response && typeof response === 'object') return response;
    } catch (error) {
      push(`movie_player.getPlayerResponse lỗi: ${error.message}`);
    }
    try {
      if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
    } catch {}
    try {
      const raw = window.ytplayer?.config?.args?.player_response;
      if (raw) return JSON.parse(raw);
    } catch (error) {
      push(`ytplayer.config lỗi: ${error.message}`);
    }
    return tryParsePlayerResponseFromScripts();
  }

  function getCurrentCaptionTrackHint() {
    try {
      const player = document.getElementById('movie_player');
      const current = player?.getOption?.('captions', 'track');
      if (current && typeof current === 'object') {
        return {
          languageCode: current.languageCode || current.lang || '',
          vssId: current.vssId || current.vss_id || '',
          kind: current.kind || '',
        };
      }
    } catch {}
    return null;
  }

  const playerResponse = getPlayerResponse();
  if (!playerResponse) return { ok: false, error: 'Không đọc được player response từ trang YouTube.', debug };

  const renderer = playerResponse?.captions?.playerCaptionsTracklistRenderer;
  const captionTracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
  const translationLanguages = Array.isArray(renderer?.translationLanguages) ? renderer.translationLanguages : [];
  if (!captionTracks.length) return { ok: false, error: 'Video YouTube này không có captionTracks.', debug };

  const sourceTracks = captionTracks.map((track, index) => {
    const languageCode = track.languageCode || 'unknown';
    const displayName = getTextFromRuns(track.name) || languageCode;
    const isAuto = track.kind === 'asr';
    return {
      index,
      label: `${displayName} [${languageCode}]${isAuto ? ' • auto' : ''}`,
      languageCode,
      baseUrl: normalizeBaseUrl(track.baseUrl),
      kind: track.kind || 'standard',
      name: displayName,
      vssId: track.vssId || '',
      isAuto,
      isTranslatable: Boolean(track.isTranslatable),
      isTranslation: false,
      sourceLanguageCode: languageCode,
      sourceName: displayName,
    };
  });

  const currentHint = getCurrentCaptionTrackHint();
  let defaultSourceIndex = 0;
  if (currentHint) {
    const byVssId = sourceTracks.findIndex((track) => track.vssId && currentHint.vssId && track.vssId === currentHint.vssId);
    const byLang = sourceTracks.findIndex((track) => track.languageCode === currentHint.languageCode && (!currentHint.kind || track.kind === currentHint.kind || track.isAuto === (currentHint.kind === 'asr')));
    defaultSourceIndex = byVssId >= 0 ? byVssId : (byLang >= 0 ? byLang : 0);
  } else {
    const firstManual = sourceTracks.findIndex((track) => !track.isAuto);
    defaultSourceIndex = firstManual >= 0 ? firstManual : 0;
  }

  return {
    ok: true,
    sourceTracks,
    translationLanguages: translationLanguages.map((lang) => ({
      languageCode: lang?.languageCode || '',
      name: getTextFromRuns(lang?.languageName) || lang?.languageCode || '',
    })).filter((item) => item.languageCode),
    defaultSourceIndex,
    debug,
  };
}

async function pageFetchYoutubeTrackPinned(track) {
  const debug = [];
  const push = (message) => debug.push(String(message));

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

  function parseJson3ToCues(data) {
    const events = Array.isArray(data?.events) ? data.events : [];
    const cues = [];
    for (const event of events) {
      const startMs = Number(event?.tStartMs ?? 0);
      const durMs = Number(event?.dDurationMs ?? 0);
      const segs = Array.isArray(event?.segs) ? event.segs : [];
      const text = normalizeCueText(segs.map((seg) => decodeHtmlEntities(seg?.utf8 || '')).join(''));
      if (!text) continue;
      cues.push({
        startMs,
        endMs: durMs > 0 ? startMs + durMs : startMs + 1800,
        text,
      });
    }
    return cues;
  }

  function parseXmlToCues(text) {
    const xml = new DOMParser().parseFromString(String(text || ''), 'text/xml');
    const nodes = Array.from(xml.querySelectorAll('text, p'));
    return nodes.map((node) => {
      const startRaw = node.getAttribute('start') || node.getAttribute('begin') || '0';
      const endRaw = node.getAttribute('end') || '';
      const durRaw = node.getAttribute('dur') || node.getAttribute('d') || '0';
      const startMs = parseClockToMs(startRaw);
      const durMs = endRaw ? Math.max(0, parseClockToMs(endRaw) - startMs) : parseClockToMs(durRaw);
      const textContent = normalizeCueText(decodeHtmlEntities(node.textContent || ''));
      return textContent ? { startMs, endMs: durMs > 0 ? startMs + durMs : startMs + 1800, text: textContent } : null;
    }).filter(Boolean);
  }

  function parseClockToMs(value) {
    const raw = String(value || '').trim().replace(',', '.');
    if (!raw) return 0;
    if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(parseFloat(raw) * 1000);
    const match = raw.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!match) return 0;
    return Number(match[1] || 0) * 3600000 + Number(match[2] || 0) * 60000 + Number(match[3] || 0) * 1000 + Number((match[4] || '0').padEnd(3, '0'));
  }

  function parseVttToCues(text) {
    const blocks = String(text || '').replace(/\r/g, '').split(/\n\n+/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split('\n').map((line) => line.trimEnd());
      const timingIndex = lines.findIndex((line) => line.includes('-->'));
      if (timingIndex === -1) continue;
      const [startRaw, endRaw] = lines[timingIndex].split('-->').map((part) => part.trim().split(/\s+/)[0]);
      const payload = lines.slice(timingIndex + 1).join('\n').trim();
      const clean = normalizeCueText(payload.replace(/<[^>]+>/g, ''));
      if (!clean) continue;
      const startMs = parseClockToMs(startRaw);
      const endMs = parseClockToMs(endRaw);
      cues.push({ startMs, endMs: endMs > startMs ? endMs : startMs + 1800, text: clean });
    }
    return cues;
  }

  function parseContent(text, contentType) {
    const trimmed = String(text || '').trim();
    const type = String(contentType || '').toLowerCase();
    if (!trimmed) return { format: 'empty', cues: [] };
    if (trimmed.startsWith('{') || trimmed.startsWith('[') || type.includes('json')) {
      try {
        return { format: 'json3', cues: parseJson3ToCues(JSON.parse(trimmed)) };
      } catch (error) {
        push(`Parse JSON lỗi: ${error.message}`);
      }
    }
    if (/^WEBVTT/i.test(trimmed) || type.includes('vtt')) {
      return { format: 'vtt', cues: parseVttToCues(trimmed) };
    }
    if (trimmed.startsWith('<') || type.includes('xml') || type.includes('ttml')) {
      return { format: 'xml', cues: parseXmlToCues(trimmed) };
    }
    return { format: 'unknown', cues: [] };
  }

  function safeUrl(url) {
    try {
      return new URL(String(url || '').replace(/\\u0026/g, '&'), location.href);
    } catch {
      return null;
    }
  }

  function buildEffectiveTrackUrl(item) {
    const parsed = safeUrl(item.baseUrl);
    if (!parsed) return '';
    if (item.isTranslation && item.targetLanguageCode) {
      parsed.searchParams.set('tlang', item.targetLanguageCode);
      parsed.searchParams.set('lang', item.sourceLanguageCode || item.languageCode);
    } else {
      parsed.searchParams.delete('tlang');
      parsed.searchParams.set('lang', item.languageCode);
    }
    return parsed.toString();
  }

  function addCandidate(candidates, seen, url, reason) {
    const parsed = safeUrl(url);
    if (!parsed) return;
    parsed.hash = '';
    const normalized = parsed.toString();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push({ url: normalized, reason });
  }

  function buildFormatVariants(url, item) {
    const parsed = safeUrl(url);
    if (!parsed) return [];
    if (item.isTranslation && item.targetLanguageCode) {
      parsed.searchParams.set('tlang', item.targetLanguageCode);
      parsed.searchParams.set('lang', item.sourceLanguageCode || item.languageCode);
    } else {
      parsed.searchParams.delete('tlang');
      parsed.searchParams.set('lang', item.languageCode);
    }
    const raw = parsed.toString();
    const variants = [raw];
    for (const fmt of ['json3', 'srv3', 'vtt', 'ttml']) {
      const variant = new URL(raw);
      variant.searchParams.set('fmt', fmt);
      variants.push(variant.toString());
    }
    const noFmt = new URL(raw);
    noFmt.searchParams.delete('fmt');
    variants.push(noFmt.toString());
    return variants;
  }

  function matchesTrack(url, item) {
    const parsed = safeUrl(url);
    if (!parsed || !parsed.pathname.includes('/api/timedtext')) return false;
    const lang = parsed.searchParams.get('lang');
    const tlang = parsed.searchParams.get('tlang');
    const vssId = parsed.searchParams.get('vssid') || parsed.searchParams.get('vss_id');
    if (item.isTranslation) {
      return (!item.vssId || !vssId || item.vssId === vssId)
        && lang === (item.sourceLanguageCode || item.languageCode)
        && tlang === item.targetLanguageCode;
    }
    if (item.vssId && vssId && item.vssId !== vssId) return false;
    return lang === item.languageCode && !tlang;
  }

  function collectNetworkTimedtextUrls(item) {
    return (performance.getEntriesByType('resource') || [])
      .map((entry) => entry?.name || '')
      .filter((name) => name.includes('/api/timedtext') && matchesTrack(name, item));
  }

  async function tryActivateTrack(item) {
    const player = document.getElementById('movie_player');
    if (!player) return;
    try { player.loadModule?.('captions'); } catch {}
    const baseLanguage = item.sourceLanguageCode || item.languageCode;
    const payloads = [
      { languageCode: baseLanguage },
      { languageCode: baseLanguage, kind: item.kind },
      item.vssId ? { languageCode: baseLanguage, vssId: item.vssId } : null,
      item.vssId ? { languageCode: baseLanguage, vss_id: item.vssId } : null,
    ].filter(Boolean);
    for (const payload of payloads) {
      try { player.setOption?.('captions', 'track', payload); } catch {}
    }
    try { player.setOption?.('captions', 'reload', true); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 900));
  }

  async function tryFetchCandidates(candidates) {
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate.url, {
          credentials: 'include',
          cache: 'no-store',
        });
        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();
        const parsed = parseContent(text, contentType);
        push(`Thử ${candidate.reason}: status=${response.status}, type=${contentType || 'unknown'}, chars=${text.trim().length}, format=${parsed.format}, cues=${parsed.cues.length}`);
        if (!response.ok) continue;
        if (parsed.cues.length) {
          return {
            ok: true,
            cues: parsed.cues,
            sourceUrl: candidate.url,
            sourceFormat: parsed.format,
            source: 'timedtext',
            debug,
          };
        }
      } catch (error) {
        push(`Fetch lỗi (${candidate.reason}): ${error.message}`);
      }
    }
    return null;
  }

  try {
    const candidates = [];
    const seen = new Set();
    const effectiveUrl = buildEffectiveTrackUrl(track);
    if (!effectiveUrl) {
      return { ok: false, error: 'Track YouTube không có baseUrl hợp lệ.', debug };
    }

    for (const variant of buildFormatVariants(effectiveUrl, track)) {
      addCandidate(candidates, seen, variant, 'baseUrl');
    }

    for (const networkUrl of collectNetworkTimedtextUrls(track)) {
      for (const variant of buildFormatVariants(networkUrl, track)) {
        addCandidate(candidates, seen, variant, 'performance');
      }
    }

    let result = await tryFetchCandidates(candidates);
    if (result) return result;

    await tryActivateTrack(track);

    for (const networkUrl of collectNetworkTimedtextUrls(track)) {
      for (const variant of buildFormatVariants(networkUrl, track)) {
        addCandidate(candidates, seen, variant, 'performance-after-activate');
      }
    }

    result = await tryFetchCandidates(candidates);
    if (result) return result;

    return { ok: false, error: 'Timedtext không trả về cue nào có thể parse.', debug };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không tải được timedtext.', debug };
  }
}

function pageGetYoutubeLiveSnapshotPinned() {
  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }
  const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
  if (!video) return { ok: false, error: 'Không tìm thấy video.' };
  const selectors = [
    '.ytp-caption-window-container .ytp-caption-segment',
    '.ytp-caption-segment',
    '.captions-text .caption-visual-line',
    'ytd-transcript-segment-renderer[is-active] .segment-text',
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

function pageGetNetflixMetadataPinned() {
  const debug = [];
  const push = (line) => debug.push(String(line));
  try {
    const video = document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy video Netflix đang phát.', debug };
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
    return { ok: true, sourceTracks, defaultSourceIndex: activeIndex >= 0 ? activeIndex : 0, debug };
  } catch (error) {
    push(error?.message || 'Unknown error');
    return { ok: false, error: error?.message || 'Không đọc được metadata Netflix.', debug };
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
