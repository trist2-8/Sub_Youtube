const state = {
  tab: null,
  videoTitle: '',
  tracks: [],
  selectedTrackIndex: -1,
  transcript: null,
  debugLines: [],
};

const statusEl = document.getElementById('status');
const trackSelectEl = document.getElementById('trackSelect');
const previewEl = document.getElementById('preview');
const debugEl = document.getElementById('debug');
const refreshBtn = document.getElementById('refreshBtn');
const copyBtn = document.getElementById('copyBtn');
const txtBtn = document.getElementById('txtBtn');
const srtBtn = document.getElementById('srtBtn');
const vttBtn = document.getElementById('vttBtn');
const panelBtn = document.getElementById('panelBtn');

refreshBtn.addEventListener('click', loadTracks);
trackSelectEl.addEventListener('change', async (event) => {
  state.selectedTrackIndex = Number(event.target.value);
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
  trackSelectEl.disabled = isLoading || !state.tracks.length;
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

async function sendToTab(message) {
  const tab = state.tab || (await getActiveTab());
  state.tab = tab;

  if (!tab?.id) {
    throw new Error('Không tìm thấy tab đang mở.');
  }

  return chrome.tabs.sendMessage(tab.id, message);
}

async function loadTracks() {
  setLoading(true);
  setActionsEnabled(false);
  previewEl.value = '';
  state.transcript = null;
  state.selectedTrackIndex = -1;
  setDebug([]);

  const tab = await getActiveTab();
  state.tab = tab;

  if (!tab || !tab.id || !tab.url) {
    throw new Error('Không tìm thấy tab đang mở.');
  }

  if (!/^https:\/\/www\.youtube\.com\/watch/.test(tab.url)) {
    trackSelectEl.innerHTML = '<option>Không phải trang video YouTube</option>';
    trackSelectEl.disabled = true;
    setStatus('Hãy mở một URL dạng https://www.youtube.com/watch?v=...');
    setLoading(false);
    return;
  }

  setStatus('Đang đọc danh sách track từ content script...');

  const result = await sendToTab({ type: 'GET_TRACKS' });
  setDebug(result?.debug || []);

  if (!result?.ok) {
    trackSelectEl.innerHTML = `<option>${escapeHtml(result?.error || 'Không tìm thấy dữ liệu phụ đề')}</option>`;
    trackSelectEl.disabled = true;
    setStatus(result?.error || 'Không tìm thấy dữ liệu phụ đề.');
    setLoading(false);
    return;
  }

  state.videoTitle = result.videoTitle || sanitizeFilename(tab.title || 'youtube-video');
  state.tracks = result.tracks || [];

  if (!state.tracks.length) {
    trackSelectEl.innerHTML = '<option>Video này không có phụ đề khả dụng</option>';
    trackSelectEl.disabled = true;
    setStatus('Video này hiện không có phụ đề để trích xuất.');
    setLoading(false);
    return;
  }

  renderTrackOptions();
  state.selectedTrackIndex = 0;
  trackSelectEl.value = '0';
  setStatus(`Tìm thấy ${state.tracks.length} track phụ đề. Đang tải nội dung...`);
  setLoading(false);
  await loadSelectedTrack();
}

function renderTrackOptions() {
  trackSelectEl.innerHTML = '';

  const originalGroup = document.createElement('optgroup');
  originalGroup.label = 'Phụ đề gốc';

  const translatedGroup = document.createElement('optgroup');
  translatedGroup.label = 'Dịch tự động';

  for (const [index, track] of state.tracks.entries()) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = track.label;

    if (track.isTranslation) {
      translatedGroup.appendChild(option);
    } else {
      originalGroup.appendChild(option);
    }
  }

  if (originalGroup.children.length) {
    trackSelectEl.appendChild(originalGroup);
  }
  if (translatedGroup.children.length) {
    trackSelectEl.appendChild(translatedGroup);
  }

  trackSelectEl.disabled = false;
}

async function loadSelectedTrack() {
  const track = state.tracks[state.selectedTrackIndex];
  if (!track) {
    setStatus('Chưa chọn track phụ đề.');
    return;
  }

  setActionsEnabled(false);
  setStatus(`Đang tải track: ${track.label}`);
  setDebug([`Đang yêu cầu track ${track.label} từ content script...`]);

  try {
    const result = await sendToTab({ type: 'FETCH_TRACK', track });
    setDebug(result?.debug || []);

    if (!result?.ok) {
      previewEl.value = '';
      state.transcript = null;
      setStatus(result?.error || 'Không tải được phụ đề cho track đã chọn.');
      return;
    }

    applyTranscriptResult(track, result);
  } catch (error) {
    console.error(error);
    previewEl.value = '';
    state.transcript = null;
    setStatus(error.message || 'Không tải được phụ đề.');
    setDebug([formatError(error)]);
  }
}

async function extractFromPanelOnly() {
  const track = state.tracks[state.selectedTrackIndex] || null;
  setStatus('Đang thử lấy transcript từ panel trên trang YouTube...');
  setActionsEnabled(false);
  previewEl.value = '';

  try {
    const result = await sendToTab({ type: 'EXTRACT_PANEL_ONLY', track });
    setDebug(result?.debug || []);

    if (!result?.ok) {
      setStatus(result?.error || 'Không lấy được transcript panel.');
      return;
    }

    applyTranscriptResult(track || { languageCode: 'panel', label: 'Transcript panel' }, result);
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Không lấy được transcript panel.');
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
  const sourceSuffix = state.transcript.source === 'panel' ? 'panel' : track.languageCode || 'unknown';
  const baseName = sanitizeFilename(`${state.videoTitle} - ${sourceSuffix}`);

  let content = '';
  let ext = type;
  let mime = 'text/plain;charset=utf-8';

  if (type === 'txt') content = state.transcript.txt;
  if (type === 'srt') content = state.transcript.srt;
  if (type === 'vtt') content = state.transcript.vtt;

  const response = await chrome.runtime.sendMessage({
    type: 'DOWNLOAD_TEXT',
    filename: `${baseName}.${ext}`,
    content,
    mime,
  });

  if (!response?.ok) {
    throw new Error(response?.error || 'Không tải file được.');
  }

  setStatus(`Đã tạo file ${ext.toUpperCase()} cho ${track.label || 'transcript'}.`);
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