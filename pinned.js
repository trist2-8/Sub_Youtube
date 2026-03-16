const STORAGE_KEY = 'ytSubtitleGrabberSettingsV8';
const ORIGINAL_LANGUAGE_SENTINEL = '__original__';

const refreshBtn = document.getElementById('refreshPinnedBtn');
const titleEl = document.getElementById('pinTitle');
const platformChipEl = document.getElementById('pinPlatformChip');
const statusChipEl = document.getElementById('pinStatusChip');
const timeChipEl = document.getElementById('pinTimeChip');
const sourceLabelEl = document.getElementById('pinSourceLabel');
const outputLabelEl = document.getElementById('pinOutputLabel');
const sourceTextEl = document.getElementById('pinSourceText');
const outputTextEl = document.getElementById('pinOutputText');
const footerNoteEl = document.getElementById('pinFooterNote');

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
  playbackTimer: null,
  liveTimer: null,
  refreshWatcher: null,
  playbackBaseMs: 0,
  playbackPerfMs: 0,
  playbackRate: 1,
  playbackIsPlaying: false,
  playbackTimeMs: 0,
  activeIndex: -1,
  liveText: '',
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
    if (saved && typeof saved === 'object') {
      state.settings = { ...state.settings, ...saved };
    }
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

async function loadPinnedData({ force = false } = {}) {
  stopPlaybackTimer();
  stopLiveCapture();
  const tab = await getTargetTab();
  if (!tab?.url) {
    setStatus('Không tìm thấy tab video.');
    renderTexts('Waiting for subtitle…', 'Chưa có dữ liệu dịch hoặc song ngữ.');
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

  renderTexts('Waiting for subtitle…', 'Mở video YouTube hoặc Netflix rồi bấm nút ghim từ popup chính.');
  setStatus('Tab hiện tại không phải YouTube hoặc Netflix.');
}

async function loadYoutubePinned(force) {
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
  footerNoteEl.textContent = 'Cửa sổ ghim chạy độc lập, không can thiệp popup chính.';

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

  if (!state.outputCues.length) {
    outputLabelEl.textContent = 'Output';
  }

  setStatus('Live sync');
  startPlaybackTimer();
}

async function loadNetflixPinned(force) {
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
  footerNoteEl.textContent = 'Nếu title Netflix không lộ full track, cửa sổ ghim sẽ chuyển sang live capture.';

  const sourceResult = await executeInPage(pageFetchNetflixTrackPinned, [sourceTrack]);
  if (sourceResult?.ok && sourceResult.cues?.length) {
    state.sourceCues = sourceResult.cues;
    state.outputCues = [];
    setStatus('Live sync');
    startPlaybackTimer();
    return;
  }

  state.sourceCues = [];
  state.outputCues = [];
  renderTexts('Waiting for subtitle…', 'Đang chuyển sang live capture subtitle đang hiển thị.');
  setStatus('Live capture');
  startLiveCapture();
}

function startPlaybackTimer() {
  stopPlaybackTimer();
  state.playbackTimer = window.setInterval(syncPlayback, 50);
  syncPlaybackSnapshot();
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
  if (activeCue && timeMs >= activeCue.startMs - 30 && timeMs < activeCue.endMs + 90) return activeIndex;
  for (let step = 1; step <= 3; step += 1) {
    const idx = activeIndex + step;
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
  if (!state.sourceCues.length) return;
  state.playbackTimeMs = estimatePlaybackTime();
  const idx = findCueIndex(state.sourceCues, state.playbackTimeMs, state.activeIndex);
  if (idx !== state.activeIndex) {
    state.activeIndex = idx;
    updateTextsFromCues();
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
        renderTexts(snapshot.text, 'Netflix không cung cấp full transcript cho title này.');
      }
    } catch {
      // ignore
    }
  }, 140);
}

function renderTexts(sourceText, outputText) {
  sourceTextEl.textContent = sourceText || 'Waiting for subtitle…';
  outputTextEl.textContent = outputText || 'Chưa có dữ liệu dịch hoặc song ngữ.';
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
  try {
    const url = new URL(track.baseUrl, location.href);
    url.searchParams.set('fmt', 'json3');
    if (track.isTranslation && track.targetLanguageCode) url.searchParams.set('tlang', track.targetLanguageCode);
    const response = await fetch(url.toString(), { credentials: 'same-origin', cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      const cues = parseJson(data);
      if (cues.length) return { ok: true, cues };
    }
    const fallback = new URL(track.baseUrl, location.href);
    if (track.isTranslation && track.targetLanguageCode) fallback.searchParams.set('tlang', track.targetLanguageCode);
    const xmlResponse = await fetch(fallback.toString(), { credentials: 'same-origin', cache: 'no-store' });
    const xmlText = await xmlResponse.text();
    const cues = parseXml(xmlText);
    return cues.length ? { ok: true, cues } : { ok: false, error: 'Timedtext không trả về cue nào.' };
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
