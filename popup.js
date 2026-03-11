const state = {
  tab: null,
  videoTitle: '',
  sourceTracks: [],
  translationLanguages: [],
  selectedSourceIndex: -1,
  selectedTargetLanguage: '__original__',
  transcript: null,
  debugLines: [],
};

const statusEl = document.getElementById('status');
const sourceTrackSelectEl = document.getElementById('sourceTrackSelect');
const targetLanguageSelectEl = document.getElementById('targetLanguageSelect');
const previewEl = document.getElementById('preview');
const debugEl = document.getElementById('debug');
const refreshBtn = document.getElementById('refreshBtn');
const copyBtn = document.getElementById('copyBtn');
const txtBtn = document.getElementById('txtBtn');
const srtBtn = document.getElementById('srtBtn');
const vttBtn = document.getElementById('vttBtn');
const panelBtn = document.getElementById('panelBtn');

refreshBtn.addEventListener('click', loadTracks);
sourceTrackSelectEl.addEventListener('change', async (event) => {
  state.selectedSourceIndex = Number(event.target.value);
  rebuildTargetLanguageOptions();
  await loadSelectedTrack();
});
targetLanguageSelectEl.addEventListener('change', async (event) => {
  state.selectedTargetLanguage = event.target.value;
  await loadSelectedTrack();
});
copyBtn.addEventListener('click', copyTranscript);
txtBtn.addEventListener('click', () => downloadTranscript('txt'));
srtBtn.addEventListener('click', () => downloadTranscript('srt'));
vttBtn.addEventListener('click', () => downloadTranscript('vtt'));
panelBtn.addEventListener('click', extractFromPanelOnly);

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error(error);
    setStatus(error.message || 'Không thể khởi tạo extension.');
    setDebug([formatError(error)]);
  });
});

async function init() {
  await pingBackground();
  await loadTracks();
}

function setStatus(message) {
  statusEl.textContent = message;
}

function setDebug(lines) {
  state.debugLines = Array.isArray(lines) && lines.length ? lines : ['Chưa có log.'];
  debugEl.textContent = state.debugLines.join('\n');
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
  panelBtn.disabled = isLoading;
}

async function pingBackground() {
  const response = await chrome.runtime.sendMessage({ type: 'PING' });
  if (!response?.ok) {
    throw new Error('Background service worker không phản hồi.');
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function isSupportedYoutubeUrl(url) {
  return /^https:\/\/(www|m|music)\.youtube\.com\/(watch|shorts)/.test(url || '');
}

async function ensureContentScriptInjected(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (ping?.ok) return;
  } catch (error) {
    // tiếp tục inject
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
}

async function sendToTab(message) {
  const tab = state.tab || (await getActiveTab());
  state.tab = tab;

  if (!tab?.id) {
    throw new Error('Không tìm thấy tab đang mở.');
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    const msg = String(error?.message || '');
    if (
      msg.includes('Could not establish connection') ||
      msg.includes('Receiving end does not exist')
    ) {
      await ensureContentScriptInjected(tab.id);
      return chrome.tabs.sendMessage(tab.id, message);
    }
    throw error;
  }
}

async function loadTracks() {
  setLoading(true);
  setActionsEnabled(false);
  previewEl.value = '';
  state.transcript = null;
  state.selectedSourceIndex = -1;
  state.selectedTargetLanguage = '__original__';
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

  const result = await sendToTab({ type: 'GET_TRACKS' });
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
  state.translationLanguages = Array.isArray(result.translationLanguages)
    ? result.translationLanguages
    : [];

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
  state.selectedTargetLanguage = '__original__';
  targetLanguageSelectEl.value = '__original__';

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

function buildEffectiveTrack() {
  const sourceTrack = state.sourceTracks[state.selectedSourceIndex];
  if (!sourceTrack) return null;

  if (state.selectedTargetLanguage === '__original__') {
    return {
      ...sourceTrack,
      isTranslation: false,
      targetLanguageCode: sourceTrack.languageCode,
      effectiveLabel: sourceTrack.label,
    };
  }

  const target = state.translationLanguages.find(
    (item) => item.languageCode === state.selectedTargetLanguage
  );

  return {
    ...sourceTrack,
    isTranslation: true,
    targetLanguageCode: state.selectedTargetLanguage,
    targetLanguageName: target?.name || state.selectedTargetLanguage,
    effectiveLabel: `${target?.name || state.selectedTargetLanguage} [${state.selectedTargetLanguage}] ← ${sourceTrack.name} [${sourceTrack.languageCode}]`,
  };
}

async function loadSelectedTrack() {
  const effectiveTrack = buildEffectiveTrack();
  if (!effectiveTrack) {
    setStatus('Chưa chọn phụ đề gốc.');
    return;
  }

  setActionsEnabled(false);
  setStatus(`Đang tải: ${effectiveTrack.effectiveLabel || effectiveTrack.label}`);
  setDebug([`Đang yêu cầu track ${effectiveTrack.effectiveLabel || effectiveTrack.label}...`]);

  try {
    const result = await sendToTab({ type: 'FETCH_TRACK', track: effectiveTrack });
    setDebug(result?.debug || []);

    if (!result?.ok) {
      previewEl.value = '';
      state.transcript = null;

      if (effectiveTrack.isTranslation) {
        setStatus(
          'Bản dịch tự động của YouTube không khả dụng cho video này. Transcript panel chỉ đọc phụ đề gốc, không dịch.'
        );
      } else {
        setStatus(result?.error || 'Không tải được phụ đề gốc cho lựa chọn hiện tại.');
      }
      return;
    }

    applyTranscriptResult(effectiveTrack, result);
  } catch (error) {
    console.error(error);
    previewEl.value = '';
    state.transcript = null;
    setStatus(error.message || 'Không tải được phụ đề.');
    setDebug([formatError(error)]);
  }
}

async function extractFromPanelOnly() {
  const sourceTrack = state.sourceTracks[state.selectedSourceIndex] || null;

  if (state.selectedTargetLanguage !== '__original__') {
    setStatus('Transcript panel chỉ dùng để đọc phụ đề gốc, không dùng để dịch.');
    return;
  }

  setStatus('Đang thử đọc transcript gốc từ panel của YouTube...');
  setActionsEnabled(false);
  previewEl.value = '';

  try {
    const result = await sendToTab({ type: 'EXTRACT_PANEL_ONLY', track: sourceTrack });
    setDebug(result?.debug || []);

    if (!result?.ok) {
      setStatus(result?.error || 'Không đọc được transcript panel.');
      return;
    }

    applyTranscriptResult(
      sourceTrack || { languageCode: 'panel', label: 'Transcript panel' },
      result
    );
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Không đọc được transcript panel.');
    setDebug([formatError(error)]);
  }
}

function applyTranscriptResult(track, result) {
  const cues = Array.isArray(result?.cues) ? result.cues : [];

  if (!cues.length) {
    previewEl.value = '';
    state.transcript = {
      track,
      cues: [],
      txt: '',
      srt: '',
      vtt: 'WEBVTT\n\n',
    };
    setStatus('Track tồn tại nhưng không có câu phụ đề nào có thể đọc được.');
    setActionsEnabled(true);
    return;
  }

  const txt = buildTxt(cues);
  const srt = buildSrt(cues);
  const vtt = buildVtt(cues);

  state.transcript = {
    track,
    cues,
    txt,
    srt,
    vtt,
    sourceFormat: result.sourceFormat || 'unknown',
    source: result.source || 'unknown',
  };

  previewEl.value = txt;
  setActionsEnabled(true);
  setStatus(
    `Đã tải ${cues.length} câu phụ đề từ ${result.source || 'nguồn không rõ'} (${result.sourceFormat || 'unknown'})`
  );
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
  setStatus('Đã sao chép phụ đề dạng TXT vào clipboard.');
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

  const baseName = sanitizeFilename(`${state.videoTitle} - ${suffix}`);

  let content = '';
  let ext = type;

  if (type === 'txt') content = state.transcript.txt;
  if (type === 'srt') content = state.transcript.srt;
  if (type === 'vtt') content = state.transcript.vtt;

  const response = await chrome.runtime.sendMessage({
    type: 'DOWNLOAD_TEXT',
    filename: `${baseName}.${ext}`,
    content,
    mime: 'text/plain;charset=utf-8',
  });

  if (!response?.ok) {
    throw new Error(response?.error || 'Không tải file được.');
  }

  setStatus(`Đã tạo file ${ext.toUpperCase()} cho ${track.effectiveLabel || track.label}.`);
}

function sanitizeFilename(name) {
  return (
    String(name || 'youtube-subtitles')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'youtube-subtitles'
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