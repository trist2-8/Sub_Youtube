const STORAGE_KEY = 'ytSubtitleGrabberSettingsV8';
const HISTORY_KEY = 'ytSubtitleGrabberRecentHistoryV1';
const ORIGINAL_LANGUAGE_SENTINEL = '__original__';
const MAX_HISTORY_ITEMS = 10;
const WATCH_INTERVAL_MS = 1600;

const state = {
  tab: null,
  videoTitle: '',
  channelName: '',
  videoId: '',
  sourceTracks: [],
  translationLanguages: [],
  selectedSourceIndex: -1,
  selectedTargetLanguage: ORIGINAL_LANGUAGE_SENTINEL,
  rawSourceCues: null,
  rawTranslatedCues: null,
  transcript: null,
  debugLines: [],
  previewTab: 'text',
  showTimestampInText: false,
  settingsOpen: false,
  historyOpen: false,
  selectionMode: 'full',
  searchQuery: '',
  searchMatches: [],
  activeSearchIndex: -1,
  lastActiveUrl: '',
  isLoading: false,
  watchTimer: null,
  trackCache: new Map(),
  history: [],
  bilingualLayout: 'stacked',
  originalTrackIndex: -1,
  originalLanguageCode: '',
  audioLanguageCode: '',
  defaultTrackReason: '',
  settings: {
    outputMode: 'original',
    dedupeRepeats: true,
    mergeShortCues: true,
    preferredTargetLanguage: ORIGINAL_LANGUAGE_SENTINEL,
    showTimestampInText: false,
    bilingualLayout: 'stacked',
    preferOriginalTrack: true,
    autoFetchOnSelectionChange: true,
  },
};

const statusEl = document.getElementById('status');
const sourceTrackSelectEl = document.getElementById('sourceTrackSelect');
const targetLanguageSelectEl = document.getElementById('targetLanguageSelect');
const outputModeSelectEl = document.getElementById('outputModeSelect');
const bilingualLayoutSelectEl = document.getElementById('bilingualLayoutSelect');
const dedupeCheckboxEl = document.getElementById('dedupeCheckbox');
const mergeCheckboxEl = document.getElementById('mergeCheckbox');
const preferOriginalTrackCheckboxEl = document.getElementById('preferOriginalTrackCheckbox');
const autoFetchOnChangeCheckboxEl = document.getElementById('autoFetchOnChangeCheckbox');
const timestampToggleEl = document.getElementById('timestampToggle');

const previewTextareaEl = document.getElementById('preview');
const transcriptPreviewEl = document.getElementById('transcriptPreview');
const previewMetaEl = document.getElementById('previewMeta');
const debugEl = document.getElementById('debug');

const refreshBtn = document.getElementById('refreshBtn');
const settingsBtn = document.getElementById('settingsBtn');
const getSubtitlesBtn = document.getElementById('getSubtitlesBtn');

const copyBtn = document.getElementById('copyBtn');
const copyTextBtn = document.getElementById('copyTextBtn');
const copyTimedBtn = document.getElementById('copyTimedBtn');
const copySrtBtn = document.getElementById('copySrtBtn');

const exportMenuBtn = document.getElementById('exportMenuBtn');
const exportMenuEl = document.getElementById('exportMenu');
const txtBtn = document.getElementById('txtBtn');
const srtBtn = document.getElementById('srtBtn');
const vttBtn = document.getElementById('vttBtn');

const settingsPanelEl = document.getElementById('settingsPanel');
const historyPanelEl = document.getElementById('historyPanel');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const historyBtn = document.getElementById('historyBtn');
const historyCloseBtn = document.getElementById('historyCloseBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));

const videoThumbEl = document.getElementById('videoThumb');
const videoTitleEl = document.getElementById('videoTitle');
const channelNameEl = document.getElementById('channelName');
const trackMetaEl = document.getElementById('trackMeta');
const subtitleBadgeEl = document.getElementById('subtitleBadge');
const lineCountBadgeEl = document.getElementById('lineCountBadge');

const searchInputEl = document.getElementById('searchInput');
const searchInfoEl = document.getElementById('searchInfo');
const searchPrevBtn = document.getElementById('searchPrevBtn');
const searchNextBtn = document.getElementById('searchNextBtn');

const rangeStartInputEl = document.getElementById('rangeStartInput');
const rangeEndInputEl = document.getElementById('rangeEndInput');
const rangeInfoEl = document.getElementById('rangeInfo');
const copyRangeBtn = document.getElementById('copyRangeBtn');
const exportRangeTxtBtn = document.getElementById('exportRangeTxtBtn');
const exportRangeSrtBtn = document.getElementById('exportRangeSrtBtn');

const historyListEl = document.getElementById('historyList');
const historyCountEl = document.getElementById('historyCount');
const selectionModeFullBtn = document.getElementById('selectionModeFullBtn');
const selectionModeCustomBtn = document.getElementById('selectionModeCustomBtn');
const selectionCustomFieldsEl = document.getElementById('selectionCustomFields');

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error(error);
    setStatus(error?.message || 'Không thể khởi tạo popup.');
    setDebug([formatError(error)]);
    renderEmptyPreview('Không thể khởi tạo popup.');
  });
});

window.addEventListener('beforeunload', stopActiveTabWatcher);

refreshBtn?.addEventListener('click', () => loadTracks({ force: true }));
getSubtitlesBtn?.addEventListener('click', () => loadSelectedTrack());
settingsBtn?.addEventListener('click', toggleSettingsPanel);
historyBtn?.addEventListener('click', toggleHistoryPanel);
settingsCloseBtn?.addEventListener('click', closeSettingsPanel);
historyCloseBtn?.addEventListener('click', closeHistoryPanel);
clearHistoryBtn?.addEventListener('click', clearHistory);
selectionModeFullBtn?.addEventListener('click', () => setSelectionMode('full'));
selectionModeCustomBtn?.addEventListener('click', () => setSelectionMode('custom'));

sourceTrackSelectEl?.addEventListener('change', async (event) => {
  state.selectedSourceIndex = Number(event.target.value);
  state.rawSourceCues = null;
  state.rawTranslatedCues = null;
  state.transcript = null;
  state.trackCache.clear();
  rebuildTargetLanguageOptions();
  updateSubtitleBadge();
  updateTrackMeta();
  setActionsEnabled(false);
  resetSearchUi();
  renderEmptyPreview('Đã đổi track.');

  if (state.settings.autoFetchOnSelectionChange) {
    await loadSelectedTrack();
  } else {
    setStatus('Đã đổi track. Bấm Get subtitles để tải lại.');
  }
});

targetLanguageSelectEl?.addEventListener('change', async (event) => {
  state.selectedTargetLanguage = event.target.value;
  state.settings.preferredTargetLanguage = state.selectedTargetLanguage;
  await saveSettings();
  state.rawTranslatedCues = null;

  if (state.settings.autoFetchOnSelectionChange) {
    await loadSelectedTrack();
    return;
  }

  if (state.rawSourceCues?.length) {
    await refreshRenderingAfterSettingChange();
  } else {
    setStatus('Đã đổi output language. Bấm Get subtitles để tải lại.');
  }
});

outputModeSelectEl?.addEventListener('change', async (event) => {
  state.settings.outputMode = event.target.value;
  await saveSettings();

  if (!state.rawSourceCues?.length) {
    renderEmptyPreview('Chưa có transcript để hiển thị.');
    return;
  }

  await refreshRenderingAfterSettingChange();
});

bilingualLayoutSelectEl?.addEventListener('change', async (event) => {
  state.settings.bilingualLayout = event.target.value;
  state.bilingualLayout = event.target.value;
  await saveSettings();
  renderTranscriptPreview();
});

dedupeCheckboxEl?.addEventListener('change', async (event) => {
  state.settings.dedupeRepeats = Boolean(event.target.checked);
  await saveSettings();
  await refreshRenderingAfterSettingChange();
});

mergeCheckboxEl?.addEventListener('change', async (event) => {
  state.settings.mergeShortCues = Boolean(event.target.checked);
  await saveSettings();
  await refreshRenderingAfterSettingChange();
});

preferOriginalTrackCheckboxEl?.addEventListener('change', async (event) => {
  state.settings.preferOriginalTrack = Boolean(event.target.checked);
  await saveSettings();
  await loadTracks({ force: true });
});

autoFetchOnChangeCheckboxEl?.addEventListener('change', async (event) => {
  state.settings.autoFetchOnSelectionChange = Boolean(event.target.checked);
  await saveSettings();
});

timestampToggleEl?.addEventListener('change', async (event) => {
  state.showTimestampInText = Boolean(event.target.checked);
  state.settings.showTimestampInText = state.showTimestampInText;
  await saveSettings();
  renderTranscriptPreview();
});

copyBtn?.addEventListener('click', () => copyCurrentView());
copyTextBtn?.addEventListener('click', () => copyByMode('text'));
copyTimedBtn?.addEventListener('click', () => copyByMode('timed'));
copySrtBtn?.addEventListener('click', () => copyByMode('srt'));

copyRangeBtn?.addEventListener('click', () => copySelectedRange());
exportRangeTxtBtn?.addEventListener('click', () => exportSelectedRange('txt'));
exportRangeSrtBtn?.addEventListener('click', () => exportSelectedRange('srt'));

exportMenuBtn?.addEventListener('click', () => {
  const willOpen = exportMenuEl.classList.contains('hidden');
  exportMenuEl.classList.toggle('hidden', !willOpen);
  exportMenuEl.setAttribute('aria-hidden', String(!willOpen));
  exportMenuBtn.setAttribute('aria-expanded', String(willOpen));
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;

  if (exportMenuEl && exportMenuBtn && !exportMenuEl.contains(target) && !exportMenuBtn.contains(target)) {
    closeExportMenu();
  }

  if (state.settingsOpen && settingsPanelEl && settingsBtn) {
    const clickedInsideSettings = settingsPanelEl.contains(target) || settingsBtn.contains(target);
    if (!clickedInsideSettings) closeSettingsPanel();
  }

  if (state.historyOpen && historyPanelEl && historyBtn) {
    const clickedInsideHistory = historyPanelEl.contains(target) || historyBtn.contains(target);
    if (!clickedInsideHistory) closeHistoryPanel();
  }
});

txtBtn?.addEventListener('click', () => downloadTranscript('txt'));
srtBtn?.addEventListener('click', () => downloadTranscript('srt'));
vttBtn?.addEventListener('click', () => downloadTranscript('vtt'));

for (const button of tabButtons) {
  button.addEventListener('click', () => {
    state.previewTab = button.dataset.tab || 'text';
    syncTabUi();
    renderTranscriptPreview();
  });
}

searchInputEl?.addEventListener('input', () => {
  state.searchQuery = String(searchInputEl.value || '').trim();
  applySearch();
});

searchPrevBtn?.addEventListener('click', () => moveSearchMatch(-1));
searchNextBtn?.addEventListener('click', () => moveSearchMatch(1));

historyListEl?.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const btn = target.closest('button[data-history-index]');
  if (!btn) return;

  const index = Number(btn.dataset.historyIndex);
  const action = btn.dataset.action;
  const item = state.history[index];
  if (!item) return;

  if (action === 'copy-link') {
    await navigator.clipboard.writeText(item.url || '');
    setStatus('Đã sao chép link video từ history.');
    return;
  }

  if (action === 'fill-range') {
    setSelectionMode('custom');
    if (rangeStartInputEl) rangeStartInputEl.value = item.lastRangeStart || '';
    if (rangeEndInputEl) rangeEndInputEl.value = item.lastRangeEnd || '';
    setRangeInfo('Đã nạp khoảng thời gian từ history.');
  }
});

async function init() {
  await loadSettings();
  await loadHistory();
  applySettingsToUi();
  renderHistory();
  syncTabUi();
  syncSelectionModeUi();
  hydrateVideoCardIdle();
  resetSearchUi();
  renderEmptyPreview('Mở một video YouTube rồi bấm refresh hoặc Get subtitles.');
  startActiveTabWatcher();
  await loadTracks({ force: true, fetchNow: true });
}

function setStatus(message) {
  if (statusEl) statusEl.textContent = String(message || '');
}

function setPreviewMeta(message) {
  if (previewMetaEl) previewMetaEl.textContent = String(message || 'Ready');
}

function setLineCount(count) {
  if (lineCountBadgeEl) {
    lineCountBadgeEl.textContent = `${Number(count) || 0} lines`;
  }
}

function setRangeInfo(message) {
  if (rangeInfoEl) rangeInfoEl.textContent = String(message || '');
}

function setDebug(lines) {
  state.debugLines = Array.isArray(lines) && lines.length ? lines.map((line) => String(line)) : ['Chưa có log.'];
  if (debugEl) debugEl.textContent = state.debugLines.join('\n');
}

function appendDebug(...lines) {
  const next = Array.isArray(state.debugLines) ? [...state.debugLines] : [];
  for (const line of lines) next.push(String(line));
  setDebug(next.slice(-250));
}

function formatError(error) {
  if (!error) return 'Lỗi không xác định.';
  if (typeof error === 'string') return error;
  return `${error.name || 'Error'}: ${error.message || 'Không có message'}`;
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeFilename(name) {
  return (
    String(name || 'youtube-subtitles')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140) || 'youtube-subtitles'
  );
}

function extractVideoIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtube.com') && parsed.pathname === '/watch') {
      return parsed.searchParams.get('v') || '';
    }
    if (parsed.hostname.includes('youtube.com') && parsed.pathname.startsWith('/shorts/')) {
      return parsed.pathname.split('/shorts/')[1]?.split('/')[0] || '';
    }
  } catch {}
  return '';
}

function buildYoutubeThumbnailUrl(videoId) {
  if (!videoId) return '';
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

function formatTimestamp(totalMs, separator = ',') {
  const ms = Math.max(0, Math.round(Number(totalMs) || 0));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':') + `${separator}${String(millis).padStart(3, '0')}`;
}

function parseFlexibleTimeToMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) return Number(raw) * 1000;

  const parts = raw.split(':').map((x) => x.trim());
  if (!parts.every((x) => /^\d+$/.test(x))) return null;

  if (parts.length === 2) {
    const [mm, ss] = parts.map(Number);
    return (mm * 60 + ss) * 1000;
  }

  if (parts.length === 3) {
    const [hh, mm, ss] = parts.map(Number);
    return (hh * 3600 + mm * 60 + ss) * 1000;
  }

  return null;
}

function setSearchInfo(message) {
  if (searchInfoEl) searchInfoEl.textContent = String(message || '');
}

function resetSearchUi() {
  state.searchQuery = '';
  state.searchMatches = [];
  state.activeSearchIndex = -1;
  if (searchInputEl) searchInputEl.value = '';
  setSearchInfo('Chưa tìm kiếm.');
}

function setSearchControlsEnabled(enabled) {
  const disabled = !enabled;
  if (searchInputEl) searchInputEl.disabled = disabled;
  if (searchPrevBtn) searchPrevBtn.disabled = disabled;
  if (searchNextBtn) searchNextBtn.disabled = disabled;
}

function setActionsEnabled(enabled) {
  const disabled = !enabled;

  if (copyBtn) copyBtn.disabled = disabled;
  if (copyTextBtn) copyTextBtn.disabled = disabled;
  if (copyTimedBtn) copyTimedBtn.disabled = disabled;
  if (copySrtBtn) copySrtBtn.disabled = disabled;

  if (txtBtn) txtBtn.disabled = disabled;
  if (srtBtn) srtBtn.disabled = disabled;
  if (vttBtn) vttBtn.disabled = disabled;
  if (exportMenuBtn) exportMenuBtn.disabled = disabled;

  if (copyRangeBtn) copyRangeBtn.disabled = disabled;
  if (exportRangeTxtBtn) exportRangeTxtBtn.disabled = disabled;
  if (exportRangeSrtBtn) exportRangeSrtBtn.disabled = disabled;

  setSearchControlsEnabled(enabled);

  if (disabled) closeExportMenu();
}

function setLoading(isLoading) {
  state.isLoading = Boolean(isLoading);

  if (refreshBtn) refreshBtn.disabled = state.isLoading;
  if (getSubtitlesBtn) getSubtitlesBtn.disabled = state.isLoading || !state.sourceTracks.length;

  if (sourceTrackSelectEl) sourceTrackSelectEl.disabled = state.isLoading || !state.sourceTracks.length;
  if (targetLanguageSelectEl) targetLanguageSelectEl.disabled = state.isLoading || !state.sourceTracks.length;
  if (outputModeSelectEl) outputModeSelectEl.disabled = state.isLoading;
  if (bilingualLayoutSelectEl) bilingualLayoutSelectEl.disabled = state.isLoading;
  if (dedupeCheckboxEl) dedupeCheckboxEl.disabled = state.isLoading;
  if (mergeCheckboxEl) mergeCheckboxEl.disabled = state.isLoading;
  if (timestampToggleEl) timestampToggleEl.disabled = state.isLoading;
  if (preferOriginalTrackCheckboxEl) preferOriginalTrackCheckboxEl.disabled = state.isLoading;
  if (autoFetchOnChangeCheckboxEl) autoFetchOnChangeCheckboxEl.disabled = state.isLoading;

  if (state.isLoading) {
    setPreviewMeta('Fetching');
  } else if (!state.transcript?.cues?.length) {
    setPreviewMeta('Ready');
  }
}

function closeExportMenu() {
  if (!exportMenuEl || !exportMenuBtn) return;
  exportMenuEl.classList.add('hidden');
  exportMenuEl.setAttribute('aria-hidden', 'true');
  exportMenuBtn.setAttribute('aria-expanded', 'false');
}

function closeSettingsPanel() {
  state.settingsOpen = false;
  settingsPanelEl?.classList.add('hidden');
  settingsPanelEl?.setAttribute('aria-hidden', 'true');
  settingsBtn?.setAttribute('aria-expanded', 'false');
}

function openSettingsPanel() {
  closeHistoryPanel();
  state.settingsOpen = true;
  settingsPanelEl?.classList.remove('hidden');
  settingsPanelEl?.setAttribute('aria-hidden', 'false');
  settingsBtn?.setAttribute('aria-expanded', 'true');
}

function toggleSettingsPanel() {
  if (state.settingsOpen) closeSettingsPanel();
  else openSettingsPanel();
}

function closeHistoryPanel() {
  state.historyOpen = false;
  historyPanelEl?.classList.add('hidden');
  historyPanelEl?.setAttribute('aria-hidden', 'true');
  historyBtn?.setAttribute('aria-expanded', 'false');
}

function openHistoryPanel() {
  closeSettingsPanel();
  state.historyOpen = true;
  historyPanelEl?.classList.remove('hidden');
  historyPanelEl?.setAttribute('aria-hidden', 'false');
  historyBtn?.setAttribute('aria-expanded', 'true');
}

function toggleHistoryPanel() {
  if (state.historyOpen) closeHistoryPanel();
  else openHistoryPanel();
}

function setSelectionMode(mode) {
  state.selectionMode = mode === 'custom' ? 'custom' : 'full';
  syncSelectionModeUi();
}

function syncSelectionModeUi() {
  const isCustom = state.selectionMode === 'custom';
  selectionModeFullBtn?.classList.toggle('is-active', !isCustom);
  selectionModeCustomBtn?.classList.toggle('is-active', isCustom);
  selectionCustomFieldsEl?.classList.toggle('hidden', !isCustom);
}

function syncTabUi() {
  for (const button of tabButtons) {
    const active = button.dataset.tab === state.previewTab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  }
}

function startActiveTabWatcher() {
  stopActiveTabWatcher();

  state.watchTimer = window.setInterval(async () => {
    try {
      if (state.isLoading) return;
      const tab = await getActiveTab();
      const url = tab?.url || '';
      if (!url || url === state.lastActiveUrl) return;
      state.lastActiveUrl = url;
      await loadTracks({ force: true, fetchNow: state.settings.autoFetchOnSelectionChange });
    } catch {
      // ignore watcher errors
    }
  }, WATCH_INTERVAL_MS);
}

function stopActiveTabWatcher() {
  if (state.watchTimer) {
    clearInterval(state.watchTimer);
    state.watchTimer = null;
  }
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const saved = stored?.[STORAGE_KEY];
    if (saved && typeof saved === 'object') {
      state.settings = { ...state.settings, ...saved };
    }
  } catch (error) {
    console.warn('Không đọc được settings từ storage:', error);
  }

  state.selectedTargetLanguage = state.settings.preferredTargetLanguage || ORIGINAL_LANGUAGE_SENTINEL;
  state.showTimestampInText = Boolean(state.settings.showTimestampInText);
  state.bilingualLayout = state.settings.bilingualLayout || 'stacked';
  state.settings.preferOriginalTrack = state.settings.preferOriginalTrack !== false;
  state.settings.autoFetchOnSelectionChange = state.settings.autoFetchOnSelectionChange !== false;
}

async function saveSettings() {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY]: state.settings,
    });
  } catch (error) {
    console.warn('Không lưu được settings:', error);
  }
}

async function loadHistory() {
  try {
    const stored = await chrome.storage.local.get(HISTORY_KEY);
    const items = stored?.[HISTORY_KEY];
    state.history = Array.isArray(items) ? items : [];
  } catch {
    state.history = [];
  }
}

async function saveHistory() {
  try {
    await chrome.storage.local.set({
      [HISTORY_KEY]: state.history.slice(0, MAX_HISTORY_ITEMS),
    });
  } catch (error) {
    console.warn('Không lưu được history:', error);
  }
}

function renderHistory() {
  if (!historyListEl) return;

  if (!Array.isArray(state.history) || !state.history.length) {
    historyListEl.innerHTML = '<div class="history-empty">Chưa có lịch sử gần đây.</div>';
    if (historyCountEl) historyCountEl.textContent = '0 items';
    return;
  }

  historyListEl.innerHTML = state.history
    .map((item, index) => {
      return `
        <div class="history-item">
          <div class="history-item-title">${escapeHtml(item.videoTitle || 'Unknown video')}</div>
          <div class="history-item-meta">
            ${escapeHtml(item.channelName || 'YouTube')}<br>
            ${escapeHtml(item.trackLabel || 'Unknown track')} · ${escapeHtml(item.outputMode || 'original')}
          </div>
          <div class="history-item-actions">
            <button type="button" data-history-index="${index}" data-action="copy-link">Copy Link</button>
            <button type="button" data-history-index="${index}" data-action="fill-range">Fill Range</button>
          </div>
        </div>
      `;
    })
    .join('');

  if (historyCountEl) historyCountEl.textContent = `${state.history.length} items`;
}

async function clearHistory() {
  state.history = [];
  await saveHistory();
  renderHistory();
  setStatus('Đã xoá lịch sử gần đây.');
}

async function pushHistoryItem(partial = {}) {
  const item = {
    videoId: state.videoId || '',
    videoTitle: state.videoTitle || '',
    channelName: state.channelName || '',
    url: state.tab?.url || '',
    trackLabel: state.transcript?.track?.effectiveLabel || state.transcript?.track?.label || '',
    outputMode: state.settings.outputMode || 'original',
    targetLanguage: state.selectedTargetLanguage || ORIGINAL_LANGUAGE_SENTINEL,
    lastRangeStart: rangeStartInputEl?.value?.trim() || '',
    lastRangeEnd: rangeEndInputEl?.value?.trim() || '',
    updatedAt: new Date().toISOString(),
    ...partial,
  };

  state.history = [item, ...state.history.filter((x) => x.videoId !== item.videoId)].slice(0, MAX_HISTORY_ITEMS);
  await saveHistory();
  renderHistory();
}

function applySettingsToUi() {
  if (outputModeSelectEl) outputModeSelectEl.value = state.settings.outputMode || 'original';
  if (bilingualLayoutSelectEl) bilingualLayoutSelectEl.value = state.bilingualLayout || 'stacked';
  if (dedupeCheckboxEl) dedupeCheckboxEl.checked = Boolean(state.settings.dedupeRepeats);
  if (mergeCheckboxEl) mergeCheckboxEl.checked = Boolean(state.settings.mergeShortCues);
  if (preferOriginalTrackCheckboxEl) preferOriginalTrackCheckboxEl.checked = Boolean(state.settings.preferOriginalTrack);
  if (autoFetchOnChangeCheckboxEl) autoFetchOnChangeCheckboxEl.checked = Boolean(state.settings.autoFetchOnSelectionChange);
  if (timestampToggleEl) timestampToggleEl.checked = Boolean(state.showTimestampInText);
}

async function refreshRenderingAfterSettingChange() {
  if (!state.rawSourceCues?.length) {
    renderEmptyPreview('Chưa có transcript để hiển thị.');
    return;
  }

  const needsTranslated =
    state.selectedTargetLanguage !== ORIGINAL_LANGUAGE_SENTINEL &&
    (state.settings.outputMode === 'translated' || state.settings.outputMode === 'bilingual');

  if (needsTranslated && !state.rawTranslatedCues?.length) {
    await loadSelectedTrack();
    return;
  }

  renderFromRawCues();
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function isSupportedYoutubeUrl(url) {
  return /^https:\/\/(www|m|music)\.youtube\.com\/(watch|shorts)/.test(url || '');
}

async function executeInPage(func, args = []) {
  const tab = state.tab || (await getActiveTab());
  state.tab = tab;

  if (!tab?.id) {
    throw new Error('Không tìm thấy tab đang mở.');
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func,
    args,
  });

  return results?.[0]?.result;
}

function cloneData(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getTrackCacheKey(track) {
  return JSON.stringify({
    videoId: state.videoId || '',
    languageCode: track.languageCode || '',
    sourceLanguageCode: track.sourceLanguageCode || '',
    targetLanguageCode: track.targetLanguageCode || '',
    vssId: track.vssId || '',
    isTranslation: Boolean(track.isTranslation),
  });
}

async function fetchTrackWithCache(track) {
  const key = getTrackCacheKey(track);
  if (state.trackCache.has(key)) {
    appendDebug(`Cache hit: ${track.effectiveLabel || track.label || track.languageCode}`);
    return cloneData(state.trackCache.get(key));
  }

  const result = await executeInPage(pageFetchTrack, [track]);

  if (result?.ok) {
    state.trackCache.set(key, cloneData(result));
  }

  return result;
}

function hydrateVideoCardIdle() {
  if (videoTitleEl) videoTitleEl.textContent = 'Mở một video YouTube để bắt đầu';
  if (channelNameEl) channelNameEl.textContent = 'Extension sẽ đọc video đang mở trong tab hiện tại';
  if (trackMetaEl) trackMetaEl.textContent = 'Track gốc: -';
  setLineCount(0);

  if (videoThumbEl) {
    videoThumbEl.removeAttribute('src');
    videoThumbEl.alt = '';
  }

  setSubtitleBadge('Waiting', 'is-idle');
  setPreviewMeta('Ready');
}

function hydrateVideoCard() {
  if (videoTitleEl) videoTitleEl.textContent = state.videoTitle || 'YT Subtitle Grabber';
  if (channelNameEl) channelNameEl.textContent = state.channelName || 'YouTube';
  updateTrackMeta();

  const thumbnailUrl = buildYoutubeThumbnailUrl(state.videoId);
  if (videoThumbEl) {
    if (thumbnailUrl) {
      videoThumbEl.src = thumbnailUrl;
      videoThumbEl.alt = state.videoTitle || 'YouTube thumbnail';
      videoThumbEl.onerror = () => {
        videoThumbEl.removeAttribute('src');
      };
    } else {
      videoThumbEl.removeAttribute('src');
      videoThumbEl.alt = '';
    }
  }
}

function updateTrackMeta() {
  if (!trackMetaEl) return;

  const selectedTrack = state.sourceTracks[state.selectedSourceIndex];
  const originalTrack = state.sourceTracks[state.originalTrackIndex];
  const parts = [];

  parts.push(`Gốc: ${state.originalLanguageCode || originalTrack?.languageCode || '-'}`);

  if (state.audioLanguageCode) {
    parts.push(`Audio: ${state.audioLanguageCode}`);
  }

  if (selectedTrack?.languageCode) {
    parts.push(`Đang chọn: ${selectedTrack.languageCode}${selectedTrack.isAuto ? ' • auto' : ''}`);
  }

  if (state.defaultTrackReason) {
    parts.push(`Mặc định: ${state.defaultTrackReason}`);
  }

  trackMetaEl.textContent = parts.join(' · ');
}

function setSubtitleBadge(text, className) {
  if (!subtitleBadgeEl) return;
  subtitleBadgeEl.textContent = text;
  subtitleBadgeEl.className = `status-badge ${className || 'is-idle'}`;
}

function resolveBadgeLabel() {
  const track = state.sourceTracks[state.selectedSourceIndex];
  if (!track) return 'Waiting';
  if (state.selectedSourceIndex === state.originalTrackIndex && !track.isAuto) return 'Original track';
  if (track.isAuto) return 'Auto-generated';
  return 'Available';
}

function resolveBadgeClass() {
  const track = state.sourceTracks[state.selectedSourceIndex];
  if (!track) return 'is-idle';
  if (track.isAuto) return 'is-auto';
  return 'is-available';
}

function updateSubtitleBadge() {
  setSubtitleBadge(resolveBadgeLabel(), resolveBadgeClass());
}

function renderEmptyPreview(message) {
  if (!transcriptPreviewEl) return;
  setLineCount(0);
  transcriptPreviewEl.classList.add('empty');
  transcriptPreviewEl.innerHTML = `<div class="empty-state"><p>${escapeHtml(message || 'Chưa có dữ liệu.')}</p></div>`;
  if (previewTextareaEl) previewTextareaEl.value = '';
  setPreviewMeta('Ready');
  setSearchInfo('Chưa tìm kiếm.');
}

function renderSourceTrackOptions() {
  if (!sourceTrackSelectEl) return;
  sourceTrackSelectEl.innerHTML = '';

  if (!state.sourceTracks.length) {
    sourceTrackSelectEl.innerHTML = '<option>Chưa có dữ liệu</option>';
    sourceTrackSelectEl.disabled = true;
    return;
  }

  for (const [index, track] of state.sourceTracks.entries()) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = track.label;
    sourceTrackSelectEl.appendChild(option);
  }

  sourceTrackSelectEl.disabled = false;
}

function rebuildTargetLanguageOptions() {
  if (!targetLanguageSelectEl) return;

  targetLanguageSelectEl.innerHTML = '';

  const originalOption = document.createElement('option');
  originalOption.value = ORIGINAL_LANGUAGE_SENTINEL;
  originalOption.textContent = 'Giữ nguyên phụ đề gốc đã chọn';
  targetLanguageSelectEl.appendChild(originalOption);

  const sourceTrack = state.sourceTracks[state.selectedSourceIndex];
  if (sourceTrack?.isTranslatable) {
    for (const lang of state.translationLanguages) {
      if (!lang?.languageCode) continue;
      if (lang.languageCode === sourceTrack.languageCode) continue;

      const option = document.createElement('option');
      option.value = lang.languageCode;
      option.textContent = `${lang.name} [${lang.languageCode}]`;
      targetLanguageSelectEl.appendChild(option);
    }
  }

  const hasPreferred = Array.from(targetLanguageSelectEl.options).some(
    (option) => option.value === state.selectedTargetLanguage
  );

  if (!hasPreferred) {
    state.selectedTargetLanguage = ORIGINAL_LANGUAGE_SENTINEL;
    state.settings.preferredTargetLanguage = ORIGINAL_LANGUAGE_SENTINEL;
    saveSettings().catch(() => {});
  }

  targetLanguageSelectEl.value = state.selectedTargetLanguage;
  targetLanguageSelectEl.disabled = false;
}

function buildTrackRequest({ targetLanguage = ORIGINAL_LANGUAGE_SENTINEL } = {}) {
  const sourceTrack = state.sourceTracks[state.selectedSourceIndex];
  if (!sourceTrack) return null;

  if (targetLanguage === ORIGINAL_LANGUAGE_SENTINEL) {
    return {
      ...sourceTrack,
      isTranslation: false,
      targetLanguageCode: sourceTrack.languageCode,
      effectiveLabel: sourceTrack.label,
    };
  }

  const target = state.translationLanguages.find((item) => item.languageCode === targetLanguage);
  return {
    ...sourceTrack,
    isTranslation: true,
    sourceLanguageCode: sourceTrack.languageCode,
    targetLanguageCode: targetLanguage,
    targetLanguageName: target?.name || targetLanguage,
    effectiveLabel: `${target?.name || targetLanguage} [${targetLanguage}] ← ${sourceTrack.name} [${sourceTrack.languageCode}]`,
  };
}

async function loadTracks(options = {}) {
  if (state.isLoading && !options.force) return;

  setLoading(true);
  setActionsEnabled(false);
  closeExportMenu();

  state.transcript = null;
  state.rawSourceCues = null;
  state.rawTranslatedCues = null;
  state.trackCache.clear();
  resetSearchUi();
  setDebug([]);
  renderEmptyPreview('Đang đọc danh sách subtitle...');
  hydrateVideoCardIdle();

  try {
    const tab = await getActiveTab();
    state.tab = tab;

    if (!tab?.id || !tab.url) {
      throw new Error('Không tìm thấy tab đang mở.');
    }

    state.lastActiveUrl = tab.url;

    if (!isSupportedYoutubeUrl(tab.url)) {
      state.videoTitle = 'Mở một video YouTube để bắt đầu';
      state.channelName = 'Extension sẽ đọc video đang mở trong tab hiện tại';
      state.videoId = '';
      state.sourceTracks = [];
      state.translationLanguages = [];
      state.selectedSourceIndex = -1;
      renderSourceTrackOptions();
      rebuildTargetLanguageOptions();
      hydrateVideoCard();
      setSubtitleBadge('Waiting', 'is-idle');
      setStatus('Hãy mở video YouTube dạng /watch hoặc /shorts.');
      renderEmptyPreview('Không phải trang video YouTube.');
      return;
    }

    setStatus('Đang đọc danh sách phụ đề từ trang YouTube...');

    const result = await executeInPage(pageGetMetadata, [{
      preferOriginalTrack: Boolean(state.settings.preferOriginalTrack),
    }]);

    setDebug(result?.debug || []);

    if (!result?.ok) {
      state.videoTitle = 'Không đọc được phụ đề';
      state.channelName = result?.error || 'YouTube không trả về metadata phụ đề.';
      state.videoId = extractVideoIdFromUrl(tab.url);
      state.sourceTracks = [];
      state.translationLanguages = [];
      state.selectedSourceIndex = -1;
      renderSourceTrackOptions();
      rebuildTargetLanguageOptions();
      hydrateVideoCard();
      setSubtitleBadge('No subtitles found', 'is-missing');
      setStatus(result?.error || 'Không đọc được dữ liệu phụ đề.');
      renderEmptyPreview('Không đọc được metadata phụ đề của video này.');
      return;
    }

    state.videoTitle = result.videoTitle || sanitizeFilename(tab.title || 'youtube-video');
    state.channelName = result.channelName || 'YouTube';
    state.videoId = result.videoId || extractVideoIdFromUrl(tab.url);
    state.sourceTracks = Array.isArray(result.sourceTracks) ? result.sourceTracks : [];
    state.translationLanguages = Array.isArray(result.translationLanguages) ? result.translationLanguages : [];
    state.originalTrackIndex = Number.isInteger(result.originalTrackIndex) ? result.originalTrackIndex : -1;
    state.originalLanguageCode = result.originalLanguageCode || '';
    state.audioLanguageCode = result.audioLanguageCode || '';
    state.defaultTrackReason = result.defaultTrackReason || '';

    if (!state.sourceTracks.length) {
      renderSourceTrackOptions();
      rebuildTargetLanguageOptions();
      hydrateVideoCard();
      setSubtitleBadge('No subtitles found', 'is-missing');
      setStatus('Video này hiện không có phụ đề để trích xuất.');
      renderEmptyPreview('Không tìm thấy subtitle khả dụng.');
      return;
    }

    const previousTrack = state.sourceTracks[state.selectedSourceIndex];
    const previousVssId = previousTrack?.vssId || '';
    const previousLanguage = previousTrack?.languageCode || '';

    let nextIndex = state.sourceTracks.findIndex((track) => previousVssId && track.vssId === previousVssId);
    if (nextIndex < 0) {
      nextIndex = state.sourceTracks.findIndex((track) => previousLanguage && track.languageCode === previousLanguage);
    }
    if (nextIndex < 0) {
      nextIndex = Number.isInteger(result.defaultSourceIndex) && result.defaultSourceIndex >= 0
        ? result.defaultSourceIndex
        : 0;
    }

    state.selectedSourceIndex = Math.max(0, Math.min(nextIndex, state.sourceTracks.length - 1));

    renderSourceTrackOptions();
    if (sourceTrackSelectEl) sourceTrackSelectEl.value = String(state.selectedSourceIndex);
    rebuildTargetLanguageOptions();
    hydrateVideoCard();
    updateSubtitleBadge();

    setStatus(
      `Tìm thấy ${state.sourceTracks.length} phụ đề gốc. ${
        state.settings.autoFetchOnSelectionChange ? 'Đổi lựa chọn sẽ tự tải lại.' : 'Bấm Get subtitles để tải nội dung.'
      }`
    );

    const shouldFetchNow = Boolean(options.fetchNow || state.settings.autoFetchOnSelectionChange);
    if (shouldFetchNow) {
      await loadSelectedTrack();
    } else {
      renderEmptyPreview('Đã sẵn sàng. Bấm Get subtitles để tải transcript.');
    }
  } catch (error) {
    console.error(error);
    setStatus(error?.message || 'Không thể đọc danh sách phụ đề.');
    setDebug([formatError(error)]);
    setSubtitleBadge('No subtitles found', 'is-missing');
    renderEmptyPreview('Không thể đọc danh sách subtitle.');
  } finally {
    setLoading(false);
  }
}

async function loadSelectedTrack() {
  const sourceRequest = buildTrackRequest({ targetLanguage: ORIGINAL_LANGUAGE_SENTINEL });
  if (!sourceRequest) {
    setStatus('Chưa chọn phụ đề gốc.');
    return;
  }

  setActionsEnabled(false);
  setLoading(true);
  closeExportMenu();
  resetSearchUi();
  renderEmptyPreview('Đang tải subtitle...');
  setStatus(`Đang tải: ${sourceRequest.label}`);
  setDebug([`Đang yêu cầu phụ đề gốc ${sourceRequest.label}...`]);

  try {
    const sourceResult = await fetchTrackWithCache(sourceRequest);
    setDebug(sourceResult?.debug || []);

    if (!sourceResult?.ok || !Array.isArray(sourceResult.cues) || !sourceResult.cues.length) {
      state.transcript = null;
      state.rawSourceCues = null;
      state.rawTranslatedCues = null;
      renderEmptyPreview('Không tải được nội dung subtitle.');
      setSubtitleBadge('No subtitles found', 'is-missing');
      setStatus(sourceResult?.error || 'Không tải được phụ đề gốc cho lựa chọn hiện tại.');
      return;
    }

    state.rawSourceCues = sourceResult.cues;
    state.rawTranslatedCues = null;

    const needsTranslated =
      state.selectedTargetLanguage !== ORIGINAL_LANGUAGE_SENTINEL &&
      (state.settings.outputMode === 'translated' || state.settings.outputMode === 'bilingual');

    if (needsTranslated) {
      const translationRequest = buildTrackRequest({ targetLanguage: state.selectedTargetLanguage });
      appendDebug(`Đang yêu cầu bản dịch: ${translationRequest.effectiveLabel}`);

      const translationResult = await fetchTrackWithCache(translationRequest);
      appendDebug('--- Translation fetch ---', ...(translationResult?.debug || []));

      if (translationResult?.ok && Array.isArray(translationResult.cues) && translationResult.cues.length) {
        state.rawTranslatedCues = translationResult.cues;
      } else {
        state.rawTranslatedCues = [];
      }
    }

    updateSubtitleBadge();
    renderFromRawCues();
  } catch (error) {
    console.error(error);
    state.transcript = null;
    state.rawSourceCues = null;
    state.rawTranslatedCues = null;
    renderEmptyPreview('Không tải được phụ đề.');
    setStatus(error?.message || 'Không tải được phụ đề.');
    setDebug([formatError(error)]);
    setSubtitleBadge('No subtitles found', 'is-missing');
  } finally {
    setLoading(false);
  }
}

function normalizeTextForOutput(text) {
  return String(text || '')
    .replace(/\u200b/g, '')
    .replace(/\r/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function cleanCues(cues, settings) {
  const normalized = Array.isArray(cues)
    ? cues
        .map((cue) => ({
          startMs: Number(cue.startMs) || 0,
          endMs: Math.max(Number(cue.endMs) || 0, Number(cue.startMs) || 0),
          text: normalizeTextForOutput(cue.text),
        }))
        .filter((cue) => cue.text)
    : [];

  let cleaned = normalized;

  if (settings.dedupeRepeats) {
    cleaned = dedupeConsecutiveCues(cleaned);
  }

  if (settings.mergeShortCues) {
    cleaned = mergeShortAdjacentCues(cleaned);
  }

  return cleaned;
}

function dedupeConsecutiveCues(cues) {
  const merged = [];
  for (const cue of cues) {
    const prev = merged[merged.length - 1];
    if (prev && prev.text === cue.text && Math.abs(prev.endMs - cue.startMs) <= 800) {
      prev.endMs = Math.max(prev.endMs, cue.endMs);
      continue;
    }
    merged.push({ ...cue });
  }
  return merged;
}

function mergeShortAdjacentCues(cues) {
  const merged = [];
  const shouldMerge = (current, next) => {
    if (!current || !next) return false;
    const gap = next.startMs - current.endMs;
    if (gap < 0 || gap > 250) return false;
    if (current.text.includes('\n') || next.text.includes('\n')) return false;
    if (current.text.length > 55 || next.text.length > 70) return false;
    if (/[.!?…:]$/.test(current.text)) return false;
    return true;
  };

  for (const cue of cues) {
    const prev = merged[merged.length - 1];
    if (shouldMerge(prev, cue)) {
      prev.text = `${prev.text} ${cue.text}`.replace(/[ \t]{2,}/g, ' ').trim();
      prev.endMs = Math.max(prev.endMs, cue.endMs);
      continue;
    }
    merged.push({ ...cue });
  }

  return merged;
}

function buildBilingualCues(sourceCues, translatedCues) {
  const result = [];

  for (let i = 0; i < sourceCues.length; i += 1) {
    const sourceCue = sourceCues[i];
    const translatedCue = findBestTranslationCue(sourceCue, translatedCues, i);
    const translatedText = translatedCue?.text || '';
    const text = translatedText ? `${sourceCue.text}\n${translatedText}` : sourceCue.text;
    result.push({
      startMs: sourceCue.startMs,
      endMs: sourceCue.endMs,
      text,
    });
  }

  return result;
}

function findBestTranslationCue(sourceCue, translatedCues, preferredIndex) {
  if (!Array.isArray(translatedCues) || !translatedCues.length) return null;

  const byIndex = translatedCues[preferredIndex];
  if (byIndex && Math.abs((byIndex.startMs || 0) - sourceCue.startMs) <= 2000) {
    return byIndex;
  }

  let best = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const cue of translatedCues) {
    const delta = Math.abs((cue.startMs || 0) - sourceCue.startMs);
    if (delta < bestDelta) {
      best = cue;
      bestDelta = delta;
    }
  }

  return bestDelta <= 2500 ? best : null;
}

function buildText(cues, includeTimestamps = false) {
  return cues
    .map((cue) => {
      if (includeTimestamps) {
        return `[${formatTimestamp(cue.startMs, ',')}] ${cue.text}`;
      }
      return cue.text;
    })
    .join('\n');
}

function buildTimedText(cues) {
  return cues
    .map((cue) => `[${formatTimestamp(cue.startMs, ',')} - ${formatTimestamp(cue.endMs, ',')}] ${cue.text}`)
    .join('\n');
}

function buildSrt(cues) {
  return cues
    .map((cue, index) => {
      return [
        String(index + 1),
        `${formatTimestamp(cue.startMs, ',')} --> ${formatTimestamp(cue.endMs, ',')}`,
        cue.text,
      ].join('\n');
    })
    .join('\n\n');
}

function buildVtt(cues) {
  const body = cues
    .map((cue) => `${formatTimestamp(cue.startMs, '.')} --> ${formatTimestamp(cue.endMs, '.')}\n${cue.text}`)
    .join('\n\n');

  return `WEBVTT\n\n${body}`;
}

function renderFromRawCues() {
  if (!Array.isArray(state.rawSourceCues) || !state.rawSourceCues.length) {
    renderEmptyPreview('Chưa có nội dung subtitle.');
    state.transcript = null;
    setActionsEnabled(false);
    return;
  }

  const sourceTrack = state.sourceTracks[state.selectedSourceIndex];
  const sourceCleaned = cleanCues(state.rawSourceCues, state.settings);
  const translatedCleaned = Array.isArray(state.rawTranslatedCues)
    ? cleanCues(state.rawTranslatedCues, state.settings)
    : null;

  const outputMode = state.settings.outputMode;
  const translationSelected = state.selectedTargetLanguage !== ORIGINAL_LANGUAGE_SENTINEL;
  let finalCues = [];
  let modeLabel = 'phụ đề gốc';

  if (outputMode === 'translated' && translationSelected) {
    if (translatedCleaned && translatedCleaned.length) {
      finalCues = translatedCleaned;
      modeLabel = 'bản dịch';
    } else {
      state.transcript = null;
      setActionsEnabled(false);
      renderEmptyPreview('Bản dịch tự động không khả dụng cho video này.');
      setStatus('Bản dịch tự động của YouTube không khả dụng cho video này.');
      return;
    }
  } else if (outputMode === 'bilingual' && translationSelected) {
    if (translatedCleaned && translatedCleaned.length) {
      finalCues = buildBilingualCues(sourceCleaned, translatedCleaned);
      modeLabel = 'song ngữ';
    } else {
      finalCues = sourceCleaned;
      modeLabel = 'phụ đề gốc';
      setStatus('Không lấy được bản dịch, đang hiển thị phụ đề gốc đã làm sạch.');
    }
  } else {
    finalCues = sourceCleaned;
    modeLabel = 'phụ đề gốc';
  }

  if (!finalCues.length) {
    state.transcript = null;
    setActionsEnabled(false);
    setLineCount(0);
    renderEmptyPreview('Không còn subtitle nào sau khi làm sạch.');
    setStatus('Không có phụ đề nào có thể hiển thị sau khi làm sạch.');
    return;
  }

  state.transcript = {
    track: buildTrackRequest({ targetLanguage: state.selectedTargetLanguage }) || sourceTrack,
    cues: finalCues,
    txt: buildText(finalCues, false),
    txtWithTimestamp: buildText(finalCues, true),
    timed: buildTimedText(finalCues),
    srt: buildSrt(finalCues),
    vtt: buildVtt(finalCues),
    modeLabel,
  };

  setActionsEnabled(true);
  renderTranscriptPreview();
  pushHistoryItem().catch(() => {});

  if (!(outputMode === 'bilingual' && translationSelected && (!translatedCleaned || !translatedCleaned.length))) {
    setStatus(`Đã dựng ${finalCues.length} câu ở chế độ ${modeLabel}.`);
  }
}

function updatePreviewTextarea() {
  if (!previewTextareaEl || !state.transcript) return;

  if (state.previewTab === 'srt') {
    previewTextareaEl.value = state.transcript.srt;
    return;
  }

  if (state.previewTab === 'timed') {
    previewTextareaEl.value = state.transcript.timed;
    return;
  }

  previewTextareaEl.value = state.showTimestampInText ? state.transcript.txtWithTimestamp : state.transcript.txt;
}

function renderTranscriptPreview() {
  if (!transcriptPreviewEl) return;

  if (!state.transcript?.cues?.length) {
    setLineCount(0);
    renderEmptyPreview('Phụ đề sẽ hiện ở đây sau khi tải xong.');
    return;
  }

  const cues = state.transcript.cues;
  setLineCount(cues.length);
  updatePreviewTextarea();

  if (state.previewTab === 'srt') {
    transcriptPreviewEl.classList.remove('empty');
    transcriptPreviewEl.innerHTML = `<pre class="transcript-pre">${escapeHtml(state.transcript.srt)}</pre>`;
    setPreviewMeta(`SRT • ${cues.length} cues`);
    applySearch();
    return;
  }

  if (state.previewTab === 'timed') {
    const html = cues
      .map((cue, index) => {
        return `
          <div class="transcript-line" data-index="${index}">
            <div class="transcript-line-time">${escapeHtml(formatTimestamp(cue.startMs, ','))} → ${escapeHtml(formatTimestamp(cue.endMs, ','))}</div>
            <div class="transcript-line-text">${escapeHtml(cue.text).replace(/\n/g, '<br>')}</div>
          </div>
        `;
      })
      .join('');

    transcriptPreviewEl.classList.remove('empty');
    transcriptPreviewEl.innerHTML = html;
    setPreviewMeta(`Timed • ${cues.length} cues`);
    applySearch();
    return;
  }

  const isBilingual =
    state.settings.outputMode === 'bilingual' &&
    state.selectedTargetLanguage !== ORIGINAL_LANGUAGE_SENTINEL;

  const html = cues
    .map((cue, index) => {
      const timePart = state.showTimestampInText
        ? `<div class="transcript-line-time">${escapeHtml(formatTimestamp(cue.startMs, ','))}</div>`
        : '';

      if (isBilingual && cue.text.includes('\n')) {
        const [primary, ...rest] = cue.text.split('\n');
        const secondary = rest.join('\n');
        const layoutClass = state.bilingualLayout === 'split' ? 'split' : 'stacked';

        return `
          <div class="transcript-line" data-index="${index}">
            ${timePart}
            <div class="transcript-line-bilingual ${layoutClass}">
              <div class="bilingual-primary">${escapeHtml(primary).replace(/\n/g, '<br>')}</div>
              <div class="bilingual-secondary">${escapeHtml(secondary).replace(/\n/g, '<br>')}</div>
            </div>
          </div>
        `;
      }

      return `
        <div class="transcript-line" data-index="${index}">
          ${timePart}
          <div class="transcript-line-text">${escapeHtml(cue.text).replace(/\n/g, '<br>')}</div>
        </div>
      `;
    })
    .join('');

  transcriptPreviewEl.classList.remove('empty');
  transcriptPreviewEl.innerHTML = html;
  setPreviewMeta(`Text • ${cues.length} cues`);
  applySearch();
}

function highlightHtmlText(text, query) {
  const raw = String(text || '');
  if (!query) return escapeHtml(raw).replace(/\n/g, '<br>');

  const regex = new RegExp(escapeRegExp(query), 'gi');
  const matches = Array.from(raw.matchAll(regex));
  if (!matches.length) return escapeHtml(raw).replace(/\n/g, '<br>');

  let cursor = 0;
  let html = '';

  for (const match of matches) {
    const index = match.index ?? 0;
    html += escapeHtml(raw.slice(cursor, index));
    html += `<mark>${escapeHtml(match[0])}</mark>`;
    cursor = index + match[0].length;
  }

  html += escapeHtml(raw.slice(cursor));
  return html.replace(/\n/g, '<br>');
}

function highlightPreText(text, query) {
  const raw = String(text || '');
  if (!query) return escapeHtml(raw);

  const regex = new RegExp(escapeRegExp(query), 'gi');
  const matches = Array.from(raw.matchAll(regex));
  if (!matches.length) return escapeHtml(raw);

  let cursor = 0;
  let html = '';

  for (const match of matches) {
    const index = match.index ?? 0;
    html += escapeHtml(raw.slice(cursor, index));
    html += `<mark>${escapeHtml(match[0])}</mark>`;
    cursor = index + match[0].length;
  }

  html += escapeHtml(raw.slice(cursor));
  return html;
}

function resetRenderedContentWithoutSearch() {
  if (!state.transcript?.cues?.length || !transcriptPreviewEl || state.previewTab === 'srt') return;

  const isBilingual =
    state.settings.outputMode === 'bilingual' &&
    state.selectedTargetLanguage !== ORIGINAL_LANGUAGE_SENTINEL;

  const lines = Array.from(transcriptPreviewEl.querySelectorAll('.transcript-line'));
  lines.forEach((lineEl) => {
    const index = Number(lineEl.dataset.index);
    const cue = state.transcript.cues[index];
    if (!cue) return;

    const textEl = lineEl.querySelector('.transcript-line-text');
    const primaryEl = lineEl.querySelector('.bilingual-primary');
    const secondaryEl = lineEl.querySelector('.bilingual-secondary');

    if (isBilingual && cue.text.includes('\n') && (primaryEl || secondaryEl)) {
      const [primary, ...rest] = cue.text.split('\n');
      const secondary = rest.join('\n');
      if (primaryEl) primaryEl.innerHTML = escapeHtml(primary).replace(/\n/g, '<br>');
      if (secondaryEl) secondaryEl.innerHTML = escapeHtml(secondary).replace(/\n/g, '<br>');
    } else if (textEl) {
      textEl.innerHTML = escapeHtml(cue.text).replace(/\n/g, '<br>');
    }

    lineEl.classList.remove('is-match', 'is-active-match');
  });
}

function applySearch() {
  state.searchMatches = [];
  state.activeSearchIndex = -1;

  if (!transcriptPreviewEl || !state.transcript) {
    setSearchInfo('Chưa tìm kiếm.');
    return;
  }

  const query = state.searchQuery.trim();
  if (!query) {
    if (state.previewTab === 'srt') {
      transcriptPreviewEl.innerHTML = `<pre class="transcript-pre">${escapeHtml(state.transcript.srt)}</pre>`;
    } else {
      resetRenderedContentWithoutSearch();
    }
    setSearchInfo(`Hiển thị ${state.transcript.cues.length} cues.`);
    return;
  }

  if (state.previewTab === 'srt') {
    const matchesCount = Array.from(String(state.transcript.srt).matchAll(new RegExp(escapeRegExp(query), 'gi'))).length;
    transcriptPreviewEl.innerHTML = `<pre class="transcript-pre">${highlightPreText(state.transcript.srt, query)}</pre>`;
    setSearchInfo(matchesCount ? `Tìm thấy ${matchesCount} kết quả trong SRT.` : 'Không tìm thấy kết quả.');
    return;
  }

  const lineEls = Array.from(transcriptPreviewEl.querySelectorAll('.transcript-line'));
  lineEls.forEach((lineEl) => {
    const index = Number(lineEl.dataset.index);
    const cue = state.transcript.cues[index];
    if (!cue) return;

    const matched = cue.text.toLowerCase().includes(query.toLowerCase());
    const normalTextEl = lineEl.querySelector('.transcript-line-text');
    const primaryEl = lineEl.querySelector('.bilingual-primary');
    const secondaryEl = lineEl.querySelector('.bilingual-secondary');

    if (normalTextEl) {
      normalTextEl.innerHTML = highlightHtmlText(cue.text, query);
    }

    if (primaryEl || secondaryEl) {
      const [primary, ...rest] = cue.text.split('\n');
      const secondary = rest.join('\n');
      if (primaryEl) primaryEl.innerHTML = highlightHtmlText(primary, query);
      if (secondaryEl) secondaryEl.innerHTML = highlightHtmlText(secondary, query);
    }

    lineEl.classList.toggle('is-match', matched);
    lineEl.classList.remove('is-active-match');

    if (matched) state.searchMatches.push(index);
  });

  if (!state.searchMatches.length) {
    setSearchInfo('Không tìm thấy kết quả.');
    return;
  }

  state.activeSearchIndex = 0;
  focusSearchMatch();
}

function focusSearchMatch() {
  if (!transcriptPreviewEl || !state.searchMatches.length) return;

  const allLines = Array.from(transcriptPreviewEl.querySelectorAll('.transcript-line'));
  allLines.forEach((lineEl) => lineEl.classList.remove('is-active-match'));

  const currentCueIndex = state.searchMatches[state.activeSearchIndex];
  const targetEl = transcriptPreviewEl.querySelector(`.transcript-line[data-index="${currentCueIndex}"]`);
  if (!targetEl) return;

  targetEl.classList.add('is-active-match');
  targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  setSearchInfo(`${state.activeSearchIndex + 1}/${state.searchMatches.length} kết quả`);
}

function moveSearchMatch(direction) {
  if (!state.searchMatches.length) return;
  if (state.previewTab === 'srt') return;

  state.activeSearchIndex =
    (state.activeSearchIndex + direction + state.searchMatches.length) % state.searchMatches.length;

  focusSearchMatch();
}

async function copyByMode(mode) {
  if (!state.transcript) {
    setStatus('Chưa có nội dung để sao chép.');
    return;
  }

  let content = state.transcript.txt;
  let label = 'Text';

  if (mode === 'timed') {
    content = state.transcript.timed;
    label = 'Timed';
  } else if (mode === 'srt') {
    content = state.transcript.srt;
    label = 'SRT';
  }

  await navigator.clipboard.writeText(content);
  closeExportMenu();
  setStatus(`Đã sao chép ${label}.`);
}

async function copyCurrentView() {
  if (!state.transcript) {
    setStatus('Chưa có nội dung để sao chép.');
    return;
  }

  const content = previewTextareaEl?.value || state.transcript.txt;
  await navigator.clipboard.writeText(content);
  closeExportMenu();
  setStatus('Đã sao chép nội dung hiện tại.');
}

async function downloadTranscript(type) {
  if (!state.transcript) {
    setStatus('Chưa có phụ đề để tải.');
    return;
  }

  const track = state.transcript.track || { languageCode: 'unknown', label: 'subtitles' };
  const suffix =
    track.isTranslation && track.targetLanguageCode
      ? `${track.sourceLanguageCode}-to-${track.targetLanguageCode}`
      : track.languageCode || 'unknown';

  const baseName = sanitizeFilename(`${state.videoTitle} - ${suffix} - ${state.settings.outputMode}`);

  let content = '';
  if (type === 'txt') content = state.transcript.txt;
  if (type === 'srt') content = state.transcript.srt;
  if (type === 'vtt') content = state.transcript.vtt;

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url,
      filename: `${baseName}.${type}`,
      saveAs: true,
    });
    setStatus(`Đã tạo file ${type.toUpperCase()} ở chế độ ${state.transcript.modeLabel || 'hiện tại'}.`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    closeExportMenu();
  }
}

function getSelectedRangeCues() {
  setSelectionMode('custom');

  if (!state.transcript?.cues?.length) {
    setRangeInfo('Chưa có transcript để cắt đoạn.');
    return null;
  }

  const startMs = parseFlexibleTimeToMs(rangeStartInputEl?.value);
  const endMs = parseFlexibleTimeToMs(rangeEndInputEl?.value);

  if (startMs == null || endMs == null) {
    setRangeInfo('Thời gian không hợp lệ. Dùng MM:SS hoặc HH:MM:SS.');
    return null;
  }

  if (endMs <= startMs) {
    setRangeInfo('End phải lớn hơn Start.');
    return null;
  }

  const cues = state.transcript.cues.filter((cue) => cue.endMs > startMs && cue.startMs < endMs);
  if (!cues.length) {
    setRangeInfo('Không có subtitle nào trong khoảng đã chọn.');
    return null;
  }

  setRangeInfo(`Đã chọn ${cues.length} cues trong khoảng ${rangeStartInputEl.value} → ${rangeEndInputEl.value}.`);
  return cues.map((cue) => ({
    ...cue,
    startMs: Math.max(cue.startMs, startMs),
    endMs: Math.min(cue.endMs, endMs),
  }));
}

async function copySelectedRange() {
  const cues = getSelectedRangeCues();
  if (!cues) return;

  await navigator.clipboard.writeText(buildText(cues, false));
  setStatus('Đã sao chép đoạn subtitle đã chọn.');
  await pushHistoryItem({
    lastRangeStart: rangeStartInputEl?.value?.trim() || '',
    lastRangeEnd: rangeEndInputEl?.value?.trim() || '',
  });
}

async function exportSelectedRange(type) {
  const cues = getSelectedRangeCues();
  if (!cues) return;

  const content = type === 'srt' ? buildSrt(cues) : buildText(cues, false);
  const ext = type === 'srt' ? 'srt' : 'txt';
  const startLabel = (rangeStartInputEl?.value || 'start').replace(/:/g, '-');
  const endLabel = (rangeEndInputEl?.value || 'end').replace(/:/g, '-');
  const filename = sanitizeFilename(`${state.videoTitle} - clip ${startLabel}-${endLabel}.${ext}`);

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url,
      filename,
      saveAs: true,
    });
    setStatus(`Đã export đoạn ${ext.toUpperCase()}.`);
    await pushHistoryItem({
      lastRangeStart: rangeStartInputEl?.value?.trim() || '',
      lastRangeEnd: rangeEndInputEl?.value?.trim() || '',
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

function pageGetMetadata(options = {}) {
  const debug = [];

  function push(message) {
    debug.push(String(message));
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
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

    const scripts = Array.from(document.scripts)
      .map((script) => script.textContent || '')
      .filter(Boolean);

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
            if (raw) {
              push('Nguồn playerResponse: parse từ script ytplayer.config');
              return typeof raw === 'string' ? JSON.parse(raw) : raw;
            }
          } else {
            push(`Nguồn playerResponse: parse từ script marker ${marker}`);
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
      if (response && typeof response === 'object') {
        push('Nguồn playerResponse: movie_player.getPlayerResponse()');
        return response;
      }
    } catch (error) {
      push(`movie_player.getPlayerResponse lỗi: ${error.message}`);
    }

    try {
      if (window.ytInitialPlayerResponse) {
        push('Nguồn playerResponse: window.ytInitialPlayerResponse');
        return window.ytInitialPlayerResponse;
      }
    } catch (error) {
      push(`window.ytInitialPlayerResponse lỗi: ${error.message}`);
    }

    try {
      const raw = window.ytplayer?.config?.args?.player_response;
      if (raw) {
        push('Nguồn playerResponse: ytplayer.config.args.player_response');
        return JSON.parse(raw);
      }
    } catch (error) {
      push(`ytplayer.config.args.player_response lỗi: ${error.message}`);
    }

    try {
      const raw =
        window.ytcfg?.data_?.PLAYER_VARS?.player_response ||
        window.ytcfg?.get?.('PLAYER_VARS')?.player_response;
      if (raw) {
        push('Nguồn playerResponse: ytcfg PLAYER_VARS');
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      }
    } catch (error) {
      push(`ytcfg PLAYER_VARS lỗi: ${error.message}`);
    }

    return tryParsePlayerResponseFromScripts();
  }

  function getCurrentCaptionTrackHint() {
    try {
      const player = document.getElementById('movie_player');
      const current = player?.getOption?.('captions', 'track');
      if (current && typeof current === 'object') {
        const hint = {
          languageCode: current.languageCode || current.lang || '',
          vssId: current.vssId || current.vss_id || '',
          kind: current.kind || '',
        };
        push(`current caption track hint=${JSON.stringify(hint)}`);
        return hint;
      }
    } catch (error) {
      push(`getOption(captions, track) lỗi: ${error.message}`);
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
    if (!Array.isArray(sourceTracks) || !sourceTracks.length) {
      return { index: -1, languageCode: '', reason: '' };
    }

    const audioInfo = getAudioTrackInfo(sourceTracks, renderer);
    if (audioInfo.index >= 0) {
      push(`Track gốc theo audioTracks.defaultCaptionTrackIndex -> ${audioInfo.index}`);
      return audioInfo;
    }

    const firstManual = sourceTracks.findIndex((track) => !track.isAuto);
    if (firstManual >= 0) {
      push(`Track gốc fallback theo first manual track -> ${firstManual}`);
      return {
        index: firstManual,
        languageCode: sourceTracks[firstManual]?.languageCode || '',
        reason: 'manual đầu tiên',
      };
    }

    const currentTrack = getCurrentCaptionTrackHint();
    const currentIndex = matchTrackIndexFromHint(sourceTracks, currentTrack);
    if (currentIndex >= 0) {
      push(`Track gốc fallback theo currentTrack -> ${currentIndex}`);
      return {
        index: currentIndex,
        languageCode: sourceTracks[currentIndex]?.languageCode || '',
        reason: 'track đang bật',
      };
    }

    push('Track gốc fallback -> 0');
    return {
      index: 0,
      languageCode: sourceTracks[0]?.languageCode || '',
      reason: 'fallback',
    };
  }

  function computeDefaultSourceInfo(sourceTracks, renderer, originalInfo) {
    if (!Array.isArray(sourceTracks) || !sourceTracks.length) {
      return { index: -1, languageCode: '', reason: '' };
    }

    if (options?.preferOriginalTrack !== false && originalInfo.index >= 0) {
      push(`Default ưu tiên track gốc -> ${originalInfo.index}`);
      return originalInfo;
    }

    const currentTrack = getCurrentCaptionTrackHint();
    const currentIndex = matchTrackIndexFromHint(sourceTracks, currentTrack);
    if (currentIndex >= 0) {
      push(`Default theo currentTrack -> ${currentIndex}`);
      return {
        index: currentIndex,
        languageCode: sourceTracks[currentIndex]?.languageCode || '',
        reason: 'track đang bật',
      };
    }

    push(`Default fallback về track gốc -> ${originalInfo.index}`);
    return originalInfo;
  }

  const playerResponse = getPlayerResponse();
  if (!playerResponse) {
    return { ok: false, error: 'Không đọc được player response từ trang YouTube.', debug };
  }

  const renderer = playerResponse?.captions?.playerCaptionsTracklistRenderer;
  const captionTracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
  const translationLanguages = Array.isArray(renderer?.translationLanguages) ? renderer.translationLanguages : [];

  push(`captionTracks=${captionTracks.length}`);
  push(`translationLanguages=${translationLanguages.length}`);

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

  push(`originalTrackIndex=${originalTrackInfo.index}`);
  push(`defaultSourceIndex=${defaultSourceInfo.index}`);

  return {
    ok: true,
    videoTitle: playerResponse?.videoDetails?.title || document.title.replace(/ - YouTube$/, ''),
    channelName: playerResponse?.videoDetails?.author || '',
    videoId: playerResponse?.videoDetails?.videoId || '',
    sourceTracks,
    translationLanguages: translationLangs,
    defaultSourceIndex: defaultSourceInfo.index,
    originalTrackIndex: originalTrackInfo.index,
    originalLanguageCode: originalTrackInfo.languageCode,
    audioLanguageCode: audioInfo.languageCode,
    defaultTrackReason: defaultSourceInfo.reason,
    debug,
  };
}

async function pageFetchTrack(track) {
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

    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    const millis = Number((match[4] || '0').padEnd(3, '0'));

    return hours * 3600000 + minutes * 60000 + seconds * 1000 + millis;
  }

  function parseJson3ToCues(payload) {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const cues = [];

    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      const rawText = Array.isArray(event?.segs)
        ? event.segs.map((segment) => segment?.utf8 || '').join('')
        : '';

      const text = normalizeCueText(rawText);
      if (!text) continue;

      const startMs = Number(event?.tStartMs ?? 0);
      const nextEvent = events[i + 1];
      const durationMs = Number(event?.dDurationMs ?? 0);

      let endMs = startMs + durationMs;
      if (!durationMs && nextEvent?.tStartMs != null) endMs = Number(nextEvent.tStartMs);
      if (!endMs || endMs <= startMs) endMs = startMs + 2000;

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
          const endMs = durMs > 0 ? startMs + durMs : startMs + 2000;
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
          endMs = Number.isFinite(nextStart) && nextStart > startMs ? nextStart : startMs + 2000;
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

      cues.push({
        startMs,
        endMs: endMs > startMs ? endMs : startMs + 2000,
        text: cueText,
      });
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
    if (!player) {
      push('Không tìm thấy #movie_player');
      return;
    }

    try {
      player.loadModule?.('captions');
      push('Đã gọi loadModule("captions")');
    } catch (error) {
      push(`loadModule captions lỗi: ${error.message}`);
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
        push(`setOption captions.track ${JSON.stringify(payload)}`);
      } catch (error) {
        push(`setOption track lỗi: ${error.message}`);
      }
    }

    try {
      player.setOption?.('captions', 'reload', true);
      push('Đã gọi setOption(captions, reload, true)');
    } catch (error) {
      push(`setOption reload lỗi: ${error.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
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

        push(
          `Thử ${candidate.reason}: status=${response.status}, type=${contentType || 'unknown'}, chars=${text.trim().length}, format=${parsed.format}, cues=${parsed.cues.length}`
        );

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

  if (!track?.baseUrl) {
    return { ok: false, error: 'Track không có baseUrl.', debug };
  }

  const effectiveUrl = buildEffectiveTrackUrl(track);
  if (!effectiveUrl) {
    return { ok: false, error: 'Không tạo được URL phụ đề hợp lệ.', debug };
  }

  push(`effectiveUrl=${effectiveUrl}`);

  const initialNetworkUrls = collectNetworkTimedtextUrls();
  push(`performance timedtext URLs=${initialNetworkUrls.length}`);

  const firstCandidates = [];
  const firstSeen = new Set();

  for (const url of initialNetworkUrls.filter((candidate) => matchesTrack(candidate, track))) {
    for (const variant of buildFormatVariants(url, track)) {
      addCandidate(firstCandidates, firstSeen, variant, 'performance entry');
    }
  }

  for (const variant of buildFormatVariants(effectiveUrl, track)) {
    addCandidate(firstCandidates, firstSeen, variant, 'effective track url');
  }

  let result = await tryFetchCandidates(firstCandidates);
  if (result) return result;

  push('Lượt 1 thất bại, thử kích hoạt captions trên player...');
  await tryActivateTrack(track);

  const secondNetworkUrls = collectNetworkTimedtextUrls();
  push(`sau kích hoạt timedtext URLs=${secondNetworkUrls.length}`);

  const secondCandidates = [];
  const secondSeen = new Set();

  for (const url of secondNetworkUrls.filter((candidate) => matchesTrack(candidate, track))) {
    for (const variant of buildFormatVariants(url, track)) {
      addCandidate(secondCandidates, secondSeen, variant, 'performance entry sau kích hoạt');
    }
  }

  for (const variant of buildFormatVariants(effectiveUrl, track)) {
    addCandidate(secondCandidates, secondSeen, variant, 'effective track url');
  }

  result = await tryFetchCandidates(secondCandidates);
  if (result) return result;

  return {
    ok: false,
    error: 'Timedtext không trả được dữ liệu parse được cho lựa chọn này.',
    debug,
  };
}


/* ===== Enhancement v4.1.0: isolated pin window + safer live sync + Netflix fallback ===== */
const PINNED_STATE_KEY_V41 = 'subtitleGrabberPinnedStateV41';
const pinBtnV41 = document.getElementById('pinBtn');
const playbackStatusChipElV41 = document.getElementById('playbackStatusChip');
const playbackTimeChipElV41 = document.getElementById('playbackTimeChip');
const activeCueChipElV41 = document.getElementById('activeCueChip');
const autoScrollLiveCheckboxElV41 = document.getElementById('autoScrollLiveCheckbox');
const youtubeLeadRangeElV41 = document.getElementById('youtubeLeadRange');
const youtubeLeadValueElV41 = document.getElementById('youtubeLeadValue');
const V41_DEFAULT_YT_LEAD_MS = 220;
const V41_POLL_MS = 110;
const V41_RENDER_MS = 34;
const V41_STALE_MS = 800;
const V41_NETFLIX_CAPTURE_MS = 140;

state.currentPlatform = '';
state.playbackTimer = null;
state.playbackRenderTimer = null;
state.playbackBaseMs = 0;
state.playbackPerfMs = 0;
state.playbackTimeMs = 0;
state.playbackRate = 1;
state.playbackIsPlaying = false;
state.activeCueIndex = -1;
state.lastScrolledCueIndex = -1;
state.netflixLiveCaptureTimer = null;
state.netflixLiveCaptureBuffer = [];
state.netflixLiveCaptureLastText = '';
state.liveCaptureLive = false;
state.settings.autoScrollLive = state.settings.autoScrollLive !== false;
state.settings.youtubeLeadMs = Number.isFinite(Number(state.settings.youtubeLeadMs)) ? Number(state.settings.youtubeLeadMs) : V41_DEFAULT_YT_LEAD_MS;

const __v41BaseLoadSettings = loadSettings;
loadSettings = async function () {
  await __v41BaseLoadSettings();
  state.settings.autoScrollLive = state.settings.autoScrollLive !== false;
  const ytLead = Number(state.settings.youtubeLeadMs);
  state.settings.youtubeLeadMs = Number.isFinite(ytLead) ? ytLead : V41_DEFAULT_YT_LEAD_MS;
};

const __v41BaseApplySettingsToUi = applySettingsToUi;
applySettingsToUi = function () {
  __v41BaseApplySettingsToUi();
  if (autoScrollLiveCheckboxElV41) {
    autoScrollLiveCheckboxElV41.checked = Boolean(state.settings.autoScrollLive);
  }
  if (youtubeLeadRangeElV41) {
    youtubeLeadRangeElV41.value = String(Number(state.settings.youtubeLeadMs) || V41_DEFAULT_YT_LEAD_MS);
  }
  updateYoutubeLeadUiV41();
};

const __v41BaseGetTrackCacheKey = getTrackCacheKey;
getTrackCacheKey = function (track) {
  try {
    const parsed = JSON.parse(__v41BaseGetTrackCacheKey(track));
    parsed.platform = track?.platform || state.currentPlatform || 'youtube';
    parsed.fetchStrategy = track?.fetchStrategy || '';
    parsed.textTrackIndex = Number.isInteger(track?.textTrackIndex) ? track.textTrackIndex : '';
    return JSON.stringify(parsed);
  } catch {
    return JSON.stringify({
      videoId: state.videoId || '',
      languageCode: track?.languageCode || '',
      platform: track?.platform || state.currentPlatform || 'youtube',
      fetchStrategy: track?.fetchStrategy || '',
      textTrackIndex: Number.isInteger(track?.textTrackIndex) ? track.textTrackIndex : '',
    });
  }
};

const __v41BaseHydrateVideoCardIdle = hydrateVideoCardIdle;
hydrateVideoCardIdle = function () {
  __v41BaseHydrateVideoCardIdle();
  if (state.currentPlatform === 'netflix') {
    if (videoTitleEl) videoTitleEl.textContent = 'Mở một video Netflix để bắt đầu';
    if (channelNameEl) channelNameEl.textContent = 'Extension sẽ đọc subtitle từ player HTML5 trong tab hiện tại';
    if (trackMetaEl) trackMetaEl.textContent = 'Platform: Netflix · Track gốc: -';
  }
};

const __v41BaseHydrateVideoCard = hydrateVideoCard;
hydrateVideoCard = function () {
  if (state.currentPlatform === 'netflix') {
    if (videoTitleEl) videoTitleEl.textContent = state.videoTitle || 'Netflix';
    if (channelNameEl) channelNameEl.textContent = 'Netflix';
    if (videoThumbEl) {
      videoThumbEl.removeAttribute('src');
      videoThumbEl.alt = '';
    }
    updateTrackMeta();
    return;
  }
  __v41BaseHydrateVideoCard();
};

updateTrackMeta = function () {
  if (!trackMetaEl) return;
  const selectedTrack = state.sourceTracks[state.selectedSourceIndex];
  const originalTrack = state.sourceTracks[state.originalTrackIndex];
  const parts = [];
  if (state.currentPlatform) {
    parts.push(`Platform: ${state.currentPlatform === 'netflix' ? 'Netflix' : 'YouTube'}`);
  }
  parts.push(`Gốc: ${state.originalLanguageCode || originalTrack?.languageCode || '-'}`);
  if (state.audioLanguageCode) parts.push(`Audio: ${state.audioLanguageCode}`);
  if (selectedTrack?.languageCode) {
    let label = selectedTrack.languageCode;
    if (selectedTrack.isAuto) label += ' • auto';
    if (selectedTrack.fetchStrategy === 'liveCapture') label += ' • live';
    parts.push(`Đang chọn: ${label}`);
  }
  if (state.defaultTrackReason) parts.push(`Mặc định: ${state.defaultTrackReason}`);
  trackMetaEl.textContent = parts.join(' · ');
};

const __v41BaseRenderEmptyPreview = renderEmptyPreview;
renderEmptyPreview = function (message) {
  stopPlaybackWatcherV41();
  __v41BaseRenderEmptyPreview(message);
};

const __v41BaseRenderTranscriptPreview = renderTranscriptPreview;
renderTranscriptPreview = function () {
  __v41BaseRenderTranscriptPreview();
  markTranscriptLinesClickableV41();
  syncActiveCueFromPlaybackV41({ scroll: false });
};

const __v41BaseRenderFromRawCues = renderFromRawCues;
renderFromRawCues = function () {
  __v41BaseRenderFromRawCues();
  if (state.transcript?.cues?.length && !state.liveCaptureLive) {
    startPlaybackWatcherV41();
  } else if (!state.liveCaptureLive) {
    stopPlaybackWatcherV41();
  }
};

const __v41BaseLoadTracks = loadTracks;
loadTracks = async function (options = {}) {
  const tab = await getActiveTab();
  const platform = detectPlatformFromUrlV41(tab?.url);
  state.currentPlatform = platform || '';

  if (platform === 'youtube') {
    stopNetflixLiveCaptureV41();
    return __v41BaseLoadTracks(options);
  }

  if (platform !== 'netflix') {
    stopNetflixLiveCaptureV41();
    stopPlaybackWatcherV41();
    setLoading(true);
    setActionsEnabled(false);
    closeExportMenu();
    state.tab = tab;
    state.transcript = null;
    state.rawSourceCues = null;
    state.rawTranslatedCues = null;
    state.trackCache.clear();
    resetSearchUi();
    setDebug([]);
    renderEmptyPreview('Không phải trang video YouTube hoặc Netflix.');
    hydrateVideoCardIdle();
    state.videoTitle = 'Mở YouTube hoặc Netflix để bắt đầu';
    state.channelName = 'Extension đọc video trong tab hiện tại';
    state.videoId = '';
    state.sourceTracks = [];
    state.translationLanguages = [];
    state.selectedSourceIndex = -1;
    renderSourceTrackOptions();
    rebuildTargetLanguageOptions();
    hydrateVideoCard();
    setSubtitleBadge('Waiting', 'is-idle');
    setStatus('Hãy mở video YouTube dạng /watch hoặc Netflix /watch.');
    setLoading(false);
    return;
  }

  if (state.isLoading && !options.force) return;
  stopNetflixLiveCaptureV41();
  stopPlaybackWatcherV41();
  setLoading(true);
  setActionsEnabled(false);
  closeExportMenu();
  state.transcript = null;
  state.rawSourceCues = null;
  state.rawTranslatedCues = null;
  state.trackCache.clear();
  resetSearchUi();
  setDebug([]);
  renderEmptyPreview('Đang đọc danh sách subtitle Netflix...');
  hydrateVideoCardIdle();

  try {
    state.tab = tab;
    if (!tab?.id || !tab.url) throw new Error('Không tìm thấy tab Netflix đang mở.');
    state.lastActiveUrl = tab.url;

    setStatus('Đang đọc danh sách subtitle từ player Netflix...');
    const result = await executeInPage(pageGetNetflixMetadataV41, []);
    setDebug(result?.debug || []);

    if (!result?.ok) {
      state.videoTitle = 'Không đọc được phụ đề';
      state.channelName = result?.error || 'Netflix không trả về metadata phụ đề.';
      state.videoId = '';
      state.sourceTracks = [];
      state.translationLanguages = [];
      state.selectedSourceIndex = -1;
      renderSourceTrackOptions();
      rebuildTargetLanguageOptions();
      hydrateVideoCard();
      setSubtitleBadge('No subtitles found', 'is-missing');
      setStatus(result?.error || 'Không đọc được dữ liệu phụ đề Netflix.');
      renderEmptyPreview('Không đọc được metadata phụ đề của Netflix. Hãy bật subtitle trong player rồi refresh.');
      return;
    }

    state.videoTitle = result.videoTitle || sanitizeFilename(tab.title || 'Netflix');
    state.channelName = result.channelName || 'Netflix';
    state.videoId = result.videoId || '';
    state.sourceTracks = Array.isArray(result.sourceTracks) ? result.sourceTracks : [];
    state.translationLanguages = [];
    state.originalTrackIndex = Number.isInteger(result.originalTrackIndex) ? result.originalTrackIndex : -1;
    state.originalLanguageCode = result.originalLanguageCode || '';
    state.audioLanguageCode = result.audioLanguageCode || '';
    state.defaultTrackReason = result.defaultTrackReason || '';

    if (!state.sourceTracks.length) {
      renderSourceTrackOptions();
      rebuildTargetLanguageOptions();
      hydrateVideoCard();
      setSubtitleBadge('No subtitles found', 'is-missing');
      setStatus('Video Netflix này chưa expose subtitle track nào.');
      renderEmptyPreview('Netflix chưa expose subtitle track nào. Hãy bật subtitle trong player rồi refresh.');
      return;
    }

    state.selectedSourceIndex = Number.isInteger(result.defaultSourceIndex) && result.defaultSourceIndex >= 0
      ? result.defaultSourceIndex
      : 0;
    state.selectedTargetLanguage = ORIGINAL_LANGUAGE_SENTINEL;
    state.settings.outputMode = state.settings.outputMode === 'translated' ? 'original' : state.settings.outputMode;

    renderSourceTrackOptions();
    rebuildTargetLanguageOptions();
    sourceTrackSelectEl.value = String(state.selectedSourceIndex);
    outputModeSelectEl.value = state.settings.outputMode;
    hydrateVideoCard();
    updateSubtitleBadge();
    setStatus('Đã đọc xong danh sách subtitle Netflix.');

    if (options.fetchNow) {
      await loadSelectedTrack();
    } else {
      renderEmptyPreview('Chọn track rồi bấm Get subtitles để tải nội dung.');
    }
  } catch (error) {
    console.error(error);
    state.sourceTracks = [];
    state.translationLanguages = [];
    state.selectedSourceIndex = -1;
    renderSourceTrackOptions();
    rebuildTargetLanguageOptions();
    hydrateVideoCard();
    setSubtitleBadge('No subtitles found', 'is-missing');
    setStatus(error?.message || 'Không đọc được phụ đề Netflix.');
    renderEmptyPreview('Không đọc được metadata phụ đề Netflix.');
    setDebug([formatError(error)]);
  } finally {
    setLoading(false);
  }
};

const __v41BaseFetchTrackWithCache = fetchTrackWithCache;
fetchTrackWithCache = async function (track) {
  if ((track?.platform || state.currentPlatform) !== 'netflix') {
    return __v41BaseFetchTrackWithCache(track);
  }

  const key = getTrackCacheKey(track);
  if (state.trackCache.has(key)) return cloneData(state.trackCache.get(key));
  const result = await executeInPage(pageFetchNetflixTrackV41, [track]);
  if (result?.ok) state.trackCache.set(key, cloneData(result));
  return result;
};

const __v41BaseLoadSelectedTrack = loadSelectedTrack;
loadSelectedTrack = async function () {
  const sourceRequest = buildTrackRequest({ targetLanguage: ORIGINAL_LANGUAGE_SENTINEL });
  if (!sourceRequest) {
    setStatus('Chưa chọn phụ đề gốc.');
    return;
  }

  if ((sourceRequest?.platform || state.currentPlatform) !== 'netflix') {
    state.liveCaptureLive = false;
    stopNetflixLiveCaptureV41();
    return __v41BaseLoadSelectedTrack();
  }

  setActionsEnabled(false);
  setLoading(true);
  closeExportMenu();
  resetSearchUi();
  stopPlaybackWatcherV41();
  stopNetflixLiveCaptureV41();
  renderEmptyPreview('Đang tải subtitle Netflix...');
  setStatus(`Đang tải: ${sourceRequest.label}`);
  setDebug([`Đang yêu cầu subtitle Netflix ${sourceRequest.label}...`]);

  try {
    const sourceResult = await fetchTrackWithCache(sourceRequest);
    setDebug(sourceResult?.debug || []);

    if (sourceResult?.liveCaptureOnly || sourceRequest.fetchStrategy === 'liveCapture') {
      state.rawSourceCues = [];
      state.rawTranslatedCues = [];
      state.transcript = { cues: [] };
      updateSubtitleBadge();
      startNetflixLiveCaptureV41();
      setStatus('Netflix không lộ full track. Đã chuyển sang live capture subtitle đang hiển thị.');
      return;
    }

    if (!sourceResult?.ok || !Array.isArray(sourceResult.cues) || !sourceResult.cues.length) {
      state.transcript = null;
      state.rawSourceCues = null;
      state.rawTranslatedCues = null;
      renderEmptyPreview('Không tải được nội dung subtitle Netflix.');
      setSubtitleBadge('No subtitles found', 'is-missing');
      setStatus(sourceResult?.error || 'Không tải được phụ đề Netflix cho lựa chọn hiện tại.');
      return;
    }

    state.liveCaptureLive = false;
    state.rawSourceCues = sourceResult.cues;
    state.rawTranslatedCues = [];
    updateSubtitleBadge();
    renderFromRawCues();
  } catch (error) {
    console.error(error);
    state.transcript = null;
    state.rawSourceCues = null;
    state.rawTranslatedCues = null;
    renderEmptyPreview('Không tải được phụ đề Netflix.');
    setStatus(error?.message || 'Không tải được phụ đề Netflix.');
    setDebug([formatError(error)]);
    setSubtitleBadge('No subtitles found', 'is-missing');
  } finally {
    setLoading(false);
  }
};

function detectPlatformFromUrlV41(url) {
  const raw = String(url || '');
  if (/^https:\/\/(www|m|music)\.youtube\.com\/(watch|shorts)/.test(raw)) return 'youtube';
  if (/^https:\/\/(www\.)?netflix\.com\/watch\//.test(raw)) return 'netflix';
  return '';
}

function updateYoutubeLeadUiV41() {
  if (youtubeLeadValueElV41) {
    youtubeLeadValueElV41.textContent = `${Number(state.settings.youtubeLeadMs) || 0} ms`;
  }
}

pinBtnV41?.addEventListener('click', async () => {
  try {
    const tab = state.tab || (await getActiveTab());
    const response = await chrome.runtime.sendMessage({ type: 'OPEN_PINNED_WINDOW', tabId: tab?.id || null });
    if (!response?.ok) throw new Error(response?.error || 'Không mở được cửa sổ ghim.');
  } catch (error) {
    setStatus(error?.message || 'Không mở được cửa sổ ghim.');
  }
});

autoScrollLiveCheckboxElV41?.addEventListener('change', async (event) => {
  state.settings.autoScrollLive = Boolean(event.target.checked);
  await saveSettings();
});

youtubeLeadRangeElV41?.addEventListener('input', () => {
  state.settings.youtubeLeadMs = Number(youtubeLeadRangeElV41.value) || V41_DEFAULT_YT_LEAD_MS;
  updateYoutubeLeadUiV41();
  syncActiveCueFromPlaybackV41({ scroll: false });
});

youtubeLeadRangeElV41?.addEventListener('change', async () => {
  state.settings.youtubeLeadMs = Number(youtubeLeadRangeElV41.value) || V41_DEFAULT_YT_LEAD_MS;
  updateYoutubeLeadUiV41();
  await saveSettings();
});

transcriptPreviewEl?.addEventListener('click', async (event) => {
  const row = event.target?.closest?.('.transcript-line');
  if (!row) return;
  const index = Number(row.dataset.index);
  if (!Number.isInteger(index) || index < 0 || !state.transcript?.cues?.[index]) return;
  try {
    const cue = state.transcript.cues[index];
    await executeInPage(pageSeekToTimeV41, [cue.startMs]);
    state.playbackBaseMs = cue.startMs;
    state.playbackPerfMs = performance.now();
    state.playbackTimeMs = cue.startMs;
    state.playbackIsPlaying = true;
    state.activeCueIndex = index;
    syncActiveCueFromPlaybackV41({ scroll: true });
  } catch {
    // ignore seek click error
  }
});

window.addEventListener('beforeunload', () => {
  stopPlaybackWatcherV41();
  stopNetflixLiveCaptureV41();
});

function markTranscriptLinesClickableV41() {
  Array.from(transcriptPreviewEl?.querySelectorAll('.transcript-line') || []).forEach((line) => {
    line.classList.add('is-clickable');
    line.setAttribute('title', 'Click để tua video đến dòng này');
  });
}

function estimatePlaybackTimeMsV41() {
  let value = Number(state.playbackBaseMs) || 0;
  if (state.playbackIsPlaying) {
    value += (performance.now() - (state.playbackPerfMs || performance.now())) * (Number(state.playbackRate) || 1);
  }
  if (state.currentPlatform === 'youtube') {
    value += Number(state.settings.youtubeLeadMs) || 0;
  }
  return Math.max(0, value);
}

function findCueIndexByTimeV41(timeMs) {
  const cues = state.transcript?.cues || [];
  if (!cues.length) return -1;

  const active = state.activeCueIndex;
  const within = (cue, t) => t >= cue.startMs - 40 && t < cue.endMs + 80;

  if (active >= 0 && cues[active] && within(cues[active], timeMs)) {
    return active;
  }

  for (let step = 1; step <= 3; step += 1) {
    const forward = active + step;
    if (forward >= 0 && cues[forward] && within(cues[forward], timeMs)) return forward;
    const back = active - step;
    if (back >= 0 && cues[back] && within(cues[back], timeMs)) return back;
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
  if (cues[candidate] && Math.abs(cues[candidate].startMs - timeMs) <= 450) return candidate;
  const prev = candidate - 1;
  if (prev >= 0 && Math.abs(cues[prev].endMs - timeMs) <= 350) return prev;
  return -1;
}

function updatePlaybackUiV41() {
  if (playbackStatusChipElV41) playbackStatusChipElV41.textContent = state.liveCaptureLive ? 'Live capture' : (state.playbackIsPlaying ? 'Playing' : 'Paused');
  if (playbackTimeChipElV41) playbackTimeChipElV41.textContent = formatTimestamp(state.playbackTimeMs || 0, ',');
  if (activeCueChipElV41) activeCueChipElV41.textContent = `Cue ${state.activeCueIndex >= 0 ? state.activeCueIndex + 1 : '-'}`;
}

function applyLiveCueHighlightV41({ scroll = false } = {}) {
  const lines = Array.from(transcriptPreviewEl?.querySelectorAll('.transcript-line') || []);
  lines.forEach((line) => line.classList.remove('is-live-active'));
  if (state.activeCueIndex < 0) {
    updatePlaybackUiV41();
    return;
  }
  const target = transcriptPreviewEl?.querySelector(`.transcript-line[data-index="${state.activeCueIndex}"]`);
  if (target) {
    target.classList.add('is-live-active');
    if (scroll && state.settings.autoScrollLive !== false && state.lastScrolledCueIndex !== state.activeCueIndex && !state.searchQuery.trim()) {
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      state.lastScrolledCueIndex = state.activeCueIndex;
    }
  }
  updatePlaybackUiV41();
}

function syncActiveCueFromPlaybackV41({ scroll = false } = {}) {
  if (!state.transcript?.cues?.length || state.liveCaptureLive) {
    state.activeCueIndex = -1;
    applyLiveCueHighlightV41({ scroll: false });
    return;
  }
  if (Date.now() - (state.lastPlaybackSnapshotAtMs || 0) > V41_STALE_MS) {
    state.playbackIsPlaying = false;
  }
  state.playbackTimeMs = estimatePlaybackTimeMsV41();
  const nextIndex = findCueIndexByTimeV41(state.playbackTimeMs);
  if (nextIndex !== state.activeCueIndex) state.activeCueIndex = nextIndex;
  applyLiveCueHighlightV41({ scroll: scroll || state.playbackIsPlaying });
}

async function syncPlaybackSnapshotV41() {
  try {
    if (!state.transcript?.cues?.length || !state.tab?.id || state.liveCaptureLive) return;
    const snapshot = await executeInPage(pageGetPlaybackSnapshotV41, []);
    if (!snapshot?.ok) return;
    state.lastPlaybackSnapshotAtMs = Date.now();
    state.playbackBaseMs = Math.max(0, Number(snapshot.currentTimeMs) || 0);
    state.playbackTimeMs = state.playbackBaseMs;
    state.playbackPerfMs = performance.now();
    state.playbackRate = Math.max(0.1, Number(snapshot.playbackRate) || 1);
    state.playbackIsPlaying = Boolean(snapshot.isPlaying);
    if (snapshot.url && snapshot.url !== state.lastActiveUrl) {
      state.lastActiveUrl = snapshot.url;
    }
  } catch {
    // ignore sync errors
  }
}

function startPlaybackWatcherV41() {
  stopPlaybackWatcherV41();
  if (!state.transcript?.cues?.length || state.liveCaptureLive) return;
  state.playbackTimer = window.setInterval(syncPlaybackSnapshotV41, V41_POLL_MS);
  state.playbackRenderTimer = window.setInterval(() => syncActiveCueFromPlaybackV41({ scroll: true }), V41_RENDER_MS);
  syncPlaybackSnapshotV41();
}

function stopPlaybackWatcherV41() {
  if (state.playbackTimer) {
    clearInterval(state.playbackTimer);
    state.playbackTimer = null;
  }
  if (state.playbackRenderTimer) {
    clearInterval(state.playbackRenderTimer);
    state.playbackRenderTimer = null;
  }
  state.activeCueIndex = -1;
  updatePlaybackUiV41();
}

function finalizeLastLiveCueV41(timeMs) {
  const last = state.netflixLiveCaptureBuffer[state.netflixLiveCaptureBuffer.length - 1];
  if (last) last.endMs = Math.max(last.endMs || 0, Math.max(last.startMs + 160, timeMs));
}

function commitLiveCaptureBufferV41() {
  state.liveCaptureLive = true;
  state.rawSourceCues = state.netflixLiveCaptureBuffer.map((cue) => ({ ...cue }));
  state.rawTranslatedCues = [];
  const cleaned = cleanCues(state.rawSourceCues, state.settings);
  state.transcript = { cues: cleaned };
  setActionsEnabled(Boolean(cleaned.length));
  setLineCount(cleaned.length);
  renderTranscriptPreview();
}

function stopNetflixLiveCaptureV41() {
  if (state.netflixLiveCaptureTimer) {
    clearInterval(state.netflixLiveCaptureTimer);
    state.netflixLiveCaptureTimer = null;
  }
  state.liveCaptureLive = false;
  state.netflixLiveCaptureBuffer = [];
  state.netflixLiveCaptureLastText = '';
}

function startNetflixLiveCaptureV41() {
  stopNetflixLiveCaptureV41();
  state.liveCaptureLive = true;
  state.netflixLiveCaptureBuffer = [];
  state.netflixLiveCaptureLastText = '';
  setSubtitleBadge('Live capture', 'is-available');
  state.netflixLiveCaptureTimer = window.setInterval(async () => {
    try {
      const snapshot = await executeInPage(pageGetLiveCaptionSnapshotV41, []);
      if (!snapshot?.ok) return;
      state.playbackBaseMs = Math.max(0, Number(snapshot.currentTimeMs) || 0);
      state.playbackTimeMs = state.playbackBaseMs;
      state.playbackPerfMs = performance.now();
      state.playbackRate = Math.max(0.1, Number(snapshot.playbackRate) || 1);
      state.playbackIsPlaying = Boolean(snapshot.isPlaying);
      state.lastPlaybackSnapshotAtMs = Date.now();

      const timeMs = state.playbackBaseMs;
      const text = String(snapshot.text || '').trim();
      const last = state.netflixLiveCaptureBuffer[state.netflixLiveCaptureBuffer.length - 1];

      if (!text) {
        if (state.netflixLiveCaptureLastText) {
          finalizeLastLiveCueV41(timeMs);
          state.netflixLiveCaptureLastText = '';
          commitLiveCaptureBufferV41();
        }
        return;
      }

      if (!last || state.netflixLiveCaptureLastText !== text) {
        finalizeLastLiveCueV41(timeMs);
        state.netflixLiveCaptureBuffer.push({ startMs: timeMs, endMs: timeMs + 900, text });
        state.netflixLiveCaptureLastText = text;
        commitLiveCaptureBufferV41();
        setStatus('Đang live capture subtitle Netflix đang hiển thị.');
        return;
      }

      last.endMs = Math.max(last.endMs, timeMs + 120);
      commitLiveCaptureBufferV41();
    } catch {
      // ignore live capture errors
    }
  }, V41_NETFLIX_CAPTURE_MS);
}

async function persistPinnedStateV41() {
  const cues = state.transcript?.cues || [];
  const activeCue = state.activeCueIndex >= 0 ? cues[state.activeCueIndex] : null;
  let outputText = '';
  let sourceText = '';
  if (activeCue?.text) {
    const lines = String(activeCue.text).split('\n').filter(Boolean);
    if (state.settings.outputMode === 'translated' && lines.length > 1) {
      outputText = lines.slice(1).join('\n');
      sourceText = lines[0] || '';
    } else if (state.settings.outputMode === 'bilingual' && lines.length > 1) {
      sourceText = lines[0] || '';
      outputText = lines.slice(1).join('\n');
    } else {
      sourceText = activeCue.text;
      outputText = state.selectedTargetLanguage === ORIGINAL_LANGUAGE_SENTINEL ? '' : activeCue.text;
    }
  }
  await chrome.storage.local.set({
    [PINNED_STATE_KEY_V41]: {
      updatedAt: Date.now(),
      title: state.videoTitle || '',
      platform: state.currentPlatform || detectPlatformFromUrlV41(state.tab?.url),
      sourceLabel: state.sourceTracks[state.selectedSourceIndex]?.name || 'Original',
      targetLabel: state.selectedTargetLanguage === ORIGINAL_LANGUAGE_SENTINEL ? 'Output' : state.selectedTargetLanguage,
      sourceText,
      outputText,
      activeIndex: state.activeCueIndex,
      playbackTimeMs: state.playbackTimeMs || 0,
      isPlaying: Boolean(state.playbackIsPlaying),
      liveCapture: Boolean(state.liveCaptureLive),
      outputMode: state.settings.outputMode,
      selectedTargetLanguage: state.selectedTargetLanguage,
      track: state.sourceTracks[state.selectedSourceIndex] || null,
      cues,
    },
  });
}

function pageGetPlaybackSnapshotV41() {
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

function pageSeekToTimeV41(startMs) {
  try {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy video để seek.' };
    video.currentTime = Math.max(0, Number(startMs) || 0) / 1000;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'Không thể tua video.' };
  }
}

function pageGetNetflixMetadataV41() {
  const debug = [];
  const push = (line) => debug.push(String(line));
  try {
    const video = document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy video Netflix đang phát.', debug };
    const title = document.title.replace(/\s*-\s*Netflix$/i, '').trim() || 'Netflix';
    const match = location.pathname.match(/\/watch\/(\d+)/);
    const videoId = match ? match[1] : '';
    const textTracks = Array.from(video.textTracks || []).filter((track) => ['subtitles', 'captions'].includes(String(track.kind || '').toLowerCase()));
    push(`textTracks=${textTracks.length}`);

    const sourceTracks = textTracks.map((track, index) => {
      const languageCode = String(track.language || track.srclang || `track-${index + 1}`);
      const label = String(track.label || languageCode || `track-${index + 1}`);
      return {
        index,
        platform: 'netflix',
        fetchStrategy: 'textTrack',
        textTrackIndex: index,
        label: `${label} [${languageCode}]`,
        languageCode,
        name: label,
        isTranslatable: false,
        isTranslation: false,
      };
    });

    sourceTracks.push({
      index: sourceTracks.length,
      platform: 'netflix',
      fetchStrategy: 'liveCapture',
      textTrackIndex: -1,
      label: textTracks.length ? 'Live capture (fallback)' : 'Live capture',
      languageCode: textTracks[0]?.language || 'live',
      name: 'Live capture',
      isTranslatable: false,
      isTranslation: false,
    });

    const activeIndex = textTracks.findIndex((track) => String(track.mode || '').toLowerCase() === 'showing');
    return {
      ok: true,
      videoTitle: title,
      channelName: 'Netflix',
      videoId,
      sourceTracks,
      translationLanguages: [],
      defaultSourceIndex: activeIndex >= 0 ? activeIndex : 0,
      originalTrackIndex: activeIndex >= 0 ? activeIndex : 0,
      originalLanguageCode: textTracks[activeIndex >= 0 ? activeIndex : 0]?.language || '',
      audioLanguageCode: '',
      defaultTrackReason: activeIndex >= 0 ? 'track subtitle đang bật' : (textTracks.length ? 'track subtitle đầu tiên' : 'live capture fallback'),
      debug,
    };
  } catch (error) {
    push(error?.message || 'Unknown error');
    return { ok: false, error: error?.message || 'Không đọc được metadata Netflix.', debug };
  }
}

async function pageFetchNetflixTrackV41(track) {
  const debug = [];
  const push = (line) => debug.push(String(line));

  function normalizeText(value) {
    return String(value || '').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  }

  function parseClock(value) {
    const raw = String(value || '').trim().replace(',', '.');
    const match = raw.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!match) return 0;
    return Number(match[1] || 0) * 3600000 + Number(match[2] || 0) * 60000 + Number(match[3] || 0) * 1000 + Number((match[4] || '0').padEnd(3, '0'));
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
        const startMs = parseClock(parts[0].split(' ')[0]);
        const endMs = parseClock(parts[1].split(' ')[0]);
        const body = normalizeText(lines.slice(lines.indexOf(timing) + 1).join('\n'));
        return body ? { startMs, endMs: endMs > startMs ? endMs : startMs + 1800, text: body } : null;
      })
      .filter(Boolean);
  }

  try {
    if (track?.fetchStrategy === 'liveCapture') {
      return { ok: false, liveCaptureOnly: true, error: 'Live capture mode.', debug };
    }

    const video = document.querySelector('video');
    if (!video) return { ok: false, error: 'Không tìm thấy video Netflix.', debug };
    const textTracks = Array.from(video.textTracks || []).filter((candidate) => ['subtitles', 'captions'].includes(String(candidate.kind || '').toLowerCase()));
    const selectedTrack = textTracks[Number(track.textTrackIndex)] || textTracks[0] || null;
    push(`textTracks=${textTracks.length}`);
    if (!selectedTrack) return { ok: false, liveCaptureOnly: true, error: 'Netflix chưa expose textTrack nào có thể đọc.', debug };

    const restore = textTracks.map((candidate) => String(candidate.mode || 'disabled'));
    try {
      textTracks.forEach((candidate) => {
        candidate.mode = candidate === selectedTrack ? 'hidden' : 'disabled';
      });
    } catch (error) {
      push(`set mode lỗi: ${error.message}`);
    }

    let cues = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 220));
      cues = Array.from(selectedTrack.cues || [])
        .map((cue) => ({
          startMs: Math.round(Number(cue.startTime || 0) * 1000),
          endMs: Math.round(Number(cue.endTime || 0) * 1000),
          text: normalizeText(cue.text || cue.id || cue.value || ''),
        }))
        .filter((cue) => cue.text);
      if (cues.length) break;
    }

    textTracks.forEach((candidate, index) => {
      try {
        candidate.mode = restore[index] || 'disabled';
      } catch {
        // ignore restore errors
      }
    });

    if (cues.length) {
      push(`Đọc cues trực tiếp=${cues.length}`);
      return { ok: true, cues, source: 'netflix-texttrack', debug };
    }

    const htmlTracks = Array.from(document.querySelectorAll('track')).filter((node) => String(node.kind || '').toLowerCase() !== 'metadata');
    const htmlTrack = htmlTracks[Number(track.textTrackIndex)] || htmlTracks[0] || null;
    if (htmlTrack?.src) {
      push(`Thử fetch track src: ${htmlTrack.src}`);
      try {
        const response = await fetch(htmlTrack.src, { credentials: 'include', cache: 'no-store' });
        const text = await response.text();
        const parsed = parseVtt(text);
        push(`fetch status=${response.status} parsed=${parsed.length}`);
        if (response.ok && parsed.length) return { ok: true, cues: parsed, source: 'netflix-track-src', debug };
      } catch (error) {
        push(`fetch track src lỗi: ${error.message}`);
      }
    }

    return { ok: false, liveCaptureOnly: true, error: 'Netflix không lộ full track cho title này, chuyển sang live capture.', debug };
  } catch (error) {
    push(error?.message || 'Unknown error');
    return { ok: false, liveCaptureOnly: true, error: error?.message || 'Không đọc được subtitle Netflix.', debug };
  }
}

function pageGetLiveCaptionSnapshotV41() {
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
    url: location.href,
  };
}
