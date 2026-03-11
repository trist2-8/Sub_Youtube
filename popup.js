const STORAGE_KEY = 'ytSubtitleGrabberSettingsV5';

const state = {
  tab: null,
  videoTitle: '',
  sourceTracks: [],
  translationLanguages: [],
  selectedSourceIndex: -1,
  selectedTargetLanguage: '__original__',
  rawSourceCues: null,
  rawTranslatedCues: null,
  transcript: null,
  debugLines: [],
  settings: {
    outputMode: 'original',
    dedupeRepeats: true,
    mergeShortCues: true,
    preferredTargetLanguage: '__original__',
  },
};

const statusEl = document.getElementById('status');
const sourceTrackSelectEl = document.getElementById('sourceTrackSelect');
const targetLanguageSelectEl = document.getElementById('targetLanguageSelect');
const outputModeSelectEl = document.getElementById('outputModeSelect');
const dedupeCheckboxEl = document.getElementById('dedupeCheckbox');
const mergeCheckboxEl = document.getElementById('mergeCheckbox');
const previewEl = document.getElementById('preview');
const debugEl = document.getElementById('debug');
const refreshBtn = document.getElementById('refreshBtn');
const copyBtn = document.getElementById('copyBtn');
const txtBtn = document.getElementById('txtBtn');
const srtBtn = document.getElementById('srtBtn');
const vttBtn = document.getElementById('vttBtn');

refreshBtn.addEventListener('click', loadTracks);
sourceTrackSelectEl.addEventListener('change', async (event) => {
  state.selectedSourceIndex = Number(event.target.value);
  state.rawSourceCues = null;
  state.rawTranslatedCues = null;
  rebuildTargetLanguageOptions();
  await loadSelectedTrack();
});

targetLanguageSelectEl.addEventListener('change', async (event) => {
  state.selectedTargetLanguage = event.target.value;
  state.settings.preferredTargetLanguage = state.selectedTargetLanguage;
  await saveSettings();
  state.rawTranslatedCues = null;
  await loadSelectedTrack();
});

outputModeSelectEl.addEventListener('change', async (event) => {
  state.settings.outputMode = event.target.value;
  await saveSettings();
  await refreshRenderingAfterSettingChange();
});

dedupeCheckboxEl.addEventListener('change', async (event) => {
  state.settings.dedupeRepeats = Boolean(event.target.checked);
  await saveSettings();
  await refreshRenderingAfterSettingChange();
});

mergeCheckboxEl.addEventListener('change', async (event) => {
  state.settings.mergeShortCues = Boolean(event.target.checked);
  await saveSettings();
  await refreshRenderingAfterSettingChange();
});

copyBtn.addEventListener('click', copyTranscript);
txtBtn.addEventListener('click', () => downloadTranscript('txt'));
srtBtn.addEventListener('click', () => downloadTranscript('srt'));
vttBtn.addEventListener('click', () => downloadTranscript('vtt'));

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error(error);
    setStatus(error.message || 'Không thể tải phụ đề.');
    setDebug([formatError(error)]);
  });
});

async function init() {
  await loadSettings();
  applySettingsToUi();
  await loadTracks();
}

function setStatus(message) {
  statusEl.textContent = message;
}

function setDebug(lines) {
  state.debugLines = Array.isArray(lines) && lines.length ? lines : ['Chưa có log.'];
  debugEl.textContent = state.debugLines.join('\n');
}

function appendDebug(line) {
  const lines = Array.isArray(state.debugLines) ? [...state.debugLines] : [];
  lines.push(line);
  setDebug(lines);
}

function setActionsEnabled(enabled) {
  copyBtn.disabled = !enabled;
  txtBtn.disabled = !enabled;
  srtBtn.disabled = !enabled;
  vttBtn.disabled = !enabled;
}

function setLoading(isLoading) {
  refreshBtn.disabled = isLoading;
  sourceTrackSelectEl.disabled = isLoading || !state.sourceTracks.length;
  targetLanguageSelectEl.disabled = isLoading || !state.sourceTracks.length;
  outputModeSelectEl.disabled = isLoading;
  dedupeCheckboxEl.disabled = isLoading;
  mergeCheckboxEl.disabled = isLoading;
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const saved = stored?.[STORAGE_KEY];
    if (saved && typeof saved === 'object') {
      state.settings = {
        ...state.settings,
        ...saved,
      };
    }
  } catch (error) {
    console.warn('Không đọc được settings từ storage:', error);
  }
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

function applySettingsToUi() {
  outputModeSelectEl.value = state.settings.outputMode || 'original';
  dedupeCheckboxEl.checked = Boolean(state.settings.dedupeRepeats);
  mergeCheckboxEl.checked = Boolean(state.settings.mergeShortCues);
}

async function refreshRenderingAfterSettingChange() {
  if (!state.rawSourceCues) return;

  const needsTranslated =
    state.selectedTargetLanguage !== '__original__' &&
    (state.settings.outputMode === 'translated' || state.settings.outputMode === 'bilingual');

  if (needsTranslated && !state.rawTranslatedCues) {
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

async function loadTracks() {
  setLoading(true);
  setActionsEnabled(false);
  previewEl.value = '';
  state.transcript = null;
  state.rawSourceCues = null;
  state.rawTranslatedCues = null;
  state.selectedSourceIndex = -1;
  state.selectedTargetLanguage = state.settings.preferredTargetLanguage || '__original__';
  setDebug([]);

  const tab = await getActiveTab();
  state.tab = tab;

  if (!tab || !tab.id || !tab.url) {
    throw new Error('Không tìm thấy tab đang mở.');
  }

  if (!isSupportedYoutubeUrl(tab.url)) {
    sourceTrackSelectEl.innerHTML = '<option>Không phải trang video YouTube</option>';
    targetLanguageSelectEl.innerHTML = '<option>Không phải trang video YouTube</option>';
    sourceTrackSelectEl.disabled = true;
    targetLanguageSelectEl.disabled = true;
    setStatus('Hãy mở video YouTube dạng /watch hoặc /shorts.');
    setLoading(false);
    return;
  }

  setStatus('Đang đọc danh sách phụ đề từ trang YouTube...');

  const result = await executeInPage(pageGetMetadata);
  setDebug(result?.debug || []);

  if (!result?.ok) {
    sourceTrackSelectEl.innerHTML = `<option>${escapeHtml(result?.error || 'Không đọc được dữ liệu phụ đề')}</option>`;
    targetLanguageSelectEl.innerHTML = '<option>Không có dữ liệu</option>';
    sourceTrackSelectEl.disabled = true;
    targetLanguageSelectEl.disabled = true;
    setStatus(result?.error || 'Không đọc được dữ liệu phụ đề.');
    setLoading(false);
    return;
  }

  state.videoTitle = result.videoTitle || sanitizeFilename(tab.title || 'youtube-video');
  state.sourceTracks = Array.isArray(result.sourceTracks) ? result.sourceTracks : [];
  state.translationLanguages = Array.isArray(result.translationLanguages) ? result.translationLanguages : [];

  if (!state.sourceTracks.length) {
    sourceTrackSelectEl.innerHTML = '<option>Video này không có phụ đề khả dụng</option>';
    targetLanguageSelectEl.innerHTML = '<option>Không có ngôn ngữ dịch</option>';
    sourceTrackSelectEl.disabled = true;
    targetLanguageSelectEl.disabled = true;
    setStatus('Video này hiện không có phụ đề để trích xuất.');
    setLoading(false);
    return;
  }

  renderSourceTrackOptions();

  const defaultIndex =
    Number.isInteger(result.defaultSourceIndex) && result.defaultSourceIndex >= 0
      ? result.defaultSourceIndex
      : 0;

  state.selectedSourceIndex = Math.min(defaultIndex, state.sourceTracks.length - 1);
  sourceTrackSelectEl.value = String(state.selectedSourceIndex);

  rebuildTargetLanguageOptions();

  const preferredTargetExists = Array.from(targetLanguageSelectEl.options).some(
    (option) => option.value === state.selectedTargetLanguage
  );
  state.selectedTargetLanguage = preferredTargetExists ? state.selectedTargetLanguage : '__original__';
  targetLanguageSelectEl.value = state.selectedTargetLanguage;

  setStatus(`Tìm thấy ${state.sourceTracks.length} phụ đề gốc. Đang tải nội dung...`);
  setLoading(false);
  await loadSelectedTrack();
}

function renderSourceTrackOptions() {
  sourceTrackSelectEl.innerHTML = '';
  for (const [index, track] of state.sourceTracks.entries()) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = track.label;
    sourceTrackSelectEl.appendChild(option);
  }
  sourceTrackSelectEl.disabled = false;
}

function rebuildTargetLanguageOptions() {
  targetLanguageSelectEl.innerHTML = '';

  const originalOption = document.createElement('option');
  originalOption.value = '__original__';
  originalOption.textContent = 'Giữ nguyên phụ đề gốc đã chọn';
  targetLanguageSelectEl.appendChild(originalOption);

  const sourceTrack = state.sourceTracks[state.selectedSourceIndex];
  if (!sourceTrack?.isTranslatable) {
    targetLanguageSelectEl.disabled = false;
    return;
  }

  for (const lang of state.translationLanguages) {
    if (!lang?.languageCode) continue;
    if (lang.languageCode === sourceTrack.languageCode) continue;

    const option = document.createElement('option');
    option.value = lang.languageCode;
    option.textContent = `${lang.name} [${lang.languageCode}]`;
    targetLanguageSelectEl.appendChild(option);
  }

  targetLanguageSelectEl.disabled = false;
}

function buildTrackRequest({ targetLanguage = '__original__' } = {}) {
  const sourceTrack = state.sourceTracks[state.selectedSourceIndex];
  if (!sourceTrack) return null;

  if (targetLanguage === '__original__') {
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

async function loadSelectedTrack() {
  const sourceRequest = buildTrackRequest({ targetLanguage: '__original__' });
  if (!sourceRequest) {
    setStatus('Chưa chọn phụ đề gốc.');
    return;
  }

  setActionsEnabled(false);
  setStatus(`Đang tải: ${sourceRequest.label}`);
  setDebug([`Đang yêu cầu phụ đề gốc ${sourceRequest.label}...`]);

  try {
    const sourceResult = await executeInPage(pageFetchTrack, [sourceRequest]);
    setDebug(sourceResult?.debug || []);

    if (!sourceResult?.ok || !Array.isArray(sourceResult.cues) || !sourceResult.cues.length) {
      previewEl.value = '';
      state.transcript = null;
      state.rawSourceCues = null;
      state.rawTranslatedCues = null;
      setStatus(sourceResult?.error || 'Không tải được phụ đề gốc cho lựa chọn hiện tại.');
      return;
    }

    state.rawSourceCues = sourceResult.cues;
    state.rawTranslatedCues = null;

    const needsTranslated =
      state.selectedTargetLanguage !== '__original__' &&
      (state.settings.outputMode === 'translated' || state.settings.outputMode === 'bilingual');

    if (needsTranslated) {
      const translationRequest = buildTrackRequest({ targetLanguage: state.selectedTargetLanguage });
      appendDebug(`Đang yêu cầu bản dịch: ${translationRequest.effectiveLabel}`);
      const translationResult = await executeInPage(pageFetchTrack, [translationRequest]);
      setDebug([...(state.debugLines || []), '--- Translation fetch ---', ...(translationResult?.debug || [])]);

      if (translationResult?.ok && Array.isArray(translationResult.cues) && translationResult.cues.length) {
        state.rawTranslatedCues = translationResult.cues;
      } else {
        state.rawTranslatedCues = [];
      }
    }

    renderFromRawCues();
  } catch (error) {
    console.error(error);
    previewEl.value = '';
    state.transcript = null;
    state.rawSourceCues = null;
    state.rawTranslatedCues = null;
    setStatus(error.message || 'Không tải được phụ đề.');
    setDebug([formatError(error)]);
  }
}

function renderFromRawCues() {
  if (!Array.isArray(state.rawSourceCues) || !state.rawSourceCues.length) {
    previewEl.value = '';
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
  const translationSelected = state.selectedTargetLanguage !== '__original__';
  let finalCues = [];
  let modeLabel = 'phụ đề gốc';

  if (outputMode === 'translated' && translationSelected) {
    if (translatedCleaned && translatedCleaned.length) {
      finalCues = translatedCleaned;
      modeLabel = 'bản dịch';
    } else {
      previewEl.value = '';
      state.transcript = null;
      setActionsEnabled(false);
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
    previewEl.value = '';
    state.transcript = null;
    setActionsEnabled(false);
    setStatus('Không có phụ đề nào có thể hiển thị sau khi làm sạch.');
    return;
  }

  const txt = buildTxt(finalCues);
  const srt = buildSrt(finalCues);
  const vtt = buildVtt(finalCues);

  state.transcript = {
    track: buildTrackRequest({ targetLanguage: state.selectedTargetLanguage }) || sourceTrack,
    cues: finalCues,
    txt,
    srt,
    vtt,
    modeLabel,
  };

  previewEl.value = txt;
  setActionsEnabled(true);

  if (!(outputMode === 'bilingual' && translationSelected && (!translatedCleaned || !translatedCleaned.length))) {
    setStatus(`Đã dựng ${finalCues.length} câu ở chế độ ${modeLabel}.`);
  }
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

function dedupeConsecutiveCues(cues) {
  const merged = [];
  for (const cue of cues) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.text === cue.text &&
      Math.abs(prev.endMs - cue.startMs) <= 800
    ) {
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

function buildTxt(cues) {
  return cues.map((cue) => cue.text).join('\n');
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

function formatTimestamp(totalMs, separator) {
  const ms = Math.max(0, Math.round(Number(totalMs) || 0));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':') + `${separator}${String(millis).padStart(3, '0')}`;
}

async function copyTranscript() {
  if (!state.transcript?.txt) {
    setStatus('Chưa có nội dung để sao chép.');
    return;
  }

  await navigator.clipboard.writeText(state.transcript.txt);
  setStatus(`Đã sao chép nội dung ở chế độ ${state.transcript.modeLabel || 'hiện tại'}.`);
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

  const baseName = sanitizeFilename(
    `${state.videoTitle} - ${suffix} - ${state.settings.outputMode}`
  );

  let content = '';
  let ext = type;

  if (type === 'txt') content = state.transcript.txt;
  if (type === 'srt') content = state.transcript.srt;
  if (type === 'vtt') content = state.transcript.vtt;

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url,
      filename: `${baseName}.${ext}`,
      saveAs: true,
    });
    setStatus(`Đã tạo file ${ext.toUpperCase()} ở chế độ ${state.transcript.modeLabel || 'hiện tại'}.`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
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

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatError(error) {
  if (!error) return 'Lỗi không xác định.';
  if (typeof error === 'string') return error;
  return `${error.name || 'Error'}: ${error.message || 'Không có message'}`;
}

function pageGetMetadata() {
  const debug = [];

  function getPlayerResponse() {
    try {
      const player = document.getElementById('movie_player');
      const response = player?.getPlayerResponse?.();
      if (response && typeof response === 'object') {
        debug.push('Nguồn playerResponse: movie_player.getPlayerResponse()');
        return response;
      }
    } catch (error) {
      debug.push(`movie_player.getPlayerResponse lỗi: ${error.message}`);
    }

    try {
      if (window.ytInitialPlayerResponse) {
        debug.push('Nguồn playerResponse: window.ytInitialPlayerResponse');
        return window.ytInitialPlayerResponse;
      }
    } catch (error) {
      debug.push(`window.ytInitialPlayerResponse lỗi: ${error.message}`);
    }

    try {
      const raw = window.ytplayer?.config?.args?.player_response;
      if (raw) {
        debug.push('Nguồn playerResponse: ytplayer.config.args.player_response');
        return JSON.parse(raw);
      }
    } catch (error) {
      debug.push(`ytplayer.config.args.player_response lỗi: ${error.message}`);
    }

    try {
      const raw =
        window.ytcfg?.data_?.PLAYER_VARS?.player_response ||
        window.ytcfg?.get?.('PLAYER_VARS')?.player_response;
      if (raw) {
        debug.push('Nguồn playerResponse: ytcfg PLAYER_VARS');
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      }
    } catch (error) {
      debug.push(`ytcfg PLAYER_VARS lỗi: ${error.message}`);
    }

    return tryParsePlayerResponseFromScripts();
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
              debug.push('Nguồn playerResponse: parse từ script ytplayer.config');
              return typeof raw === 'string' ? JSON.parse(raw) : raw;
            }
          } else {
            debug.push(`Nguồn playerResponse: parse từ script marker ${marker}`);
            return parsed;
          }
        } catch (error) {
          debug.push(`Parse script marker thất bại (${marker}): ${error.message}`);
        }
      }
    }

    return null;
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

  function getTextFromRuns(node) {
    if (!node) return '';
    if (typeof node.simpleText === 'string') return node.simpleText;
    if (Array.isArray(node.runs)) return node.runs.map((item) => item.text || '').join('');
    return '';
  }

  function normalizeBaseUrl(url) {
    try {
      return new URL(String(url || '').replace(/\\u0026/g, '&'), location.href).toString();
    } catch (error) {
      return '';
    }
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
        debug.push(`current caption track hint=${JSON.stringify(hint)}`);
        return hint;
      }
    } catch (error) {
      debug.push(`getOption(captions, track) lỗi: ${error.message}`);
    }
    return null;
  }

  function computeDefaultSourceIndex(sourceTracks, renderer) {
    if (!Array.isArray(sourceTracks) || !sourceTracks.length) return -1;

    const currentTrack = getCurrentCaptionTrackHint();

    if (currentTrack) {
      const byVssId = sourceTracks.findIndex((track) => {
        return track.vssId && currentTrack.vssId && track.vssId === currentTrack.vssId;
      });
      if (byVssId >= 0) {
        debug.push(`Default theo currentTrack.vssId -> ${byVssId}`);
        return byVssId;
      }

      const byLanguage = sourceTracks.findIndex((track) => {
        return (
          track.languageCode === currentTrack.languageCode &&
          (!currentTrack.kind || track.kind === currentTrack.kind || track.isAuto === (currentTrack.kind === 'asr'))
        );
      });
      if (byLanguage >= 0) {
        debug.push(`Default theo currentTrack.languageCode -> ${byLanguage}`);
        return byLanguage;
      }
    }

    const audioTracks = Array.isArray(renderer?.audioTracks) ? renderer.audioTracks : [];
    for (const audioTrack of audioTracks) {
      const idx = Number(audioTrack?.defaultCaptionTrackIndex);
      if (Number.isInteger(idx) && idx >= 0 && idx < sourceTracks.length) {
        debug.push(`Default theo audioTracks.defaultCaptionTrackIndex -> ${idx}`);
        return idx;
      }
    }

    const firstManual = sourceTracks.findIndex((track) => !track.isAuto);
    if (firstManual >= 0) {
      debug.push(`Default theo first manual track -> ${firstManual}`);
      return firstManual;
    }

    debug.push('Default fallback -> 0');
    return 0;
  }

  const playerResponse = getPlayerResponse();

  if (!playerResponse) {
    return {
      ok: false,
      error: 'Không đọc được player response từ trang YouTube.',
      debug,
    };
  }

  const renderer = playerResponse?.captions?.playerCaptionsTracklistRenderer;
  const captionTracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
  const translationLanguages = Array.isArray(renderer?.translationLanguages)
    ? renderer.translationLanguages
    : [];

  debug.push(`captionTracks=${captionTracks.length}`);
  debug.push(`translationLanguages=${translationLanguages.length}`);

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

  const defaultSourceIndex = computeDefaultSourceIndex(sourceTracks, renderer);
  debug.push(`defaultSourceIndex=${defaultSourceIndex}`);

  return {
    ok: true,
    videoTitle: playerResponse?.videoDetails?.title || document.title.replace(/ - YouTube$/, ''),
    sourceTracks,
    translationLanguages: translationLangs,
    defaultSourceIndex,
    debug,
  };
}

async function pageFetchTrack(track) {
  const debug = [];
  const push = (line) => debug.push(line);

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
      if (!durationMs && nextEvent?.tStartMs != null) {
        endMs = Number(nextEvent.tStartMs);
      }
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
      const lines = block
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean);

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
    } catch (error) {
      return '';
    }
  }

  function safeUrl(url) {
    try {
      return new URL(String(url || '').replace(/\\u0026/g, '&'), location.href);
    } catch (error) {
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
    } catch (error) {
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
      return (
        (!item.vssId || !vssId || item.vssId === vssId) &&
        lang === (item.sourceLanguageCode || item.languageCode) &&
        tlang === item.targetLanguageCode
      );
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