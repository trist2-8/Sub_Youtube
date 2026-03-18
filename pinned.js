const STORAGE_KEY = 'ytSubtitleGrabberSettingsV8';
const PIN_PREFS_KEY = 'ytSubtitleGrabberPinPrefsV1';
const ORIGINAL_LANGUAGE_SENTINEL = '__original__';

const refreshBtn = document.getElementById('refreshPinnedBtn');
const titleEl = document.getElementById('pinTitle');
const platformChipEl = document.getElementById('pinPlatformChip');
const modeChipEl = document.getElementById('pinModeChip');
const syncChipEl = document.getElementById('pinSyncChip');
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
const autoPauseBtn = document.getElementById('pinAutoPauseBtn');
const prevCueBtn = document.getElementById('pinPrevCueBtn');
const replayCueBtn = document.getElementById('pinReplayCueBtn');
const nextCueBtn = document.getElementById('pinNextCueBtn');
const copyTranscriptBtn = document.getElementById('pinCopyTranscriptBtn');
const copyCueBtn = document.getElementById('pinCopyCueBtn');
const revealNextBtn = document.getElementById('pinRevealNextBtn');
const playPauseBtn = document.getElementById('pinPlayPauseBtn');
const prevPreviewTextEl = document.getElementById('pinPrevPreviewText');
const nextPreviewCardEl = document.getElementById('pinNextPreviewCard');
const nextPreviewTextEl = document.getElementById('pinNextPreviewText');
const hotkeysHintEl = document.getElementById('pinHotkeysHint');
const sourceCardEl = document.getElementById('pinSourceCard');
const outputCardEl = document.getElementById('pinOutputCard');

const params = new URLSearchParams(location.search);
const targetTabIdFromUrl = Number(params.get('tabId')) || null;
const preferredModeFromUrl = params.get('mode') || '';

const state = {
  tabId: targetTabIdFromUrl,
  lastUrl: '',
  platform: 'default',
  sourceKind: '',
  pinMode: preferredModeFromUrl || 'dual',
  pinPrefs: null,
  settings: {
    preferredTargetLanguage: ORIGINAL_LANGUAGE_SENTINEL,
    youtubeLeadMs: 180,
  },
  sourceLabel: 'Original',
  outputLabel: 'Translation',
  sourceCues: [],
  outputCues: [],
  transcriptRows: [],
  activeIndex: -1,
  activeTimelineIndex: -1,
  lastRenderedActiveIndex: -1,
  playbackBaseMs: 0,
  playbackPerfMs: 0,
  playbackRate: 1,
  playbackIsPlaying: false,
  playbackTimeMs: 0,
  playbackTimer: null,
  liveTimer: null,
  refreshWatcher: null,
  assistInFlight: false,
  lastAssistAt: 0,
  liveText: '',
  autoScroll: true,
  autoPause: false,
  nextPreviewHidden: false,
  suppressAutoPauseOnce: true,
};

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error(error);
    setStatus(error?.message || 'Không khởi tạo được cửa sổ ghim.');
  });
});

refreshBtn?.addEventListener('click', () => {
  loadPinnedData({ force: true }).catch((error) => setStatus(error?.message || 'Không thể làm mới.'));
});

autoScrollBtn?.addEventListener('click', () => {
  state.autoScroll = !state.autoScroll;
  syncButtonStates();
  if (state.autoScroll) ensureActiveRowVisible();
});

autoPauseBtn?.addEventListener('click', () => {
  state.autoPause = !state.autoPause;
  state.suppressAutoPauseOnce = true;
  syncButtonStates();
  setStatus(state.autoPause ? 'Auto pause đã bật.' : 'Auto pause đã tắt.');
});

copyTranscriptBtn?.addEventListener('click', async () => {
  try {
    const text = buildTranscriptExportText();
    if (!text) {
      setStatus('Chưa có transcript để sao chép.');
      return;
    }
    await navigator.clipboard.writeText(text);
    setStatus('Đã copy transcript.');
  } catch (error) {
    setStatus(error?.message || 'Không copy được transcript.');
  }
});

copyCueBtn?.addEventListener('click', () => copyCurrentCue());
revealNextBtn?.addEventListener('click', () => toggleRevealNext());
playPauseBtn?.addEventListener('click', () => togglePlayback());
prevCueBtn?.addEventListener('click', () => stepCue(-1));
replayCueBtn?.addEventListener('click', () => replayActiveCue());
nextCueBtn?.addEventListener('click', () => stepCue(1));

transcriptListEl?.addEventListener('click', async (event) => {
  const row = event.target.closest('.pin-transcript-row');
  if (!row) return;
  const index = Number(row.dataset.index);
  const item = state.transcriptRows[index];
  if (!item || !Number.isFinite(item.startMs)) return;
  await seekToMs(item.startMs, { suppressAutoPause: true, statusText: `Seek ${formatTimestamp(item.startMs)}` });
});

window.addEventListener('beforeunload', () => {
  document.removeEventListener('keydown', handleWindowHotkeys, true);
  stopAllTimers();
});

async function init() {
  await loadSettings();
  syncButtonStates();
  applyPinPresentation();
  document.addEventListener('keydown', handleWindowHotkeys, true);
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
    const stored = await chrome.storage.local.get([STORAGE_KEY, PIN_PREFS_KEY]);
    const saved = stored?.[STORAGE_KEY];
    if (saved && typeof saved === 'object') {
      state.settings = { ...state.settings, ...saved };
    }
    state.pinPrefs = stored?.[PIN_PREFS_KEY] && typeof stored[PIN_PREFS_KEY] === 'object' ? stored[PIN_PREFS_KEY] : null;
  } catch {
    // ignore
  }
  const lead = Number(state.settings.youtubeLeadMs);
  state.settings.youtubeLeadMs = Number.isFinite(lead) ? lead : 180;
}

function syncButtonStates() {
  if (autoScrollBtn) {
    autoScrollBtn.classList.toggle('is-active', state.autoScroll);
    autoScrollBtn.textContent = state.autoScroll ? 'Auto scroll' : 'Manual scroll';
  }
  if (autoPauseBtn) {
    autoPauseBtn.classList.toggle('is-active', state.autoPause);
    autoPauseBtn.textContent = state.autoPause ? 'Auto pause on' : 'Auto pause off';
  }
  if (revealNextBtn) {
    revealNextBtn.classList.toggle('is-active', !state.nextPreviewHidden);
    revealNextBtn.textContent = state.nextPreviewHidden ? 'Reveal next' : 'Hide next';
  }
  if (playPauseBtn) {
    playPauseBtn.classList.toggle('is-active', state.playbackIsPlaying);
    playPauseBtn.textContent = state.playbackIsPlaying ? 'Pause' : 'Play';
  }
  document.body.classList.toggle('reveal-next', !state.nextPreviewHidden);
}


function handleWindowHotkeys(event) {
  const target = event.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;

  const key = String(event.key || '').toLowerCase();
  if (!key) return;

  if (key === 'a') {
    event.preventDefault();
    stepCue(-1);
    return;
  }
  if (key === 's') {
    event.preventDefault();
    replayActiveCue();
    return;
  }
  if (key === 'd') {
    event.preventDefault();
    stepCue(1);
    return;
  }
  if (key === 'q') {
    event.preventDefault();
    autoPauseBtn?.click();
    return;
  }
  if (key === 'w' || event.key === ' ') {
    event.preventDefault();
    togglePlayback();
    return;
  }
  if (key === 'e') {
    event.preventDefault();
    toggleRevealNext();
    return;
  }
  if (key === 'c') {
    event.preventDefault();
    copyCurrentCue();
  }
}

function getActiveRowsForPreview() {
  const rows = state.transcriptRows || [];
  if (!rows.length) return { prev: null, current: null, next: null };

  let index = state.activeTimelineIndex;
  if (index < 0 && Number.isInteger(state.activeIndex)) index = state.activeIndex;
  if (index < 0 && rows.length) index = 0;
  index = Math.max(0, Math.min(rows.length - 1, index));

  return {
    prev: rows[index - 1] || null,
    current: rows[index] || null,
    next: rows[index + 1] || null,
  };
}

function updateStudyRail() {
  const preview = getActiveRowsForPreview();
  const prevText = preview.prev?.source || '—';
  const nextText = preview.next?.source || 'Chưa có câu tiếp theo.';

  if (prevPreviewTextEl) prevPreviewTextEl.textContent = prevText;
  if (nextPreviewTextEl) nextPreviewTextEl.textContent = nextText;
  if (nextPreviewCardEl) {
    const shouldBlur = Boolean(preview.next?.source) && state.nextPreviewHidden;
    nextPreviewCardEl.classList.toggle('is-blurred', shouldBlur);
    nextPreviewCardEl.classList.toggle('is-revealed', Boolean(preview.next?.source) && !state.nextPreviewHidden);
  }
  if (hotkeysHintEl) {
    hotkeysHintEl.textContent = state.platform === 'netflix'
      ? 'A prev · S replay · D next · Q auto pause · W play/pause · E reveal next · C copy cue'
      : 'YouTube sync dùng currentTime + live caption assist. A/S/D để duyệt cue, W play/pause, C copy cue.';
  }
  syncButtonStates();
}

function toggleRevealNext(forceValue) {
  const preview = getActiveRowsForPreview();
  if (!preview.next?.source) {
    setStatus('Chưa có câu tiếp theo để hiển thị.');
    return;
  }
  const reveal = typeof forceValue === 'boolean' ? forceValue : state.nextPreviewHidden;
  state.nextPreviewHidden = !reveal;
  updateStudyRail();
  setStatus(state.nextPreviewHidden ? 'Đã ẩn câu tiếp theo.' : 'Đã hiện câu tiếp theo.');
}

async function copyCurrentCue() {
  const preview = getActiveRowsForPreview();
  const current = preview.current;
  if (!current?.source) {
    setStatus('Chưa có câu hiện tại để copy.');
    return;
  }
  try {
    const text = `${current.source}${current.output ? `
${current.output}` : ''}`;
    await navigator.clipboard.writeText(text);
    setStatus('Đã copy câu hiện tại.');
  } catch (error) {
    setStatus(error?.message || 'Không copy được câu hiện tại.');
  }
}

async function togglePlayback() {
  try {
    const result = await executeInPage(pageTogglePlaybackPinned, []);
    if (!result?.ok) {
      setStatus(result?.error || 'Không đổi được trạng thái phát.');
      return;
    }
    state.playbackIsPlaying = Boolean(result.isPlaying);
    state.playbackBaseMs = Math.max(0, Number(result.currentTimeMs) || state.playbackBaseMs || 0);
    state.playbackPerfMs = performance.now();
    syncButtonStates();
    setStatus(state.playbackIsPlaying ? 'Playing' : 'Paused');
  } catch (error) {
    setStatus(error?.message || 'Không đổi được trạng thái phát.');
  }
}

function getResolvedPinMode(platform = state.platform || 'default') {
  if (preferredModeFromUrl) return preferredModeFromUrl;
  const source = state.pinPrefs && typeof state.pinPrefs === 'object' ? state.pinPrefs : {};
  const scoped = source[platform] && typeof source[platform] === 'object' ? source[platform] : source.default;
  const mode = scoped?.mode;
  return ['compact', 'dual', 'review'].includes(String(mode)) ? String(mode) : 'dual';
}

function applyPinPresentation() {
  const hasOutput = state.outputCues.length > 0 || state.transcriptRows.some((row) => row.output);
  state.pinMode = getResolvedPinMode(state.platform || 'default');

  document.body.classList.remove(
    'pin-mode-compact',
    'pin-mode-dual',
    'pin-mode-review',
    'platform-youtube',
    'platform-netflix',
    'platform-default',
    'has-output',
    'no-output'
  );
  document.body.classList.add(`pin-mode-${state.pinMode}`);
  document.body.classList.add(`platform-${state.platform || 'default'}`);
  document.body.classList.add(hasOutput ? 'has-output' : 'no-output');

  if (modeChipEl) modeChipEl.textContent = state.pinMode.charAt(0).toUpperCase() + state.pinMode.slice(1);
  sourceCardEl?.classList.toggle('is-hidden', false);
  outputCardEl?.classList.toggle('is-hidden', !hasOutput);
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
  resetRuntimeState();

  const tab = await getTargetTab();
  if (!tab?.url) {
    setEmptyPinnedState('Không tìm thấy tab video.', 'Waiting for subtitle…', '');
    return;
  }

  state.lastUrl = tab.url;
  state.platform = detectPlatform(tab.url) || 'default';
  titleEl.textContent = tab.title || 'Video';
  platformChipEl.textContent = state.platform ? state.platform.toUpperCase() : 'UNSUPPORTED';
  applyPinPresentation();

  if (state.platform === 'youtube') {
    await loadYoutubePinned({ force });
    return;
  }

  if (state.platform === 'netflix') {
    await loadNetflixPinned({ force });
    return;
  }

  setEmptyPinnedState(
    'Tab hiện tại không phải YouTube hoặc Netflix.',
    'Mở video YouTube hoặc Netflix rồi ghim lại.',
    ''
  );
}

function resetRuntimeState() {
  state.sourceKind = '';
  state.sourceCues = [];
  state.outputCues = [];
  state.transcriptRows = [];
  state.activeIndex = -1;
  state.activeTimelineIndex = -1;
  state.lastRenderedActiveIndex = -1;
  state.playbackBaseMs = 0;
  state.playbackPerfMs = 0;
  state.playbackRate = 1;
  state.playbackIsPlaying = false;
  state.playbackTimeMs = 0;
  state.lastAssistAt = 0;
  state.liveText = '';
  state.nextPreviewHidden = state.platform === 'netflix';
  state.suppressAutoPauseOnce = true;
  timeChipEl.textContent = '00:00:00,000';
  countChipEl.textContent = '0 dòng';
  syncChipEl.textContent = 'Sync';
}

async function loadYoutubePinned() {
  state.platform = 'youtube';
  const metadata = await executeInPage(pageGetYoutubeMetadataPinned, []);
  if (!metadata?.ok || !Array.isArray(metadata.sourceTracks) || !metadata.sourceTracks.length) {
    setEmptyPinnedState(metadata?.error || 'Không đọc được phụ đề YouTube.', 'Waiting for subtitle…', '');
    syncChipEl.textContent = 'No track';
    return;
  }

  const sourceIndex = Math.max(0, Math.min(Number(metadata.defaultSourceIndex) || 0, metadata.sourceTracks.length - 1));
  const sourceTrack = metadata.sourceTracks[sourceIndex];
  state.sourceLabel = sourceTrack.name || sourceTrack.languageCode || 'Original';
  state.outputLabel = 'Output';
  state.sourceKind = 'youtube-timedtext';
  state.nextPreviewHidden = false;

  sourceLabelEl.textContent = state.sourceLabel;
  outputLabelEl.textContent = state.outputLabel;
  transcriptTitleEl.textContent = 'YouTube timed transcript';
  transcriptHintEl.textContent = 'Đồng bộ theo currentTime, có thêm live caption assist để giữ active cue khớp với player.';
  footerNoteEl.textContent = 'YouTube dùng timed transcript đầy đủ. Khi caption overlay đang hiện, pin sẽ dùng thêm overlay để khóa đúng câu đang phát.';
  syncChipEl.textContent = 'Timed + live assist';

  const sourceResult = await executeInPage(pageFetchYoutubeTrackPinned, [sourceTrack]);
  if (!sourceResult?.ok || !Array.isArray(sourceResult.cues) || !sourceResult.cues.length) {
    setEmptyPinnedState(sourceResult?.error || 'Không tải được timed transcript YouTube.', 'Waiting for subtitle…', '');
    syncChipEl.textContent = 'Timed fetch failed';
    return;
  }

  state.sourceCues = sanitizeCues(sourceResult.cues);
  state.outputCues = [];

  const targetLanguage = state.settings.preferredTargetLanguage || ORIGINAL_LANGUAGE_SENTINEL;
  if (targetLanguage !== ORIGINAL_LANGUAGE_SENTINEL && sourceTrack.isTranslatable) {
    const targetMeta = (metadata.translationLanguages || []).find((item) => item.languageCode === targetLanguage);
    const translatedTrack = {
      ...sourceTrack,
      isTranslation: true,
      sourceLanguageCode: sourceTrack.languageCode,
      targetLanguageCode: targetLanguage,
      targetLanguageName: targetMeta?.name || targetLanguage,
    };

    const translationResult = await executeInPage(pageFetchYoutubeTrackPinned, [translatedTrack]);
    if (translationResult?.ok && Array.isArray(translationResult.cues) && translationResult.cues.length) {
      state.outputCues = sanitizeCues(translationResult.cues);
      state.outputLabel = targetMeta?.name || targetLanguage;
      outputLabelEl.textContent = state.outputLabel;
    }
  }

  rebuildTranscriptRowsFromCues();
  renderTexts('Waiting for subtitle…', state.outputCues.length ? 'Đang chờ câu dịch tương ứng…' : '');
  setStatus('Timed sync ready');
  startPlaybackTimer();
}

async function loadNetflixPinned() {
  state.platform = 'netflix';
  const metadata = await executeInPage(pageGetNetflixMetadataPinned, []);
  if (!metadata?.ok || !Array.isArray(metadata.sourceTracks) || !metadata.sourceTracks.length) {
    setEmptyPinnedState(metadata?.error || 'Không đọc được metadata Netflix.', 'Waiting for subtitle…', '');
    syncChipEl.textContent = 'No track';
    return;
  }

  const sourceIndex = Math.max(0, Math.min(Number(metadata.defaultSourceIndex) || 0, metadata.sourceTracks.length - 1));
  const sourceTrack = metadata.sourceTracks[sourceIndex];
  state.sourceLabel = sourceTrack.name || sourceTrack.languageCode || 'Original';
  state.outputLabel = 'Study notes';
  sourceLabelEl.textContent = state.sourceLabel;
  outputLabelEl.textContent = state.outputLabel;

  transcriptTitleEl.textContent = 'Netflix subtitle timeline';
  transcriptHintEl.textContent = 'Ưu tiên full textTrack. Nếu Netflix không expose full cues, pin sẽ chuyển sang live capture liên tục như session log.';
  footerNoteEl.textContent = 'Lấy cảm hứng từ workflow kiểu Language Reactor: theo câu, nhảy prev/replay/next cue, auto pause, preview câu kế tiếp, và timeline sống để review lại.';
  state.nextPreviewHidden = true;

  const sourceResult = await executeInPage(pageFetchNetflixTrackPinned, [sourceTrack]);
  if (sourceResult?.ok && Array.isArray(sourceResult.cues) && sourceResult.cues.length) {
    state.sourceKind = 'netflix-texttrack';
    state.sourceCues = sanitizeCues(sourceResult.cues);
    state.outputCues = [];
    syncChipEl.textContent = 'TextTrack';
    footerNoteEl.textContent = 'Netflix đang dùng full textTrack từ player. Prev / Replay / Next, auto pause, và preview câu kế tiếp sẽ bám theo từng cue.';
    rebuildTranscriptRowsFromCues();
    renderTexts('Waiting for subtitle…', '');
    setStatus('TextTrack sync ready');
    startPlaybackTimer();
    return;
  }

  state.sourceKind = 'netflix-live';
  syncChipEl.textContent = 'Live capture';
  transcriptTitleEl.textContent = 'Netflix live timeline';
  transcriptHintEl.textContent = 'Khi player không lộ toàn bộ textTrack, pin sẽ lưu toàn bộ subtitle đang hiện trong phiên xem hiện tại.';
  footerNoteEl.textContent = 'Live capture giúp Netflix vẫn usable ngay cả khi full track không đọc được. Timeline sẽ tích lũy dần giống một session reviewer và vẫn dùng được A/S/D/Q/W/E.';
  renderTexts('Waiting for subtitle…', '');
  renderTranscriptList();
  setStatus('Live capture');
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
  updateStudyRail();
}

function renderTranscriptList() {
  const rows = state.transcriptRows || [];
  const hasOutput = rows.some((row) => row.output);
  countChipEl.textContent = `${rows.length} dòng`;
  applyPinPresentation();

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
    item.className = `pin-transcript-row${hasOutput ? '' : ' no-output'}`;
    if (index === state.activeTimelineIndex) item.classList.add('is-active');
    item.dataset.index = String(index);
    item.innerHTML = `
      <div class="pin-transcript-time">${escapeHtml(formatTimestamp(row.startMs))}</div>
      <div class="pin-transcript-col source">
        <strong>${escapeHtml(state.sourceLabel || 'Source')}</strong>
        <p>${escapeHtml(row.source || '')}</p>
      </div>
      ${hasOutput ? `
      <div class="pin-transcript-col output">
        <strong>${escapeHtml(state.outputLabel || 'Output')}</strong>
        <p>${escapeHtml(row.output || '—')}</p>
      </div>` : ''}
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

function renderTexts(sourceText, outputText) {
  const hasOutput = Boolean(
    outputText &&
    String(outputText).trim() &&
    !/^—$/.test(String(outputText).trim())
  );

  sourceTextEl.textContent = sourceText || 'Waiting for subtitle…';
  outputTextEl.textContent = outputText || 'Chưa có dữ liệu song ngữ.';

  const layoutHasOutput = hasOutput || state.outputCues.length > 0 || state.transcriptRows.some((row) => row.output);
  document.body.classList.toggle('has-output', layoutHasOutput);
  document.body.classList.toggle('no-output', !layoutHasOutput);
  updateStudyRail();
}

function setStatus(text) {
  statusChipEl.textContent = text || 'Ready';
}

function setEmptyPinnedState(statusText, sourceText, outputText) {
  state.sourceCues = [];
  state.outputCues = [];
  state.transcriptRows = [];
  state.activeIndex = -1;
  state.activeTimelineIndex = -1;
  renderTexts(sourceText, outputText);
  setStatus(statusText);
  renderTranscriptList();
  applyPinPresentation();
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
  state.assistInFlight = false;
}

function stopLiveCapture() {
  if (state.liveTimer) {
    clearInterval(state.liveTimer);
    state.liveTimer = null;
  }
  state.liveText = '';
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
      syncPlayback();

      if (
        state.platform === 'youtube' &&
        !state.assistInFlight &&
        Date.now() - state.lastAssistAt > 420
      ) {
        state.assistInFlight = true;
        state.lastAssistAt = Date.now();
        executeInPage(pageGetYoutubeCaptionSnapshotPinned, [])
          .then((assist) => applyYoutubeAssistSnapshot(assist))
          .catch(() => {})
          .finally(() => {
            state.assistInFlight = false;
          });
      }
    } catch {
      // ignore
    }
  }, 220);
}

function estimatePlaybackTime() {
  const delta = state.playbackIsPlaying
    ? Math.max(0, performance.now() - state.playbackPerfMs) * state.playbackRate
    : 0;
  const leadMs = state.platform === 'youtube' ? Number(state.settings.youtubeLeadMs || 0) : 0;
  return Math.max(0, Math.round(state.playbackBaseMs + delta + leadMs));
}

function findCueIndex(cues, timeMs, activeIndex) {
  if (!cues.length) return -1;

  const activeCue = cues[activeIndex];
  if (activeCue && timeMs >= activeCue.startMs - 50 && timeMs < activeCue.endMs + 120) {
    return activeIndex;
  }

  for (let idx = Math.max(0, activeIndex - 3); idx <= Math.min(cues.length - 1, activeIndex + 3); idx += 1) {
    const cue = cues[idx];
    if (cue && timeMs >= cue.startMs - 50 && timeMs < cue.endMs + 120) return idx;
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
  if (Math.abs((cues[candidate]?.startMs || 0) - timeMs) <= 500) return candidate;
  return -1;
}

function syncPlayback() {
  if (!state.sourceCues.length) return;
  state.playbackTimeMs = estimatePlaybackTime();
  timeChipEl.textContent = formatTimestamp(state.playbackTimeMs);

  const nextIndex = findCueIndex(state.sourceCues, state.playbackTimeMs, state.activeIndex);
  const changed = nextIndex !== state.activeIndex;
  if (changed) {
    state.activeIndex = nextIndex;
    state.activeTimelineIndex = nextIndex;
    if (state.platform === 'netflix') state.nextPreviewHidden = true;
    updateTextsFromCues();
    updateActiveTranscriptRow();
    maybeAutoPauseOnCueChange();
  }

  statusChipEl.textContent = state.playbackIsPlaying ? 'Playing' : 'Paused';
  syncButtonStates();
}

function maybeAutoPauseOnCueChange() {
  if (state.activeIndex < 0) return;
  if (state.suppressAutoPauseOnce) {
    state.suppressAutoPauseOnce = false;
    return;
  }
  if (!state.autoPause || !state.playbackIsPlaying) return;
  executeInPage(pagePausePlaybackPinned, []).catch(() => {});
  state.playbackIsPlaying = false;
  statusChipEl.textContent = 'Auto paused';
}

function applyYoutubeAssistSnapshot(snapshot) {
  if (!snapshot?.ok || !state.sourceCues.length) return;
  const snapshotTimeMs = Math.max(0, Math.round(Number(snapshot.currentTimeMs) || 0));
  if (Number.isFinite(snapshotTimeMs)) {
    state.playbackBaseMs = snapshotTimeMs;
    state.playbackPerfMs = performance.now();
    state.playbackTimeMs = snapshotTimeMs;
    timeChipEl.textContent = formatTimestamp(snapshotTimeMs);
  }
  if (!snapshot.text) return;
  const matchIndex = matchCueByDisplayedText(snapshot.text, snapshotTimeMs, state.activeIndex);
  if (matchIndex < 0) return;

  const changed = matchIndex !== state.activeIndex;
  state.activeIndex = matchIndex;
  state.activeTimelineIndex = matchIndex;
  if (changed && state.platform === 'netflix') state.nextPreviewHidden = true;
  updateTextsFromCues();
  updateActiveTranscriptRow();
  syncButtonStates();
}

function matchCueByDisplayedText(rawText, currentTimeMs, activeIndex) {
  const target = normalizeCompareText(rawText);
  if (!target) return -1;

  const candidates = [];
  const pushCandidate = (index) => {
    if (index < 0 || index >= state.sourceCues.length) return;
    const cue = state.sourceCues[index];
    const cueText = normalizeCompareText(cue.text || '');
    if (!cueText) return;
    let score = 0;
    if (cueText === target) score += 1000;
    if (cueText.includes(target) || target.includes(cueText)) score += 600;
    const overlap = computeTextOverlap(cueText, target);
    score += overlap * 100;
    const distance = Math.abs((cue.startMs || 0) - (Number(currentTimeMs) || 0));
    score -= Math.min(800, distance / 8);
    candidates.push({ index, score });
  };

  for (let i = Math.max(0, activeIndex - 8); i <= Math.min(state.sourceCues.length - 1, activeIndex + 8); i += 1) {
    pushCandidate(i);
  }
  if (!candidates.length) {
    for (let i = 0; i < state.sourceCues.length; i += 1) pushCandidate(i);
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] && candidates[0].score > 120 ? candidates[0].index : -1;
}

function computeTextOverlap(a, b) {
  const aWords = new Set(String(a).split(' ').filter(Boolean));
  const bWords = new Set(String(b).split(' ').filter(Boolean));
  if (!aWords.size || !bWords.size) return 0;
  let hits = 0;
  for (const word of aWords) {
    if (bWords.has(word)) hits += 1;
  }
  return hits / Math.max(aWords.size, bWords.size);
}

function updateTextsFromCues() {
  if (state.activeIndex < 0 || !state.sourceCues[state.activeIndex]) {
    renderTexts('Waiting for subtitle…', state.outputCues.length ? 'Đang chờ câu dịch tương ứng…' : '');
    return;
  }

  const sourceCue = state.sourceCues[state.activeIndex];
  let outputText = '';
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
        appendOrUpdateLiveTranscriptRow(snapshot.text, state.playbackTimeMs);
        state.liveText = snapshot.text;
        renderTexts(snapshot.text, '');
        updateStudyRail();
        if (state.autoPause && snapshot.isPlaying && !state.suppressAutoPauseOnce) {
          executeInPage(pagePausePlaybackPinned, []).catch(() => {});
          statusChipEl.textContent = 'Auto paused';
        }
        state.suppressAutoPauseOnce = false;
      }

      if (!snapshot.text && state.transcriptRows.length) {
        const current = state.transcriptRows[state.transcriptRows.length - 1];
        if (current && current.kind === 'live') {
          current.endMs = Math.max(current.endMs || current.startMs || 0, state.playbackTimeMs);
        }
      }

      updateActiveTranscriptRow();
    } catch {
      // ignore
    }
  }, 150);
}

function appendOrUpdateLiveTranscriptRow(text, timeMs) {
  const normalized = String(text || '').trim();
  if (!normalized) return;

  const previous = state.transcriptRows[state.transcriptRows.length - 1];
  if (previous && normalizeCompareText(previous.source) === normalizeCompareText(normalized)) {
    previous.endMs = Math.max(previous.endMs || previous.startMs || 0, timeMs);
    state.activeTimelineIndex = state.transcriptRows.length - 1;
    renderTranscriptList();
    return;
  }

  if (previous && previous.kind === 'live') {
    previous.endMs = Math.max(previous.endMs || previous.startMs || 0, timeMs);
  }

  state.transcriptRows.push({
    startMs: Math.max(0, Number(timeMs) || 0),
    endMs: Math.max(0, Number(timeMs) || 0),
    source: normalized,
    output: '',
    kind: 'live',
  });
  state.activeTimelineIndex = state.transcriptRows.length - 1;
  if (state.platform === 'netflix') state.nextPreviewHidden = true;
  updateStudyRail();
  renderTranscriptList();
}

async function stepCue(delta) {
  const rows = state.transcriptRows;
  if (!rows.length) return;

  const currentIndex = state.activeTimelineIndex >= 0 ? state.activeTimelineIndex : 0;
  const targetIndex = Math.max(0, Math.min(rows.length - 1, currentIndex + delta));
  const item = rows[targetIndex];
  if (!item) return;
  await seekToMs(item.startMs, {
    suppressAutoPause: true,
    statusText: `${delta < 0 ? 'Prev' : 'Next'} ${formatTimestamp(item.startMs)}`,
    targetIndex,
  });
}

async function replayActiveCue() {
  const rows = state.transcriptRows;
  if (!rows.length) return;
  const currentIndex = state.activeTimelineIndex >= 0 ? state.activeTimelineIndex : 0;
  const item = rows[currentIndex];
  if (!item) return;
  await seekToMs(item.startMs, {
    suppressAutoPause: true,
    statusText: `Replay ${formatTimestamp(item.startMs)}`,
    targetIndex: currentIndex,
  });
}

async function seekToMs(timeMs, options = {}) {
  try {
    await executeInPage(pageSeekPlaybackPinned, [timeMs]);
    state.playbackBaseMs = Math.max(0, Number(timeMs) || 0);
    state.playbackPerfMs = performance.now();
    state.playbackTimeMs = state.playbackBaseMs;
    if (Number.isInteger(options.targetIndex)) {
      state.activeTimelineIndex = options.targetIndex;
      state.activeIndex = options.targetIndex;
      updateTextsFromCues();
      updateActiveTranscriptRow();
    }
    if (options.suppressAutoPause) state.suppressAutoPauseOnce = true;
    if (options.statusText) setStatus(options.statusText);
  } catch (error) {
    setStatus(error?.message || 'Không seek được video.');
  }
}

function buildTranscriptExportText() {
  if (!state.transcriptRows.length) return '';
  return state.transcriptRows
    .map((row) => {
      const time = formatTimestamp(row.startMs);
      const output = row.output ? `\n${state.outputLabel || 'Output'}: ${row.output}` : '';
      return `[${time}] ${state.sourceLabel || 'Source'}: ${row.source}${output}`;
    })
    .join('\n\n');
}

function formatTimestamp(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function sanitizeCues(cues) {
  const normalized = [];
  const seen = new Set();
  for (const cue of Array.isArray(cues) ? cues : []) {
    const startMs = Math.max(0, Math.round(Number(cue?.startMs) || 0));
    const endMs = Math.max(startMs + 1, Math.round(Number(cue?.endMs) || startMs + 1800));
    const text = String(cue?.text || '')
      .replace(/\u200b/g, '')
      .replace(/\r/g, '')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    if (!text) continue;
    const key = `${startMs}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ startMs, endMs, text });
  }

  normalized.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  for (let i = 0; i < normalized.length - 1; i += 1) {
    if (normalized[i].endMs <= normalized[i].startMs) {
      normalized[i].endMs = Math.max(normalized[i].startMs + 1, normalized[i + 1].startMs);
    }
    if (normalized[i].endMs > normalized[i + 1].startMs && normalized[i + 1].startMs > normalized[i].startMs) {
      normalized[i].endMs = normalized[i + 1].startMs;
    }
  }
  return normalized;
}

function normalizeCompareText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[“”"'`’.,!?;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(text) {
  return String(text || '')
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

function pagePausePlaybackPinned() {
  try {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy player HTML5.' };
    video.pause();
    return { ok: true, paused: video.paused };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không pause được video.' };
  }
}

function pageTogglePlaybackPinned() {
  try {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy player HTML5.' };
    if (video.paused || video.ended) {
      const playPromise = video.play?.();
      if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
    } else {
      video.pause();
    }
    return {
      ok: true,
      isPlaying: !video.paused && !video.ended && Number(video.readyState || 0) >= 2,
      currentTimeMs: Math.round(Number(video.currentTime || 0) * 1000),
    };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không đổi được trạng thái phát.' };
  }
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

function pageGetYoutubeCaptionSnapshotPinned() {
  function normalizeText(value) {
    return String(value || '')
      .replace(/\u200b/g, '')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  try {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    const containers = [
      '.ytp-caption-window-container',
      '.captions-text',
      '.ytp-caption-segment',
      '.ytp-caption-window-bottom',
    ];

    let text = '';
    for (const selector of containers) {
      const nodes = Array.from(document.querySelectorAll(selector));
      const parts = nodes
        .map((node) => normalizeText(node.innerText || node.textContent || ''))
        .filter(Boolean);
      if (parts.length) {
        text = normalizeText(parts.join('\n'));
        if (text) break;
      }
    }

    return {
      ok: true,
      currentTimeMs: Math.round(Number(video?.currentTime || 0) * 1000),
      text,
    };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không đọc được caption overlay YouTube.' };
  }
}

function pageGetYoutubeMetadataPinned() {
  const debug = [];
  function push(message) {
    debug.push(String(message));
  }
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
          }
          return parsed;
        } catch {
          // ignore
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
    } catch {
      // ignore
    }
    try {
      const raw = window.ytplayer?.config?.args?.player_response;
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    try {
      const raw = window.ytcfg?.data_?.PLAYER_VARS?.player_response || window.ytcfg?.get?.('PLAYER_VARS')?.player_response;
      if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      // ignore
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
    } catch {
      // ignore
    }
    return null;
  }
  function matchTrackIndexFromHint(sourceTracks, hint) {
    if (!hint) return -1;
    const byVssId = sourceTracks.findIndex((track) => track.vssId && hint.vssId && track.vssId === hint.vssId);
    if (byVssId >= 0) return byVssId;
    return sourceTracks.findIndex((track) => {
      return (
        track.languageCode === hint.languageCode &&
        (!hint.kind || track.kind === hint.kind || track.isAuto === (hint.kind === 'asr'))
      );
    });
  }
  function getAudioTrackInfo(sourceTracks, renderer) {
    const audioTracks = Array.isArray(renderer?.audioTracks) ? renderer.audioTracks : [];
    for (const audioTrack of audioTracks) {
      const idx = Number(audioTrack?.defaultCaptionTrackIndex);
      if (Number.isInteger(idx) && idx >= 0 && idx < sourceTracks.length) {
        return {
          index: idx,
          languageCode: sourceTracks[idx]?.languageCode || '',
          reason: 'audio mặc định',
        };
      }
    }
    return { index: -1, languageCode: '', reason: '' };
  }
  function computeOriginalTrackInfo(sourceTracks, renderer) {
    if (!Array.isArray(sourceTracks) || !sourceTracks.length) return { index: -1, languageCode: '', reason: '' };
    const audioInfo = getAudioTrackInfo(sourceTracks, renderer);
    if (audioInfo.index >= 0) return audioInfo;
    const firstManual = sourceTracks.findIndex((track) => !track.isAuto);
    if (firstManual >= 0) {
      return { index: firstManual, languageCode: sourceTracks[firstManual]?.languageCode || '', reason: 'manual đầu tiên' };
    }
    const currentIndex = matchTrackIndexFromHint(sourceTracks, getCurrentCaptionTrackHint());
    if (currentIndex >= 0) {
      return { index: currentIndex, languageCode: sourceTracks[currentIndex]?.languageCode || '', reason: 'track đang bật' };
    }
    return { index: 0, languageCode: sourceTracks[0]?.languageCode || '', reason: 'fallback' };
  }
  function computeDefaultSourceInfo(sourceTracks, renderer, originalInfo) {
    const currentIndex = matchTrackIndexFromHint(sourceTracks, getCurrentCaptionTrackHint());
    if (currentIndex >= 0) {
      return { index: currentIndex, languageCode: sourceTracks[currentIndex]?.languageCode || '', reason: 'track đang bật' };
    }
    return originalInfo;
  }

  const playerResponse = getPlayerResponse();
  if (!playerResponse) return { ok: false, error: 'Không đọc được player response từ trang YouTube.', debug };
  const renderer = playerResponse?.captions?.playerCaptionsTracklistRenderer;
  const captionTracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
  const translationLanguages = Array.isArray(renderer?.translationLanguages) ? renderer.translationLanguages : [];

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

  const translationLangs = translationLanguages
    .map((lang) => ({
      languageCode: lang?.languageCode || '',
      name: getTextFromRuns(lang?.languageName) || lang?.languageCode || '',
    }))
    .filter((item) => item.languageCode);

  const originalTrackInfo = computeOriginalTrackInfo(sourceTracks, renderer);
  const defaultSourceInfo = computeDefaultSourceInfo(sourceTracks, renderer, originalTrackInfo);
  const audioInfo = getAudioTrackInfo(sourceTracks, renderer);

  return {
    ok: true,
    sourceTracks,
    translationLanguages: translationLangs,
    defaultSourceIndex: defaultSourceInfo.index,
    originalTrackIndex: originalTrackInfo.index,
    originalLanguageCode: originalTrackInfo.languageCode,
    audioLanguageCode: audioInfo.languageCode,
    debug,
  };
}

async function pageFetchYoutubeTrackPinned(track) {
  const debug = [];
  const push = (line) => debug.push(String(line));

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
  function parseJson3ToCues(payload) {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const cues = [];
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      const rawText = Array.isArray(event?.segs) ? event.segs.map((segment) => segment?.utf8 || '').join('') : '';
      const text = normalizeCueText(rawText);
      if (!text) continue;
      const startMs = Number(event?.tStartMs ?? 0);
      const nextEvent = events[i + 1];
      const durationMs = Number(event?.dDurationMs ?? 0);
      let endMs = startMs + durationMs;
      if (!durationMs && nextEvent?.tStartMs != null) endMs = Number(nextEvent.tStartMs);
      if (!endMs || endMs <= startMs) endMs = startMs + 1800;
      cues.push({ startMs, endMs, text });
    }
    return cues;
  }
  function parseXmlToCues(text) {
    const xml = new DOMParser().parseFromString(text, 'text/xml');
    if (xml.querySelector('parsererror')) return [];

    const transcriptNodes = Array.from(xml.querySelectorAll('transcript text'));
    if (transcriptNodes.length) {
      return transcriptNodes
        .map((node) => {
          const startMs = Math.round(Number(node.getAttribute('start') || 0) * 1000);
          const durMs = Math.round(Number(node.getAttribute('dur') || 0) * 1000);
          const endMs = durMs > 0 ? startMs + durMs : startMs + 1800;
          const content = normalizeCueText(decodeHtmlEntities(node.textContent || ''));
          return content ? { startMs, endMs, text: content } : null;
        })
        .filter(Boolean);
    }

    const pNodes = Array.from(xml.querySelectorAll('p'));
    return pNodes
      .map((node, index) => {
        let startMs = Number(node.getAttribute('t'));
        let durMs = Number(node.getAttribute('d'));
        if (!Number.isFinite(startMs)) startMs = parseClockToMs(node.getAttribute('begin'));
        if (!Number.isFinite(durMs)) {
          const endAttr = node.getAttribute('end');
          if (endAttr) {
            const endMs = parseClockToMs(endAttr);
            durMs = Math.max(0, endMs - startMs);
          } else if (node.getAttribute('dur')) {
            durMs = parseClockToMs(node.getAttribute('dur'));
          } else {
            durMs = 0;
          }
        }
        const content = normalizeCueText(node.textContent || '');
        if (!content) return null;
        let endMs = startMs + durMs;
        if (!endMs || endMs <= startMs) {
          const nextNode = pNodes[index + 1];
          const nextStart = nextNode ? Number(nextNode.getAttribute('t')) : NaN;
          endMs = Number.isFinite(nextStart) && nextStart > startMs ? nextStart : startMs + 1800;
        }
        return { startMs, endMs, text: content };
      })
      .filter(Boolean);
  }
  function parseVttToCues(text) {
    const normalized = String(text || '').replace(/\r/g, '');
    const blocks = normalized.split(/\n{2,}/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split('\n').map((line) => line.trimEnd()).filter(Boolean);
      if (!lines.length) continue;
      if (/^WEBVTT/i.test(lines[0]) || /^NOTE/i.test(lines[0]) || /^STYLE/i.test(lines[0])) continue;
      const timingLineIndex = lines.findIndex((line) => line.includes('-->'));
      if (timingLineIndex === -1) continue;
      const timingLine = lines[timingLineIndex];
      const parts = timingLine.split(/\s+-->\s+/);
      if (parts.length !== 2) continue;
      const startMs = parseClockToMs(parts[0].split(' ')[0].replace(',', '.'));
      const endMs = parseClockToMs(parts[1].split(' ')[0].replace(',', '.'));
      const cueText = normalizeCueText(lines.slice(timingLineIndex + 1).join('\n'));
      if (!cueText) continue;
      cues.push({ startMs, endMs: endMs > startMs ? endMs : startMs + 1800, text: cueText });
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
  function normalizeBaseUrl(url) {
    try {
      return new URL(String(url || '').replace(/\\u0026/g, '&'), location.href).toString();
    } catch {
      return '';
    }
  }
  function safeUrl(url) {
    try {
      return new URL(String(url || '').replace(/\\u0026/g, '&'), location.href);
    } catch {
      return null;
    }
  }
  function buildEffectiveTrackUrl(item) {
    try {
      const url = new URL(normalizeBaseUrl(item.baseUrl), location.href);
      if (item.isTranslation && item.targetLanguageCode) {
        url.searchParams.set('tlang', item.targetLanguageCode);
        url.searchParams.set('lang', item.sourceLanguageCode || item.languageCode);
      } else {
        url.searchParams.delete('tlang');
        url.searchParams.set('lang', item.languageCode);
      }
      return url.toString();
    } catch {
      return '';
    }
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
    if (!parsed) return false;
    if (!parsed.pathname.includes('/api/timedtext')) return false;
    const lang = parsed.searchParams.get('lang');
    const tlang = parsed.searchParams.get('tlang');
    const vssId = parsed.searchParams.get('vssid') || parsed.searchParams.get('vss_id');
    if (item.isTranslation) {
      return (!item.vssId || !vssId || item.vssId === vssId) &&
        lang === (item.sourceLanguageCode || item.languageCode) &&
        tlang === item.targetLanguageCode;
    }
    if (item.vssId && vssId && item.vssId !== vssId) return false;
    return lang === item.languageCode && !tlang;
  }
  function collectNetworkTimedtextUrls() {
    return (performance.getEntriesByType('resource') || [])
      .map((entry) => entry?.name || '')
      .filter((name) => name.includes('/api/timedtext'));
  }
  async function tryActivateTrack(item) {
    const player = document.getElementById('movie_player');
    if (!player) return;
    try {
      player.loadModule?.('captions');
    } catch {
      // ignore
    }
    const baseLanguage = item.sourceLanguageCode || item.languageCode;
    const payloads = [
      { languageCode: baseLanguage },
      { languageCode: baseLanguage, kind: item.kind },
      item.vssId ? { languageCode: baseLanguage, vssId: item.vssId } : null,
      item.vssId ? { languageCode: baseLanguage, vss_id: item.vssId } : null,
    ].filter(Boolean);
    for (const payload of payloads) {
      try {
        player.setOption?.('captions', 'track', payload);
      } catch {
        // ignore
      }
    }
    try {
      player.setOption?.('captions', 'reload', true);
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  async function tryFetchCandidates(candidates) {
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate.url, { credentials: 'include', cache: 'no-store' });
        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();
        const parsed = parseContent(text, contentType);
        push(`Thử ${candidate.reason}: status=${response.status}, format=${parsed.format}, cues=${parsed.cues.length}`);
        if (!response.ok) continue;
        if (parsed.cues.length) {
          return {
            ok: true,
            cues: parsed.cues,
            sourceUrl: candidate.url,
            sourceFormat: parsed.format,
            debug,
          };
        }
      } catch (error) {
        push(`Fetch lỗi (${candidate.reason}): ${error.message}`);
      }
    }
    return null;
  }

  if (!track?.baseUrl) return { ok: false, error: 'Track không có baseUrl.', debug };
  const effectiveUrl = buildEffectiveTrackUrl(track);
  if (!effectiveUrl) return { ok: false, error: 'Không tạo được URL phụ đề hợp lệ.', debug };

  const initialNetworkUrls = collectNetworkTimedtextUrls();
  const firstCandidates = [];
  const firstSeen = new Set();
  for (const url of initialNetworkUrls.filter((candidate) => matchesTrack(candidate, track))) {
    for (const variant of buildFormatVariants(url, track)) addCandidate(firstCandidates, firstSeen, variant, 'performance entry');
  }
  for (const variant of buildFormatVariants(effectiveUrl, track)) addCandidate(firstCandidates, firstSeen, variant, 'effective track url');

  let result = await tryFetchCandidates(firstCandidates);
  if (result) return result;

  await tryActivateTrack(track);

  const secondNetworkUrls = collectNetworkTimedtextUrls();
  const secondCandidates = [];
  const secondSeen = new Set();
  for (const url of secondNetworkUrls.filter((candidate) => matchesTrack(candidate, track))) {
    for (const variant of buildFormatVariants(url, track)) addCandidate(secondCandidates, secondSeen, variant, 'performance entry sau kích hoạt');
  }
  for (const variant of buildFormatVariants(effectiveUrl, track)) addCandidate(secondCandidates, secondSeen, variant, 'effective track url');

  result = await tryFetchCandidates(secondCandidates);
  if (result) return result;

  return { ok: false, error: 'Timedtext không trả được dữ liệu parse được cho lựa chọn này.', debug };
}

function pageGetNetflixMetadataPinned() {
  try {
    const video = document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy video Netflix đang phát.' };
    const textTracks = Array.from(video.textTracks || []).filter((track) => ['subtitles', 'captions'].includes(String(track.kind || '').toLowerCase()));
    const activeIndex = textTracks.findIndex((track) => ['showing', 'hidden'].includes(String(track.mode || '').toLowerCase()));
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
    return String(value || '')
      .replace(/\u200b/g, '')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }
  if (track?.fetchStrategy === 'liveCapture') return { ok: false, liveCaptureOnly: true };
  try {
    const video = document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy video Netflix.', liveCaptureOnly: true };

    const textTracks = Array.from(video.textTracks || []).filter((candidate) => ['subtitles', 'captions'].includes(String(candidate.kind || '').toLowerCase()));
    const selectedTrack = textTracks[Number(track.textTrackIndex)] || textTracks[0] || null;
    if (!selectedTrack) return { ok: false, liveCaptureOnly: true };

    const restore = textTracks.map((candidate) => String(candidate.mode || 'disabled'));
    textTracks.forEach((candidate) => {
      try {
        candidate.mode = candidate === selectedTrack ? 'hidden' : 'disabled';
      } catch {
        // ignore
      }
    });

    let cues = [];
    for (let attempt = 0; attempt < 14; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 220));
      const source = Array.from(selectedTrack.cues || []);
      cues = source
        .map((cue) => ({
          startMs: Math.round(Number(cue.startTime || 0) * 1000),
          endMs: Math.round(Number(cue.endTime || 0) * 1000),
          text: normalizeText(cue.text || cue.id || ''),
        }))
        .filter((cue) => cue.text);
      if (cues.length) break;
    }

    textTracks.forEach((candidate, index) => {
      try {
        candidate.mode = restore[index] || 'disabled';
      } catch {
        // ignore
      }
    });

    return cues.length ? { ok: true, cues } : { ok: false, liveCaptureOnly: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không đọc được subtitle Netflix.', liveCaptureOnly: true };
  }
}

function pageGetNetflixLiveSnapshotPinned() {
  function normalizeText(value) {
    return String(value || '')
      .replace(/\u200b/g, '')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  try {
    const video = document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy video.' };

    const selectors = [
      '[data-uia="player-subtitle"]',
      '[data-uia="subtitle-text"]',
      '.player-timedtext',
      '.player-timedtext-text-container',
      '[class*="timedtext"] [class*="text"]',
      '[class*="watch-video"] [class*="timedtext"]',
    ];

    let text = '';
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      const parts = nodes.map((node) => normalizeText(node.innerText || node.textContent || '')).filter(Boolean);
      if (parts.length) {
        text = normalizeText(parts.join('\n'));
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
  } catch (error) {
    return { ok: false, error: error?.message || 'Không đọc được live subtitle Netflix.' };
  }
}
