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

refreshBtn.addEventListener('click', loadTracks);
trackSelectEl.addEventListener('change', async (event) => {
  state.selectedTrackIndex = Number(event.target.value);
  await loadSelectedTrack();
});
copyBtn.addEventListener('click', copyTranscript);
txtBtn.addEventListener('click', () => downloadTranscript('txt'));
srtBtn.addEventListener('click', () => downloadTranscript('srt'));
vttBtn.addEventListener('click', () => downloadTranscript('vtt'));

document.addEventListener('DOMContentLoaded', () => {
  loadTracks().catch((error) => {
    console.error(error);
    setStatus(error.message || 'Không thể tải phụ đề.');
    setDebug([formatError(error)]);
  });
});

function setStatus(message) {
  statusEl.textContent = message;
}

function setDebug(lines) {
  state.debugLines = Array.isArray(lines) && lines.length ? lines : ['Chưa có log.'];
  debugEl.textContent = state.debugLines.join('\n');
}

function appendDebug(line) {
  state.debugLines.push(line);
  setDebug(state.debugLines);
}

function resetDebug() {
  state.debugLines = [];
  setDebug([]);
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
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function loadTracks() {
  setLoading(true);
  setActionsEnabled(false);
  previewEl.value = '';
  state.transcript = null;
  state.selectedTrackIndex = -1;
  resetDebug();

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

  setStatus('Đang đọc metadata phụ đề từ trang hiện tại...');

  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: scrapeCaptionMetadataFromPage,
  });

  const result = injected?.[0]?.result;
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
  for (const [index, track] of state.tracks.entries()) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = track.label;
    trackSelectEl.appendChild(option);
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
  setDebug([`Đang chuẩn bị tải track: ${track.label}`]);

  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId: state.tab.id },
      world: 'MAIN',
      func: resolveAndFetchTrackFromPage,
      args: [track],
    });

    const result = injected?.[0]?.result;
    setDebug(result?.debug || []);

    if (!result?.ok) {
      previewEl.value = '';
      state.transcript = null;
      setStatus(result?.error || 'Không tải được phụ đề cho track đã chọn.');
      setActionsEnabled(false);
      return;
    }

    const cues = Array.isArray(result.cues) ? result.cues : [];
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

    state.transcript = { track, cues, txt, srt, vtt };
    previewEl.value = txt;
    setActionsEnabled(true);
    setStatus(
      `Đã tải ${cues.length} câu phụ đề từ track: ${track.label} (${result.sourceFormat || 'unknown'})`
    );
  } catch (error) {
    console.error(error);
    previewEl.value = '';
    state.transcript = null;
    setStatus(error.message || 'Không tải được phụ đề.');
    setDebug([formatError(error)]);
    setActionsEnabled(false);
  }
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
    .map((cue) => {
      return `${formatTimestamp(cue.startMs, '.')} --> ${formatTimestamp(cue.endMs, '.')}\n${cue.text}`;
    })
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

  const track = state.transcript.track;
  const baseName = sanitizeFilename(`${state.videoTitle} - ${track.languageCode}`);

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
    setStatus(`Đã tạo file ${ext.toUpperCase()} cho track: ${track.label}`);
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

function scrapeCaptionMetadataFromPage() {
  const debug = [];

  function push(message) {
    debug.push(message);
  }

  function getTextFromRuns(node) {
    if (!node) return '';
    if (typeof node.simpleText === 'string') return node.simpleText;
    if (Array.isArray(node.runs)) return node.runs.map((item) => item.text || '').join('');
    return '';
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
        if (escaping) {
          escaping = false;
        } else if (char === '\\') {
          escaping = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return source.slice(start, i + 1);
        }
      }
    }

    return null;
  }

  function tryParsePlayerResponse() {
    const candidates = Array.from(document.scripts)
      .map((script) => script.textContent || '')
      .filter(Boolean);

    const markers = [
      'var ytInitialPlayerResponse = ',
      'ytInitialPlayerResponse = ',
      'window["ytInitialPlayerResponse"] = ',
    ];

    for (const source of candidates) {
      for (const marker of markers) {
        const markerIndex = source.indexOf(marker);
        if (markerIndex === -1) continue;

        const jsonText = extractBalancedJson(source, markerIndex + marker.length);
        if (!jsonText) continue;

        try {
          push(`Đã parse ytInitialPlayerResponse từ <script> bằng marker: ${marker}`);
          return JSON.parse(jsonText);
        } catch (error) {
          push(`Parse JSON thất bại với marker ${marker}: ${error.message}`);
        }
      }
    }

    return null;
  }

  let playerResponse = null;

  try {
    if (window.ytInitialPlayerResponse) {
      playerResponse = window.ytInitialPlayerResponse;
      push('Đọc player response từ window.ytInitialPlayerResponse');
    }
  } catch (error) {
    push(`Không đọc được window.ytInitialPlayerResponse: ${error.message}`);
  }

  if (!playerResponse) {
    try {
      const raw = window.ytplayer?.config?.args?.player_response;
      if (raw) {
        playerResponse = JSON.parse(raw);
        push('Đọc player response từ window.ytplayer.config.args.player_response');
      }
    } catch (error) {
      push(`Không parse được window.ytplayer.config.args.player_response: ${error.message}`);
    }
  }

  if (!playerResponse) {
    playerResponse = tryParsePlayerResponse();
  }

  if (!playerResponse) {
    return {
      ok: false,
      error: 'Không đọc được ytInitialPlayerResponse từ trang YouTube này.',
      debug,
    };
  }

  const renderer = playerResponse?.captions?.playerCaptionsTracklistRenderer;
  const captionTracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
  push(`Tìm thấy ${captionTracks.length} caption track trong player response.`);

  if (!captionTracks.length) {
    return {
      ok: true,
      videoTitle: playerResponse?.videoDetails?.title || document.title.replace(/ - YouTube$/, ''),
      tracks: [],
      debug,
    };
  }

  const tracks = captionTracks.map((track) => {
    const languageCode = track.languageCode || 'unknown';
    const displayName = getTextFromRuns(track.name) || languageCode;
    const isAuto = track.kind === 'asr';
    const label = `${displayName} [${languageCode}]${isAuto ? ' • auto' : ''}`;

    return {
      label,
      languageCode,
      baseUrl: track.baseUrl,
      kind: track.kind || 'standard',
      name: displayName,
      vssId: track.vssId || '',
      isTranslatable: Boolean(track.isTranslatable),
    };
  });

  return {
    ok: true,
    videoTitle: playerResponse?.videoDetails?.title || document.title.replace(/ - YouTube$/, ''),
    tracks,
    debug,
  };
}

async function resolveAndFetchTrackFromPage(track) {
  const debug = [];

  function push(message) {
    debug.push(message);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function safeUrl(url) {
    try {
      return new URL(String(url || '').replace(/\\u0026/g, '&'), location.href);
    } catch (error) {
      return null;
    }
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

  function decodeHtmlEntities(text) {
    const el = document.createElement('textarea');
    el.innerHTML = text;
    return el.value;
  }

  function parseClockToMs(value) {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    if (/^\d+(\.\d+)?$/.test(raw)) {
      return Math.round(parseFloat(raw) * 1000);
    }

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
      if (!endMs || endMs <= startMs) {
        endMs = startMs + 2000;
      }

      cues.push({ startMs, endMs, text });
    }

    return cues;
  }

  function parseXmlToCues(text) {
    const xml = new DOMParser().parseFromString(text, 'text/xml');
    if (xml.querySelector('parsererror')) {
      return [];
    }

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
    if (!pNodes.length) {
      return [];
    }

    return pNodes
      .map((node, index) => {
        let startMs = Number(node.getAttribute('t'));
        let durMs = Number(node.getAttribute('d'));

        if (!Number.isFinite(startMs)) {
          startMs = parseClockToMs(node.getAttribute('begin'));
        }
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
          if (Number.isFinite(nextStart) && nextStart > startMs) {
            endMs = nextStart;
          } else {
            endMs = startMs + 2000;
          }
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

      let timingLineIndex = lines.findIndex((line) => line.includes('-->'));
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

    if (!trimmed) {
      return { format: 'empty', cues: [] };
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[') || type.includes('json')) {
      try {
        return { format: 'json3', cues: parseJson3ToCues(JSON.parse(trimmed)) };
      } catch (error) {
        push(`Parse JSON thất bại: ${error.message}`);
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

  function addCandidate(list, seen, url, reason) {
    const parsed = safeUrl(url);
    if (!parsed) return;
    parsed.hash = '';
    const normalized = parsed.toString();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    list.push({ url: normalized, reason });
  }

  function buildFormatVariants(url) {
    const parsed = safeUrl(url);
    if (!parsed) return [];

    const variants = [];
    const raw = parsed.toString();
    variants.push(raw);

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

  function matchesTrack(url) {
    const parsed = safeUrl(url);
    if (!parsed) return false;
    if (!parsed.pathname.includes('/api/timedtext')) return false;

    const lang = parsed.searchParams.get('lang');
    const tlang = parsed.searchParams.get('tlang');
    const vssId = parsed.searchParams.get('vssid') || parsed.searchParams.get('vss_id');
    const name = parsed.searchParams.get('name') || '';

    if (track.vssId && vssId && track.vssId === vssId) return true;
    if (track.languageCode && lang && track.languageCode === lang) return true;
    if (track.languageCode && tlang && track.languageCode === tlang) return true;
    if (track.name && name && decodeURIComponent(name).toLowerCase().includes(track.name.toLowerCase())) return true;

    return false;
  }

  function collectNetworkTimedtextUrls() {
    return (performance.getEntriesByType('resource') || [])
      .map((entry) => entry?.name || '')
      .filter((name) => name.includes('/api/timedtext'));
  }

  async function tryActivateTrack() {
    const player = document.getElementById('movie_player');
    if (!player) {
      push('Không tìm thấy #movie_player để kích hoạt phụ đề.');
      return;
    }

    try {
      player.loadModule?.('captions');
      push('Đã gọi loadModule("captions").');
    } catch (error) {
      push(`loadModule("captions") thất bại: ${error.message}`);
    }

    const payloads = [
      { languageCode: track.languageCode },
      { languageCode: track.languageCode, kind: track.kind },
      track.vssId ? { languageCode: track.languageCode, vssId: track.vssId } : null,
      track.vssId ? { languageCode: track.languageCode, vss_id: track.vssId } : null,
    ].filter(Boolean);

    for (const payload of payloads) {
      try {
        player.setOption?.('captions', 'track', payload);
        push(`Đã thử setOption(captions, track, ${JSON.stringify(payload)})`);
      } catch (error) {
        push(`setOption track thất bại với payload ${JSON.stringify(payload)}: ${error.message}`);
      }
    }

    try {
      player.setOption?.('captions', 'reload', true);
      push('Đã gọi setOption(captions, reload, true).');
    } catch (error) {
      push(`setOption reload thất bại: ${error.message}`);
    }

    await sleep(1200);
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
          `Thử ${candidate.reason}: ${response.status} ${contentType || 'unknown'} ` +
            `(${text.trim().length} ký tự, format=${parsed.format})`
        );

        if (!response.ok) {
          continue;
        }

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
        push(`Fetch thất bại cho ${candidate.reason}: ${error.message}`);
      }
    }

    return null;
  }

  if (!track?.baseUrl) {
    return {
      ok: false,
      error: 'Track không có baseUrl.',
      debug,
    };
  }

  const initialNetworkUrls = collectNetworkTimedtextUrls();
  push(`Tìm thấy ${initialNetworkUrls.length} timedtext URL trong performance entries.`);

  const candidates = [];
  const seen = new Set();

  for (const url of initialNetworkUrls.filter(matchesTrack)) {
    for (const variant of buildFormatVariants(url)) {
      addCandidate(candidates, seen, variant, 'performance entry (khớp track)');
    }
  }

  for (const variant of buildFormatVariants(track.baseUrl)) {
    addCandidate(candidates, seen, variant, 'baseUrl từ player response');
  }

  let result = await tryFetchCandidates(candidates);
  if (result) {
    return result;
  }

  push('Chưa lấy được phụ đề từ danh sách URL ban đầu. Thử kích hoạt track trên player...');
  await tryActivateTrack();

  const afterActivationUrls = collectNetworkTimedtextUrls();
  push(`Sau khi kích hoạt, có ${afterActivationUrls.length} timedtext URL trong performance entries.`);

  const secondPassCandidates = [];
  const secondSeen = new Set();

  for (const url of afterActivationUrls.filter(matchesTrack)) {
    for (const variant of buildFormatVariants(url)) {
      addCandidate(secondPassCandidates, secondSeen, variant, 'performance entry sau kích hoạt');
    }
  }

  for (const variant of buildFormatVariants(track.baseUrl)) {
    addCandidate(secondPassCandidates, secondSeen, variant, 'baseUrl từ player response');
  }

  result = await tryFetchCandidates(secondPassCandidates);
  if (result) {
    return result;
  }

  return {
    ok: false,
    error:
      'Không parse được phụ đề từ timedtext. Hãy bật CC trên video rồi bấm tải lại; log bên dưới sẽ giúp chẩn đoán track nào đang trả rỗng.',
    debug,
  };
}