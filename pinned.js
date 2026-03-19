const STORAGE_KEY = 'ytSubtitleGrabberSettingsV8';
const PIN_PREFS_KEY = 'ytSubtitleGrabberPinPrefsV1';
const ORIGINAL_LANGUAGE_SENTINEL = '__original__';

const refreshBtn = document.getElementById('refreshPinnedBtn');
const titleEl = document.getElementById('pinTitle');
const platformChipEl = document.getElementById('pinPlatformChip');
const statusChipEl = document.getElementById('pinStatusChip');
const timeChipEl = document.getElementById('pinTimeChip');
const countChipEl = document.getElementById('pinCountChip');
const modeChipEl = document.getElementById('pinModeChip');
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
const loopCueBtn = document.getElementById('pinLoopCueBtn');
const revealNextBtn = document.getElementById('pinRevealNextBtn');
const copyCurrentBtn = document.getElementById('pinCopyCurrentBtn');
const copyTranscriptBtn = document.getElementById('pinCopyTranscriptBtn');
const prevCueBtn = document.getElementById('pinPrevCueBtn');
const replayCueBtn = document.getElementById('pinReplayCueBtn');
const nextCueBtn = document.getElementById('pinNextCueBtn');
const playPauseBtn = document.getElementById('pinPlayPauseBtn');
const prevPreviewTextEl = document.getElementById('pinPrevPreviewText');
const hotkeysHintEl = document.getElementById('pinHotkeysHint');
const nextPreviewCardEl = document.getElementById('pinNextPreviewCard');
const nextPreviewTextEl = document.getElementById('pinNextPreviewText');
const sourceCardEl = document.getElementById('pinSourceCard');
const outputCardEl = document.getElementById('pinOutputCard');

const params = new URLSearchParams(location.search);
const targetTabIdFromUrl = Number(params.get('tabId')) || null;
const preferredModeFromUrl = params.get('mode') || '';

const state = {
  tabId: targetTabIdFromUrl,
  lastUrl: '',
  platform: '',
  pinPrefs: null,
  pinMode: preferredModeFromUrl || 'dual',
  settings: {
    preferredTargetLanguage: ORIGINAL_LANGUAGE_SENTINEL,
    youtubeLeadMs: 220,
  },
  sourceLabel: 'Original',
  outputLabel: 'Translation',
  sourceCues: [],
  outputCues: [],
  transcriptRows: [],
  liveCaptureOnly: false,
  playbackTimer: null,
  liveTimer: null,
  refreshWatcher: null,
  playbackRate: 1,
  playbackIsPlaying: false,
  playbackTimeMs: 0,
  activeIndex: -1,
  activeTimelineIndex: -1,
  lastRenderedActiveIndex: -2,
  autoScroll: true,
  autoPause: false,
  loopCue: false,
  nextPreviewHidden: true,
  suppressAutoPauseOnce: false,
  liveText: '',
  lastCaptionText: '',
  lastLoopCueStartMs: -1,
  lastLoopTriggerTimeMs: -1,
};

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  init().catch((error) => {
    console.error(error);
    setStatus(error?.message || 'Không khởi tạo được cửa sổ ghim.');
  });
});

window.addEventListener('beforeunload', stopAllTimers);

function bindEvents() {
  refreshBtn?.addEventListener('click', () => loadPinnedData({ force: true }));

  autoScrollBtn?.addEventListener('click', () => {
    state.autoScroll = !state.autoScroll;
    syncControlState();
    if (state.autoScroll) ensureActiveRowVisible();
  });

  autoPauseBtn?.addEventListener('click', () => {
    state.autoPause = !state.autoPause;
    syncControlState();
    setStatus(state.autoPause ? 'Auto pause đã bật.' : 'Auto pause đã tắt.');
  });

  loopCueBtn?.addEventListener('click', () => {
    state.loopCue = !state.loopCue;
    state.lastLoopCueStartMs = -1;
    state.lastLoopTriggerTimeMs = -1;
    syncControlState();
    setStatus(state.loopCue ? 'Loop cue đã bật.' : 'Loop cue đã tắt.');
  });

  revealNextBtn?.addEventListener('click', () => {
    state.nextPreviewHidden = !state.nextPreviewHidden;
    renderStudyRail();
    setStatus(state.nextPreviewHidden ? 'Đã ẩn câu tiếp theo.' : 'Đã hiện câu tiếp theo.');
  });

  copyCurrentBtn?.addEventListener('click', async () => {
    const current = getCurrentCueTextForCopy();
    if (!current) {
      setStatus('Chưa có cue hiện tại để sao chép.');
      return;
    }
    try {
      await navigator.clipboard.writeText(current);
      setStatus('Đã copy cue hiện tại.');
    } catch (error) {
      setStatus(error?.message || 'Không copy được cue hiện tại.');
    }
  });

  copyTranscriptBtn?.addEventListener('click', async () => {
    const text = buildTranscriptExportText();
    if (!text) {
      setStatus('Chưa có transcript để sao chép.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Đã copy full transcript.');
    } catch (error) {
      setStatus(error?.message || 'Không copy được transcript.');
    }
  });

  prevCueBtn?.addEventListener('click', () => seekRelativeCue(-1));
  replayCueBtn?.addEventListener('click', () => replayActiveCue());
  nextCueBtn?.addEventListener('click', () => seekRelativeCue(1));
  playPauseBtn?.addEventListener('click', () => togglePlayback());

  transcriptListEl?.addEventListener('click', async (event) => {
    const row = event.target.closest('.pin-transcript-row');
    if (!row) return;
    const index = Number(row.dataset.index);
    if (!Number.isFinite(index)) return;
    await jumpToTranscriptIndex(index, { play: false, reason: 'seek' });
  });

  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.repeat) return;
    const tag = String(event.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || event.metaKey || event.ctrlKey || event.altKey) return;

    const key = String(event.key || '').toLowerCase();
    if (!key) return;

    if (key === 'a') {
      event.preventDefault();
      seekRelativeCue(-1);
    } else if (key === 's') {
      event.preventDefault();
      replayActiveCue();
    } else if (key === 'd') {
      event.preventDefault();
      seekRelativeCue(1);
    } else if (key === 'q') {
      event.preventDefault();
      autoPauseBtn?.click();
    } else if (key === 'w') {
      event.preventDefault();
      togglePlayback();
    } else if (key === 'e') {
      event.preventDefault();
      revealNextBtn?.click();
    } else if (key === 'c') {
      event.preventDefault();
      copyCurrentBtn?.click();
    } else if (key === 'l') {
      event.preventDefault();
      loopCueBtn?.click();
    }
  });
}

async function init() {
  await loadSettings();
  syncControlState();
  applyPinPresentation();
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
  state.settings.youtubeLeadMs = Number.isFinite(lead) ? lead : 220;
}

function getResolvedPinMode(platform = state.platform || 'default') {
  if (['compact', 'dual', 'review'].includes(preferredModeFromUrl)) return preferredModeFromUrl;
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
  outputCardEl?.classList.toggle('is-hidden', !hasOutput && state.pinMode === 'compact');
}

function syncControlState() {
  autoScrollBtn?.classList.toggle('is-active', state.autoScroll);
  autoScrollBtn && (autoScrollBtn.textContent = state.autoScroll ? 'Auto' : 'Manual');

  autoPauseBtn?.classList.toggle('is-active', state.autoPause);
  autoPauseBtn && (autoPauseBtn.textContent = state.autoPause ? 'Auto pause on' : 'Auto pause');

  loopCueBtn?.classList.toggle('is-active', state.loopCue);
  loopCueBtn && (loopCueBtn.textContent = state.loopCue ? 'Loop cue on' : 'Loop cue');

  revealNextBtn?.classList.toggle('is-active', !state.nextPreviewHidden);
}

function renderStudyRail() {
  const currentIndex = state.activeIndex >= 0 ? state.activeIndex : state.activeTimelineIndex;
  const previousRow = currentIndex > 0 ? state.transcriptRows[currentIndex - 1] : null;
  const nextRow = currentIndex >= 0 ? state.transcriptRows[currentIndex + 1] : state.transcriptRows[0] || null;

  prevPreviewTextEl.textContent = previousRow?.source || '—';

  const nextText = nextRow?.source || 'Next subtitle hidden';
  nextPreviewTextEl.textContent = state.nextPreviewHidden && nextRow ? nextText : nextText || '—';
  nextPreviewCardEl?.classList.toggle('is-blurred', Boolean(state.nextPreviewHidden && nextRow));

  hotkeysHintEl.textContent = state.platform === 'netflix'
    ? 'A prev · S replay · D next · Q auto pause · W play/pause · E reveal next · C copy cue · L loop cue'
    : 'YouTube sync theo time + caption overlay · A/S/D để lùi, replay, tiến · Q/W/E/C/L cho study mode';
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
  state.liveCaptureOnly = false;
  state.activeIndex = -1;
  state.activeTimelineIndex = -1;
  state.lastRenderedActiveIndex = -2;
  state.playbackTimeMs = 0;
  state.playbackIsPlaying = false;
  state.lastCaptionText = '';
  state.liveText = '';
  state.nextPreviewHidden = true;
  syncControlState();

  const tab = await getTargetTab();
  if (!tab?.url) {
    setEmptyPinnedState('Không tìm thấy tab video.', 'Waiting for subtitle…', 'Chưa có dữ liệu dịch hoặc song ngữ.');
    return;
  }

  state.lastUrl = tab.url;
  state.platform = detectPlatform(tab.url) || 'default';
  state.pinMode = getResolvedPinMode(state.platform);

  platformChipEl.textContent = state.platform ? state.platform.toUpperCase() : 'UNSUPPORTED';
  titleEl.textContent = tab.title || 'Video';

  if (state.platform === 'youtube') {
    await loadYoutubePinned(force);
    return;
  }
  if (state.platform === 'netflix') {
    await loadNetflixPinned(force);
    return;
  }

  setEmptyPinnedState(
    'Tab hiện tại không phải YouTube hoặc Netflix.',
    'Waiting for subtitle…',
    'Mở video YouTube hoặc Netflix rồi bấm pin từ popup chính.'
  );
}

async function loadYoutubePinned(force) {
  const metadata = await executeInPage(pageGetYoutubeMetadataPinned, []);
  if (!metadata?.ok || !Array.isArray(metadata.sourceTracks) || !metadata.sourceTracks.length) {
    setEmptyPinnedState(
      metadata?.error || 'Không đọc được phụ đề YouTube.',
      'Waiting for subtitle…',
      'Video YouTube này chưa có phụ đề hoặc chưa đọc được track.'
    );
    return;
  }

  const sourceTrack = metadata.sourceTracks[Math.max(0, Number(metadata.defaultSourceIndex) || 0)] || metadata.sourceTracks[0];
  state.sourceLabel = sourceTrack.name || sourceTrack.languageCode || 'Original';
  state.outputLabel = 'Output';
  sourceLabelEl.textContent = state.sourceLabel;
  outputLabelEl.textContent = state.outputLabel;
  transcriptTitleEl.textContent = 'YouTube full transcript';
  transcriptHintEl.textContent = 'Đồng bộ theo currentTime, có thêm caption overlay assist để bám đúng câu đang hiển thị.';
  footerNoteEl.textContent = 'YouTube pin ưu tiên full timed transcript, vẫn bám cue theo thời gian thực và tự hiệu chỉnh bằng caption overlay nếu player đang hiện sub.';

  const sourceResult = await executeInPage(pageFetchYoutubeTrackPinned, [sourceTrack]);
  if (!sourceResult?.ok || !Array.isArray(sourceResult.cues) || !sourceResult.cues.length) {
    setEmptyPinnedState(
      sourceResult?.error || 'Không tải được phụ đề YouTube.',
      'Waiting for subtitle…',
      'Không tải được nội dung phụ đề YouTube.'
    );
    return;
  }

  state.sourceCues = sanitizeCues(sourceResult.cues);
  state.outputCues = [];

  const targetLanguage = state.settings.preferredTargetLanguage || ORIGINAL_LANGUAGE_SENTINEL;
  if (targetLanguage !== ORIGINAL_LANGUAGE_SENTINEL && sourceTrack.isTranslatable) {
    const targetMeta = Array.isArray(metadata.translationLanguages)
      ? metadata.translationLanguages.find((item) => item.languageCode === targetLanguage)
      : null;

    const translationRequest = {
      ...sourceTrack,
      isTranslation: true,
      sourceLanguageCode: sourceTrack.languageCode,
      targetLanguageCode: targetLanguage,
      targetLanguageName: targetMeta?.name || targetLanguage,
    };

    const translationResult = await executeInPage(pageFetchYoutubeTrackPinned, [translationRequest]);
    if (translationResult?.ok && Array.isArray(translationResult.cues) && translationResult.cues.length) {
      state.outputCues = sanitizeCues(translationResult.cues);
      state.outputLabel = targetMeta?.name || targetLanguage;
      outputLabelEl.textContent = state.outputLabel;
    }
  }

  rebuildTranscriptRowsFromCues();
  setStatus('Live sync');
  await startPlaybackTimer();
}

async function loadNetflixPinned(force) {
  const metadata = await executeInPage(pageGetNetflixMetadataPinned, []);
  if (!metadata?.ok || !Array.isArray(metadata.sourceTracks) || !metadata.sourceTracks.length) {
    setEmptyPinnedState(
      metadata?.error || 'Không đọc được metadata Netflix.',
      'Waiting for subtitle…',
      'Netflix chưa expose subtitle track nào. Hãy bật phụ đề trong player rồi refresh.'
    );
    return;
  }

  const tracks = metadata.sourceTracks.filter((track) => track.fetchStrategy === 'textTrack');
  const liveCaptureTrack = metadata.sourceTracks.find((track) => track.fetchStrategy === 'liveCapture') || null;
  const sourceTrack = metadata.sourceTracks[Math.max(0, Number(metadata.defaultSourceIndex) || 0)] || metadata.sourceTracks[0];

  state.sourceLabel = sourceTrack.name || sourceTrack.languageCode || 'Original';
  state.outputLabel = 'Study note';
  sourceLabelEl.textContent = state.sourceLabel;
  outputLabelEl.textContent = state.outputLabel;
  transcriptTitleEl.textContent = 'Netflix study timeline';
  transcriptHintEl.textContent = 'Prev / Replay / Next + auto pause / reveal next theo workflow kiểu Language Reactor, nhưng gọn hơn và ưu tiên sync theo time.';
  footerNoteEl.textContent = 'Netflix pin ưu tiên full textTrack; nếu không đọc được full cue sẽ rơi về live capture timeline. Có hỗ trợ prev, replay, next, auto pause, reveal next và loop cue.';

  let sourceResult = null;
  if (sourceTrack.fetchStrategy === 'textTrack') {
    sourceResult = await executeInPage(pageFetchNetflixTrackPinned, [sourceTrack]);
  }

  if (sourceResult?.ok && Array.isArray(sourceResult.cues) && sourceResult.cues.length) {
    state.sourceCues = sanitizeCues(sourceResult.cues);
    state.outputCues = [];

    const preferredTargetLanguage = state.settings.preferredTargetLanguage || ORIGINAL_LANGUAGE_SENTINEL;
    let secondaryTrack = null;
    if (preferredTargetLanguage !== ORIGINAL_LANGUAGE_SENTINEL) {
      secondaryTrack = tracks.find(
        (track) => track.languageCode === preferredTargetLanguage && track.languageCode !== sourceTrack.languageCode
      ) || null;
    }
    if (!secondaryTrack) {
      secondaryTrack = tracks.find((track) => track.languageCode !== sourceTrack.languageCode) || null;
    }

    if (secondaryTrack) {
      const secondaryResult = await executeInPage(pageFetchNetflixTrackPinned, [secondaryTrack]);
      if (secondaryResult?.ok && Array.isArray(secondaryResult.cues) && secondaryResult.cues.length) {
        state.outputCues = sanitizeCues(secondaryResult.cues);
        state.outputLabel = secondaryTrack.name || secondaryTrack.languageCode || 'Secondary';
        outputLabelEl.textContent = state.outputLabel;
        footerNoteEl.textContent = 'Netflix pin đang chạy dual-sub thật sự từ textTrack khi title cho phép. Câu active vẫn bám currentTime, còn câu kế tiếp có thể ẩn/hiện để luyện nghe.';
      }
    }

    rebuildTranscriptRowsFromCues();
    setStatus(state.outputCues.length ? 'Dual study' : 'Study sync');
    await startPlaybackTimer();
    return;
  }

  state.liveCaptureOnly = true;
  state.outputCues = [];
  state.transcriptRows = [];
  renderTranscriptList();
  applyPinPresentation();
  renderTexts('Waiting for subtitle…', 'Đang chuyển sang live capture subtitle đang hiển thị.');
  setStatus('Live capture');
  transcriptTitleEl.textContent = 'Netflix live capture timeline';
  transcriptHintEl.textContent = 'Nếu Netflix không expose full textTrack, pin sẽ tích lũy subtitle đang hiện trên player theo thời gian thực.';
  footerNoteEl.textContent = 'Netflix live capture giữ toàn bộ subtitle đã hiện từ lúc pin chạy. Bạn vẫn có prev / replay / next trên timeline đã tích lũy.';
  await startLiveCapture();
}

function sanitizeCues(cues) {
  return (Array.isArray(cues) ? cues : [])
    .map((cue) => ({
      startMs: Math.max(0, Math.round(Number(cue.startMs) || 0)),
      endMs: Math.max(Math.round(Number(cue.endMs) || 0), Math.round(Number(cue.startMs) || 0) + 600),
      text: normalizeCueText(cue.text || ''),
    }))
    .filter((cue) => cue.text)
    .sort((a, b) => a.startMs - b.startMs);
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
  updateTextsFromState();
}

function renderTranscriptList() {
  countChipEl.textContent = `${state.transcriptRows.length} dòng`;
  if (!transcriptListEl) return;

  transcriptListEl.innerHTML = '';
  if (!state.transcriptRows.length) {
    const empty = document.createElement('div');
    empty.className = 'pin-empty-state';
    empty.textContent = 'Chưa có transcript để hiển thị.';
    transcriptListEl.appendChild(empty);
    renderStudyRail();
    return;
  }

  const fragment = document.createDocumentFragment();
  state.transcriptRows.forEach((row, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'pin-transcript-row';
    if (index === state.activeTimelineIndex) item.classList.add('is-active');
    item.dataset.index = String(index);
    item.innerHTML = `
      <div class="pin-transcript-time">${escapeHtml(formatTimestamp(row.startMs))}</div>
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
  updateActiveTranscriptRow();
  applyPinPresentation();
  renderStudyRail();
}

function updateActiveTranscriptRow() {
  if (!transcriptListEl) return;
  if (state.lastRenderedActiveIndex === state.activeTimelineIndex) return;

  transcriptListEl.querySelector('.pin-transcript-row.is-active')?.classList.remove('is-active');
  if (state.activeTimelineIndex >= 0) {
    transcriptListEl.querySelector(`.pin-transcript-row[data-index="${state.activeTimelineIndex}"]`)?.classList.add('is-active');
  }
  state.lastRenderedActiveIndex = state.activeTimelineIndex;
  ensureActiveRowVisible();
  renderStudyRail();
}

function ensureActiveRowVisible() {
  if (!state.autoScroll || !transcriptListEl || state.activeTimelineIndex < 0) return;
  const current = transcriptListEl.querySelector(`.pin-transcript-row[data-index="${state.activeTimelineIndex}"]`);
  current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function appendLiveTranscriptRow(text, timeMs) {
  const normalized = normalizeCueText(text || '');
  if (!normalized) return;

  const previous = state.transcriptRows[state.transcriptRows.length - 1] || null;
  if (previous && normalizeCompareText(previous.source) === normalizeCompareText(normalized)) {
    previous.endMs = Math.max(previous.endMs || previous.startMs || 0, timeMs);
    state.activeTimelineIndex = state.transcriptRows.length - 1;
    updateActiveTranscriptRow();
    return;
  }

  state.transcriptRows.push({
    startMs: Math.max(0, Number(timeMs) || 0),
    endMs: Math.max(0, Number(timeMs) || 0),
    source: normalized,
    output: '',
    kind: 'live',
  });
  state.activeTimelineIndex = state.transcriptRows.length - 1;
  renderTranscriptList();
}

function setEmptyPinnedState(statusText, sourceText, outputText) {
  setStatus(statusText);
  state.transcriptRows = [];
  state.sourceCues = [];
  state.outputCues = [];
  renderTexts(sourceText, outputText);
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
}

function stopLiveCapture() {
  if (state.liveTimer) {
    clearInterval(state.liveTimer);
    state.liveTimer = null;
  }
}

async function startPlaybackTimer() {
  stopPlaybackTimer();
  await refreshPlaybackState();
  state.playbackTimer = window.setInterval(() => {
    refreshPlaybackState().catch(() => {
      // ignore transient failures
    });
  }, 220);
}

async function refreshPlaybackState() {
  const snapshot = await executeInPage(pageGetPlaybackSnapshotPinned, []);
  if (!snapshot?.ok) return;

  state.playbackRate = Number(snapshot.playbackRate || 1) || 1;
  state.playbackIsPlaying = Boolean(snapshot.isPlaying);
  state.playbackTimeMs = Math.max(0, Number(snapshot.currentTimeMs) || 0);
  state.lastCaptionText = normalizeCueText(snapshot.captionText || '');

  const leadMs = state.platform === 'youtube' ? Number(state.settings.youtubeLeadMs || 0) : 0;
  const timeForMatch = state.playbackTimeMs + leadMs;
  const previousIndex = state.activeIndex;
  const indexByTime = findCueIndex(state.sourceCues, timeForMatch, previousIndex);
  const overlayIndex = state.lastCaptionText ? findCueIndexByOverlay(state.sourceCues, state.lastCaptionText, timeForMatch, indexByTime) : -1;
  const resolvedIndex = overlayIndex >= 0 ? overlayIndex : indexByTime;

  if (resolvedIndex !== state.activeIndex) {
    const hadPrevious = state.activeIndex >= 0;
    state.activeIndex = resolvedIndex;
    state.activeTimelineIndex = resolvedIndex;
    updateTextsFromState();
    updateActiveTranscriptRow();

    if (state.platform === 'netflix') {
      state.nextPreviewHidden = true;
      syncControlState();
      renderStudyRail();
    }

    if (
      state.autoPause &&
      state.playbackIsPlaying &&
      hadPrevious &&
      resolvedIndex >= 0 &&
      !state.suppressAutoPauseOnce
    ) {
      await executeInPage(pagePlaybackCommandPinned, [{ action: 'pause' }]);
      state.playbackIsPlaying = false;
      setStatus('Auto paused');
    }
  }

  if (state.suppressAutoPauseOnce && !state.playbackIsPlaying) {
    state.suppressAutoPauseOnce = false;
  }

  if (state.loopCue && state.activeIndex >= 0 && state.playbackIsPlaying) {
    const activeCue = state.sourceCues[state.activeIndex];
    if (activeCue) {
      if (state.playbackTimeMs <= activeCue.startMs + 180) {
        state.lastLoopCueStartMs = -1;
      }
      if (
        state.playbackTimeMs >= activeCue.endMs - 30 &&
        state.lastLoopCueStartMs !== activeCue.startMs &&
        state.lastLoopTriggerTimeMs !== activeCue.startMs
      ) {
        state.lastLoopCueStartMs = activeCue.startMs;
        state.lastLoopTriggerTimeMs = activeCue.startMs;
        state.suppressAutoPauseOnce = true;
        await executeInPage(pagePlaybackCommandPinned, [{ action: 'seek', timeMs: activeCue.startMs, play: true }]);
        setStatus('Loop cue');
        return;
      }
    }
  }

  timeChipEl.textContent = formatTimestamp(state.playbackTimeMs);
  if (state.platform === 'youtube') {
    setStatus(snapshot.captionText ? 'Live sync + overlay' : 'Live sync');
  } else if (!state.autoPause || state.playbackIsPlaying) {
    setStatus(state.playbackIsPlaying ? 'Playing' : 'Paused');
  }
}

async function startLiveCapture() {
  stopLiveCapture();
  await refreshLiveCaptureState();
  state.liveTimer = window.setInterval(() => {
    refreshLiveCaptureState().catch(() => {
      // ignore transient failures
    });
  }, 180);
}

async function refreshLiveCaptureState() {
  const snapshot = await executeInPage(pageGetPlaybackSnapshotPinned, []);
  if (!snapshot?.ok) return;

  const timeMs = Math.max(0, Number(snapshot.currentTimeMs) || 0);
  const liveText = normalizeCueText(snapshot.captionText || '');
  state.playbackTimeMs = timeMs;
  state.playbackIsPlaying = Boolean(snapshot.isPlaying);
  timeChipEl.textContent = formatTimestamp(timeMs);

  if (!liveText) {
    setStatus('Waiting');
    return;
  }

  if (normalizeCompareText(liveText) !== normalizeCompareText(state.liveText)) {
    state.liveText = liveText;
    renderTexts(liveText, 'Netflix live capture đang được lưu theo thời gian.');
    appendLiveTranscriptRow(liveText, timeMs);
    setStatus('Live capture');
  }
}

function updateTextsFromState() {
  if (state.activeIndex < 0 || !state.sourceCues[state.activeIndex]) {
    renderTexts(
      'Waiting for subtitle…',
      state.outputCues.length ? 'Đang chờ câu song ngữ kế tiếp…' : 'Chưa có dữ liệu dịch hoặc song ngữ.'
    );
    renderStudyRail();
    return;
  }

  const sourceCue = state.sourceCues[state.activeIndex];
  let outputText = 'Chưa có dữ liệu dịch hoặc song ngữ.';
  if (state.outputCues.length) {
    const outputCue = findBestOutputCue(sourceCue, state.outputCues, state.activeIndex);
    if (outputCue?.text) outputText = outputCue.text;
  } else if (state.platform === 'netflix') {
    outputText = state.liveCaptureOnly
      ? 'Netflix live capture đang tích lũy từng subtitle theo phiên hiện tại.'
      : 'Netflix study mode đang bật. Dùng Reveal next hoặc Auto pause để học theo từng câu.';
  }

  renderTexts(sourceCue.text || 'Waiting for subtitle…', outputText);
  renderStudyRail();
}

function renderTexts(sourceText, outputText) {
  sourceTextEl.textContent = sourceText || 'Waiting for subtitle…';
  outputTextEl.textContent = outputText || 'Chưa có dữ liệu dịch hoặc song ngữ.';
}

function findCueIndex(cues, timeMs, activeIndex) {
  if (!Array.isArray(cues) || !cues.length) return -1;

  const activeCue = cues[activeIndex];
  if (activeCue && timeMs >= activeCue.startMs - 80 && timeMs < activeCue.endMs + 140) return activeIndex;

  for (let idx = Math.max(0, activeIndex - 2); idx <= Math.min(cues.length - 1, activeIndex + 2); idx += 1) {
    const cue = cues[idx];
    if (cue && timeMs >= cue.startMs - 70 && timeMs < cue.endMs + 120) return idx;
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
  if (Math.abs((cues[candidate]?.startMs || 0) - timeMs) <= 460) return candidate;
  const previous = Math.max(0, candidate - 1);
  if (Math.abs((cues[previous]?.endMs || 0) - timeMs) <= 420) return previous;
  return -1;
}

function findCueIndexByOverlay(cues, overlayText, timeMs, anchorIndex) {
  const normalizedOverlay = normalizeCompareText(overlayText);
  if (!normalizedOverlay || !Array.isArray(cues) || !cues.length) return -1;

  const range = [];
  const center = anchorIndex >= 0 ? anchorIndex : findCueIndex(cues, timeMs, -1);
  for (let idx = Math.max(0, center - 4); idx <= Math.min(cues.length - 1, center + 4); idx += 1) {
    range.push(idx);
  }
  for (let idx = 0; idx < cues.length && range.length < 15; idx += 1) {
    if (!range.includes(idx) && Math.abs(cues[idx].startMs - timeMs) <= 6000) range.push(idx);
  }

  let bestIndex = -1;
  let bestScore = 0;
  for (const idx of range) {
    const cue = cues[idx];
    if (!cue?.text) continue;
    const score = compareCueTexts(cue.text, normalizedOverlay);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = idx;
    }
  }

  return bestScore >= 0.62 ? bestIndex : -1;
}

function compareCueTexts(cueText, overlayNormalized) {
  const normalizedCue = normalizeCompareText(cueText);
  if (!normalizedCue || !overlayNormalized) return 0;
  if (normalizedCue === overlayNormalized) return 1;
  if (normalizedCue.includes(overlayNormalized) || overlayNormalized.includes(normalizedCue)) {
    const ratio = Math.min(normalizedCue.length, overlayNormalized.length) / Math.max(normalizedCue.length, overlayNormalized.length);
    return 0.72 + ratio * 0.18;
  }

  const cueWords = normalizedCue.split(' ').filter(Boolean);
  const overlayWords = overlayNormalized.split(' ').filter(Boolean);
  if (!cueWords.length || !overlayWords.length) return 0;
  const overlaySet = new Set(overlayWords);
  let overlap = 0;
  for (const word of cueWords) {
    if (overlaySet.has(word)) overlap += 1;
  }
  return overlap / Math.max(cueWords.length, overlayWords.length);
}

function findBestOutputCue(sourceCue, cues, preferredIndex) {
  const byIndex = cues[preferredIndex];
  if (byIndex && Math.abs((byIndex.startMs || 0) - sourceCue.startMs) <= 2200) return byIndex;

  let best = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const cue of cues) {
    const delta = Math.abs((cue.startMs || 0) - sourceCue.startMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = cue;
    }
  }
  return bestDelta <= 2600 ? best : null;
}

async function seekRelativeCue(delta) {
  const rows = state.transcriptRows;
  if (!rows.length) return;
  const baseIndex = state.activeTimelineIndex >= 0 ? state.activeTimelineIndex : 0;
  const nextIndex = Math.max(0, Math.min(rows.length - 1, baseIndex + delta));
  await jumpToTranscriptIndex(nextIndex, { play: false, reason: delta < 0 ? 'prev' : 'next' });
}

async function replayActiveCue() {
  const index = state.activeTimelineIndex >= 0 ? state.activeTimelineIndex : state.activeIndex;
  if (index < 0) return;
  await jumpToTranscriptIndex(index, { play: true, reason: 'replay' });
}

async function jumpToTranscriptIndex(index, { play = false, reason = 'seek' } = {}) {
  const row = state.transcriptRows[index];
  if (!row || !Number.isFinite(row.startMs)) return;

  try {
    state.suppressAutoPauseOnce = play;
    await executeInPage(pagePlaybackCommandPinned, [{ action: 'seek', timeMs: row.startMs, play }]);
    state.activeTimelineIndex = index;
    if (state.sourceCues.length && index < state.sourceCues.length) state.activeIndex = index;
    updateTextsFromState();
    updateActiveTranscriptRow();
    setStatus(
      reason === 'prev'
        ? `Prev ${formatTimestamp(row.startMs)}`
        : reason === 'next'
          ? `Next ${formatTimestamp(row.startMs)}`
          : reason === 'replay'
            ? `Replay ${formatTimestamp(row.startMs)}`
            : `Seek ${formatTimestamp(row.startMs)}`
    );
  } catch (error) {
    setStatus(error?.message || 'Không seek được video.');
  }
}

async function togglePlayback() {
  try {
    const result = await executeInPage(pagePlaybackCommandPinned, [{ action: 'toggle' }]);
    if (result?.ok) setStatus(result.isPlaying ? 'Playing' : 'Paused');
  } catch (error) {
    setStatus(error?.message || 'Không điều khiển được playback.');
  }
}

function getCurrentCueTextForCopy() {
  const index = state.activeIndex >= 0 ? state.activeIndex : state.activeTimelineIndex;
  const row = state.transcriptRows[index];
  if (!row) return '';
  const parts = [`${state.sourceLabel || 'Source'}: ${row.source || ''}`];
  if (row.output) parts.push(`${state.outputLabel || 'Output'}: ${row.output}`);
  return parts.join('\n');
}

function buildTranscriptExportText() {
  if (!state.transcriptRows.length) return '';
  return state.transcriptRows.map((row) => {
    const time = formatTimestamp(row.startMs);
    const output = row.output ? `\n${state.outputLabel || 'Output'}: ${row.output}` : '';
    return `[${time}] ${state.sourceLabel || 'Source'}: ${row.source}${output}`;
  }).join('\n\n');
}

function setStatus(text) {
  statusChipEl.textContent = text || 'Ready';
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

function normalizeCompareText(text) {
  return normalizeCueText(text)
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[“”"'`´’]/g, '')
    .replace(/[.,!?;:(){}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function pagePlaybackCommandPinned(command) {
  try {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy player HTML5.' };

    const action = String(command?.action || '');
    const timeMs = Math.max(0, Number(command?.timeMs) || 0);
    const shouldPlay = Boolean(command?.play);

    if (action === 'seek') {
      video.currentTime = timeMs / 1000;
      if (shouldPlay) {
        try { video.play(); } catch {}
      }
      return {
        ok: true,
        currentTimeMs: Math.round(Number(video.currentTime || 0) * 1000),
        isPlaying: !video.paused,
      };
    }

    if (action === 'pause') {
      video.pause();
      return { ok: true, isPlaying: false };
    }

    if (action === 'play') {
      try { video.play(); } catch {}
      return { ok: true, isPlaying: !video.paused };
    }

    if (action === 'toggle') {
      if (video.paused) {
        try { video.play(); } catch {}
      } else {
        video.pause();
      }
      return { ok: true, isPlaying: !video.paused };
    }

    return { ok: false, error: 'Unknown playback command.' };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không điều khiển được playback.' };
  }
}

function pageGetPlaybackSnapshotPinned() {
  function normalizeText(value) {
    return String(value || '')
      .replace(/\u200b/g, '')
      .replace(/\r/g, '')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function getYoutubeCaptionText() {
    const nodeGroups = [
      document.querySelectorAll('.ytp-caption-window-container .ytp-caption-segment'),
      document.querySelectorAll('.caption-window .caption-visual-line .ytp-caption-segment'),
      document.querySelectorAll('.captions-text .caption-visual-line span'),
      document.querySelectorAll('.ytp-caption-window-bottom .ytp-caption-segment'),
    ];

    for (const nodes of nodeGroups) {
      const parts = Array.from(nodes).map((node) => normalizeText(node.textContent || '')).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }

    const blocks = Array.from(document.querySelectorAll('.ytp-caption-window-container .caption-window'));
    for (const block of blocks) {
      const text = normalizeText(block.innerText || block.textContent || '');
      if (text) return text;
    }
    return '';
  }

  function getNetflixCaptionText() {
    const selectors = [
      '[data-uia="player-subtitle"]',
      '[data-uia="subtitle-text"]',
      '.player-timedtext',
      '.player-timedtext-text-container',
      '[class*="timedtext"] [class*="text"]',
      '.watch-video--player-view [class*="timedtext"]',
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      const parts = nodes
        .map((node) => normalizeText(node.innerText || node.textContent || ''))
        .filter(Boolean);
      if (parts.length) return parts.join('\n');
    }
    return '';
  }

  try {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy player HTML5.' };

    const youtubeText = getYoutubeCaptionText();
    const netflixText = youtubeText ? '' : getNetflixCaptionText();

    return {
      ok: true,
      currentTimeMs: Math.round(Number(video.currentTime || 0) * 1000),
      playbackRate: Number(video.playbackRate || 1) || 1,
      isPlaying: !video.paused && !video.ended && Number(video.readyState || 0) >= 2,
      captionText: youtubeText || netflixText,
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
    try {
      return new URL(String(url || '').replace(/\\u0026/g, '&'), location.href).toString();
    } catch {
      return '';
    }
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

  function detectDefaultSourceIndex(sourceTracks) {
    try {
      const player = document.getElementById('movie_player');
      const current = player?.getOption?.('captions', 'track');
      if (!current) return 0;
      const index = sourceTracks.findIndex((track) => {
        const sameLang = track.languageCode === (current.languageCode || current.lang || '');
        const sameVss = track.vssId && current.vss_id && track.vssId === current.vss_id;
        return sameLang || sameVss;
      });
      return index >= 0 ? index : 0;
    } catch {
      return 0;
    }
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
    .map((lang) => ({
      languageCode: lang?.languageCode || '',
      name: getTextFromRuns(lang?.languageName) || lang?.languageCode || '',
    }))
    .filter((item) => item.languageCode);

  return {
    ok: true,
    sourceTracks,
    translationLanguages: langs,
    defaultSourceIndex: detectDefaultSourceIndex(sourceTracks),
  };
}

async function pageFetchYoutubeTrackPinned(track) {
  function normalizeCueTextLocal(text) {
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
    return (
      Number(match[1] || 0) * 3600000 +
      Number(match[2] || 0) * 60000 +
      Number(match[3] || 0) * 1000 +
      Number((match[4] || '0').padEnd(3, '0'))
    );
  }

  function parseXml(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
    const legacyTexts = Array.from(xml.querySelectorAll('text'));
    if (legacyTexts.length) {
      return legacyTexts
        .map((node) => {
          const startMs = Math.round((parseFloat(node.getAttribute('start') || '0') || 0) * 1000);
          const durMs = Math.round((parseFloat(node.getAttribute('dur') || '0') || 0) * 1000);
          const endMs = durMs > 0 ? startMs + durMs : startMs + 1800;
          const html = Array.from(node.childNodes).map((child) => child.textContent || '').join('');
          const text = normalizeCueTextLocal(decodeHtmlEntities(html || node.textContent || ''));
          return text ? { startMs, endMs, text } : null;
        })
        .filter(Boolean);
    }

    const timed = Array.from(xml.querySelectorAll('p'));
    return timed
      .map((node) => {
        const startMs = parseClockToMs(node.getAttribute('begin') || node.getAttribute('start') || '0');
        const endMs = parseClockToMs(node.getAttribute('end') || '0');
        const durMs = parseClockToMs(node.getAttribute('dur') || '0');
        const finalEnd = endMs > startMs ? endMs : startMs + (durMs > 0 ? durMs : 1800);
        const text = normalizeCueTextLocal(decodeHtmlEntities(node.textContent || ''));
        return text ? { startMs, endMs: finalEnd, text } : null;
      })
      .filter(Boolean);
  }

  function parseJsonText(text) {
    try {
      const data = JSON.parse(text);
      const events = Array.isArray(data?.events) ? data.events : [];
      return events
        .map((event) => {
          const startMs = Number(event.tStartMs || event.tStartMs === 0 ? event.tStartMs : 0);
          const durMs = Number(event.dDurationMs || 0);
          const segs = Array.isArray(event.segs) ? event.segs : [];
          const textValue = normalizeCueTextLocal(segs.map((seg) => decodeHtmlEntities(seg.utf8 || '')).join(''));
          return textValue ? { startMs, endMs: durMs > 0 ? startMs + durMs : startMs + 1800, text: textValue } : null;
        })
        .filter(Boolean);
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
      const textValue = normalizeCueTextLocal(lines.slice(timeLineIndex + 1).join('\n'));
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

    const textTracks = Array.from(video.textTracks || []).filter((track) =>
      ['subtitles', 'captions'].includes(String(track.kind || '').toLowerCase())
    );

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

    return {
      ok: true,
      sourceTracks,
      defaultSourceIndex: activeIndex >= 0 ? activeIndex : 0,
    };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không đọc được metadata Netflix.' };
  }
}

async function pageFetchNetflixTrackPinned(track) {
  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  if (track?.fetchStrategy === 'liveCapture') return { ok: false, liveCaptureOnly: true };

  try {
    const video = document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy video Netflix.' };

    const textTracks = Array.from(video.textTracks || []).filter((candidate) =>
      ['subtitles', 'captions'].includes(String(candidate.kind || '').toLowerCase())
    );

    const selectedTrack = textTracks[Number(track.textTrackIndex)] || textTracks[0] || null;
    if (!selectedTrack) return { ok: false, liveCaptureOnly: true };

    const restore = textTracks.map((candidate) => String(candidate.mode || 'disabled'));
    textTracks.forEach((candidate) => {
      try {
        candidate.mode = candidate === selectedTrack ? 'hidden' : 'disabled';
      } catch {}
    });

    let cues = [];
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 220));
      cues = Array.from(selectedTrack.cues || [])
        .map((cue) => ({
          startMs: Math.round(Number(cue.startTime || 0) * 1000),
          endMs: Math.round(Number(cue.endTime || 0) * 1000),
          text: normalizeText(cue.text || ''),
        }))
        .filter((cue) => cue.text);
      if (cues.length) break;
    }

    textTracks.forEach((candidate, index) => {
      try {
        candidate.mode = restore[index] || 'disabled';
      } catch {}
    });

    return cues.length ? { ok: true, cues } : { ok: false, liveCaptureOnly: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không đọc được subtitle Netflix.', liveCaptureOnly: true };
  }
}
