(() => {
  const REQUEST_EVENT = 'ytsg:request';
  const RESPONSE_EVENT = 'ytsg:response';
  const BRIDGE_READY_EVENT = 'ytsg:bridge-ready';

  if (window.__YT_SUBTITLE_GRABBER_BRIDGE__) {
    return;
  }
  window.__YT_SUBTITLE_GRABBER_BRIDGE__ = true;

  window.addEventListener(REQUEST_EVENT, (event) => {
    const detail = event.detail || {};
    const requestId = detail.requestId;
    const action = detail.action;
    const payload = detail.payload || {};

    handleAction(action, payload)
      .then((result) => {
        window.dispatchEvent(
          new CustomEvent(RESPONSE_EVENT, {
            detail: { requestId, payload: result },
          })
        );
      })
      .catch((error) => {
        window.dispatchEvent(
          new CustomEvent(RESPONSE_EVENT, {
            detail: {
              requestId,
              payload: {
                ok: false,
                error: error?.message || 'Bridge error',
                debug: [formatError(error)],
              },
            },
          })
        );
      });
  });

  window.dispatchEvent(new CustomEvent(BRIDGE_READY_EVENT));

  async function handleAction(action, payload) {
    if (action === 'GET_METADATA') {
      return scrapeCaptionMetadataFromPage();
    }
    if (action === 'FETCH_TRACK') {
      return resolveAndFetchTrackFromPage(payload.track);
    }
    return { ok: false, error: `Unknown bridge action: ${action}` };
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
        if (depth === 0) return source.slice(start, i + 1);
      }
    }

    return null;
  }

  function tryParsePlayerResponse(debug) {
    const sources = Array.from(document.scripts)
      .map((script) => script.textContent || '')
      .filter(Boolean);

    const markers = [
      'var ytInitialPlayerResponse = ',
      'ytInitialPlayerResponse = ',
      'window["ytInitialPlayerResponse"] = ',
    ];

    for (const source of sources) {
      for (const marker of markers) {
        const markerIndex = source.indexOf(marker);
        if (markerIndex === -1) continue;
        const jsonText = extractBalancedJson(source, markerIndex + marker.length);
        if (!jsonText) continue;
        try {
          debug.push(`Đã parse player response từ script bằng marker: ${marker}`);
          return JSON.parse(jsonText);
        } catch (error) {
          debug.push(`Parse marker ${marker} thất bại: ${error.message}`);
        }
      }
    }

    return null;
  }

  function scrapeCaptionMetadataFromPage() {
  const debug = [];
  let playerResponse = null;

  try {
    if (window.ytInitialPlayerResponse) {
      playerResponse = window.ytInitialPlayerResponse;
      debug.push('Đọc player response từ window.ytInitialPlayerResponse');
    }
  } catch (error) {
    debug.push(`Không đọc được window.ytInitialPlayerResponse: ${error.message}`);
  }

  if (!playerResponse) {
    try {
      const raw = window.ytplayer?.config?.args?.player_response;
      if (raw) {
        playerResponse = JSON.parse(raw);
        debug.push('Đọc player response từ window.ytplayer.config.args.player_response');
      }
    } catch (error) {
      debug.push(`Parse ytplayer.config.args.player_response thất bại: ${error.message}`);
    }
  }

  if (!playerResponse) {
    playerResponse = tryParsePlayerResponse(debug);
  }

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

  debug.push(`Tìm thấy ${captionTracks.length} caption track.`);
  debug.push(`Tìm thấy ${translationLanguages.length} ngôn ngữ dịch.`);

  const originalTracks = captionTracks.map((track) => {
    const languageCode = track.languageCode || 'unknown';
    const displayName = getTextFromRuns(track.name) || languageCode;
    const isAuto = track.kind === 'asr';

    return {
      label: `${displayName} [${languageCode}]${isAuto ? ' • auto' : ''}`,
      languageCode,
      baseUrl: track.baseUrl,
      kind: track.kind || 'standard',
      name: displayName,
      vssId: track.vssId || '',
      isTranslatable: Boolean(track.isTranslatable),
      isTranslation: false,
      sourceLanguageCode: languageCode,
      sourceName: displayName,
    };
  });

  const translatedTracks = [];

  for (const track of captionTracks) {
    if (!track?.baseUrl || !track?.isTranslatable) continue;

    const sourceLanguageCode = track.languageCode || 'unknown';
    const sourceName = getTextFromRuns(track.name) || sourceLanguageCode;

    for (const lang of translationLanguages) {
      const targetLanguageCode = lang?.languageCode || '';
      const targetName = getTextFromRuns(lang?.languageName) || targetLanguageCode;

      if (!targetLanguageCode) continue;
      if (targetLanguageCode === sourceLanguageCode) continue;

      try {
        const url = new URL(String(track.baseUrl).replace(/\\u0026/g, '&'), location.href);
        url.searchParams.set('tlang', targetLanguageCode);

        translatedTracks.push({
          label: `${targetName} [${targetLanguageCode}] ← ${sourceName} [${sourceLanguageCode}]`,
          languageCode: targetLanguageCode,
          baseUrl: url.toString(),
          kind: track.kind || 'standard',
          name: targetName,
          vssId: track.vssId || '',
          isTranslatable: true,
          isTranslation: true,
          sourceLanguageCode,
          sourceName,
        });
      } catch (error) {
        debug.push(`Không tạo được track dịch ${targetLanguageCode}: ${error.message}`);
      }
    }
  }

  const allTracks = [...originalTracks, ...translatedTracks];
  debug.push(`Tổng cộng hiển thị ${allTracks.length} track sau khi thêm track dịch.`);

  return {
    ok: true,
    videoTitle: playerResponse?.videoDetails?.title || document.title.replace(/ - YouTube$/, ''),
    tracks: allTracks,
    debug,
  };
}

  async function resolveAndFetchTrackFromPage(track) {
    const debug = [];
    const push = (line) => debug.push(line);

    if (!track?.baseUrl) {
      return { ok: false, error: 'Track không có baseUrl.', debug };
    }

    const initialNetworkUrls = collectNetworkTimedtextUrls();
    push(`Performance entries có ${initialNetworkUrls.length} timedtext URL.`);

    const firstCandidates = buildCandidateSet(track, initialNetworkUrls, 'performance entry');
    addBaseVariants(firstCandidates, track);

    let result = await tryFetchCandidates(firstCandidates, debug);
    if (result) return result;

    push('Lượt 1 không thành công. Thử kích hoạt captions track trên player...');
    await tryActivateTrack(track, debug);

    const secondNetworkUrls = collectNetworkTimedtextUrls();
    push(`Sau kích hoạt có ${secondNetworkUrls.length} timedtext URL.`);

    const secondCandidates = buildCandidateSet(track, secondNetworkUrls, 'performance entry sau kích hoạt');
    addBaseVariants(secondCandidates, track);

    result = await tryFetchCandidates(secondCandidates, debug);
    if (result) return result;

    return {
      ok: false,
      error:
        'Timedtext không trả được dữ liệu parse được. Sẽ cần fallback transcript panel nếu video cho phép.',
      debug,
    };
  }

  function buildCandidateSet(track, urls, reason) {
    const seen = new Set();
    const candidates = [];
    for (const url of urls.filter((candidate) => matchesTrack(candidate, track))) {
      for (const variant of buildFormatVariants(url)) {
        addCandidate(candidates, seen, variant, reason);
      }
    }
    return candidates;
  }

  function addBaseVariants(candidates, track) {
    const seen = new Set(candidates.map((item) => item.url));
    for (const variant of buildFormatVariants(track.baseUrl)) {
      addCandidate(candidates, seen, variant, 'baseUrl từ player response');
    }
  }

  async function tryActivateTrack(track, debug) {
    const push = (line) => debug.push(line);
    const player = document.getElementById('movie_player');
    if (!player) {
      push('Không tìm thấy #movie_player.');
      return;
    }

    try {
      player.loadModule?.('captions');
      push('Đã gọi loadModule("captions").');
    } catch (error) {
      push(`loadModule captions thất bại: ${error.message}`);
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
        push(`setOption track thất bại: ${error.message}`);
      }
    }

    try {
      player.setOption?.('captions', 'reload', true);
      push('Đã gọi setOption(captions, reload, true).');
    } catch (error) {
      push(`setOption reload thất bại: ${error.message}`);
    }

    await delay(1200);
  }

  async function tryFetchCandidates(candidates, debug) {
    const push = (line) => debug.push(line);

    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate.url, {
          credentials: 'include',
          cache: 'no-store',
        });
        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();
        const parsed = parseContent(text, contentType, debug);

        push(
          `Thử ${candidate.reason}: ${response.status} ${contentType || 'unknown'} ` +
            `(${text.trim().length} ký tự, format=${parsed.format}, cues=${parsed.cues.length})`
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
        push(`Fetch thất bại cho ${candidate.reason}: ${error.message}`);
      }
    }

    return null;
  }

  function parseContent(text, contentType, debug) {
    const trimmed = String(text || '').trim();
    const type = String(contentType || '').toLowerCase();

    if (!trimmed) return { format: 'empty', cues: [] };

    if (trimmed.startsWith('{') || trimmed.startsWith('[') || type.includes('json')) {
      try {
        return { format: 'json3', cues: parseJson3ToCues(JSON.parse(trimmed)) };
      } catch (error) {
        debug.push(`Parse JSON thất bại: ${error.message}`);
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

  function decodeHtmlEntities(text) {
    const el = document.createElement('textarea');
    el.innerHTML = text;
    return el.value;
  }

  function parseClockToMs(value) {
    const raw = String(value || '').trim().replace(',', '.');
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

  function safeUrl(url) {
    try {
      return new URL(String(url || '').replace(/\\u0026/g, '&'), location.href);
    } catch (error) {
      return null;
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

  function buildFormatVariants(url) {
    const parsed = safeUrl(url);
    if (!parsed) return [];
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

  function matchesTrack(url, track) {
    const parsed = safeUrl(url);
    if (!parsed) return false;
    if (!parsed.pathname.includes('/api/timedtext')) return false;

    const lang = parsed.searchParams.get('lang');
    const tlang = parsed.searchParams.get('tlang');
    const vssId = parsed.searchParams.get('vssid') || parsed.searchParams.get('vss_id');
    const name = parsed.searchParams.get('name') || '';

    if (track.isTranslation) {
        if (
        track.sourceLanguageCode &&
        track.languageCode &&
        lang === track.sourceLanguageCode &&
        tlang === track.languageCode
        ) {
        return true;
        }
    }

    if (track.vssId && vssId && track.vssId === vssId) return true;
    if (track.languageCode && lang && track.languageCode === lang && !track.isTranslation) return true;
    if (track.languageCode && tlang && track.languageCode === tlang) return true;
    if (track.name && name && decodeURIComponent(name).toLowerCase().includes(track.name.toLowerCase())) return true;

    return false;
}   

  function collectNetworkTimedtextUrls() {
    return (performance.getEntriesByType('resource') || [])
      .map((entry) => entry?.name || '')
      .filter((name) => name.includes('/api/timedtext'));
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatError(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    return `${error.name || 'Error'}: ${error.message || 'No message'}`;
  }
})();