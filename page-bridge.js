(() => {
  const REQUEST_EVENT = 'ytsg:request';
  const RESPONSE_EVENT = 'ytsg:response';

  if (window.__YT_SUBTITLE_GRABBER_BRIDGE__) return;
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

  async function handleAction(action, payload) {
    if (action === 'GET_METADATA') return scrapeCaptionMetadataFromPage();
    if (action === 'FETCH_TRACK') return resolveAndFetchTrackFromPage(payload.track);
    return { ok: false, error: `Unknown bridge action: ${action}` };
  }

  function scrapeCaptionMetadataFromPage() {
    const debug = [];
    const playerResponse = getPlayerResponse(debug);

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

    const defaultSourceIndex = computeDefaultSourceIndex(sourceTracks, renderer, debug);

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

  async function resolveAndFetchTrackFromPage(track) {
    const debug = [];
    const push = (line) => debug.push(line);

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

    let result = await tryFetchCandidates(firstCandidates, debug);
    if (result) return result;

    push('Lượt 1 thất bại, thử kích hoạt captions trên player...');
    await tryActivateTrack(track, debug);

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

    result = await tryFetchCandidates(secondCandidates, debug);
    if (result) return result;

    return {
      ok: false,
      error: 'Timedtext không trả được dữ liệu parse được cho lựa chọn này.',
      debug,
    };
  }

  function computeDefaultSourceIndex(sourceTracks, renderer, debug) {
    if (!Array.isArray(sourceTracks) || !sourceTracks.length) return -1;

    const currentTrack = getCurrentCaptionTrackHint(debug);

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

  function getCurrentCaptionTrackHint(debug) {
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

  function buildEffectiveTrackUrl(track) {
    try {
      const url = new URL(normalizeBaseUrl(track.baseUrl), location.href);

      if (track.isTranslation && track.targetLanguageCode) {
        url.searchParams.set('tlang', track.targetLanguageCode);
        url.searchParams.set('lang', track.sourceLanguageCode || track.languageCode);
      } else {
        url.searchParams.delete('tlang');
        url.searchParams.set('lang', track.languageCode);
      }

      return url.toString();
    } catch (error) {
      return '';
    }
  }

  function getPlayerResponse(debug) {
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

    const parsed = tryParsePlayerResponseFromScripts(debug);
    if (parsed) return parsed;

    return null;
  }

  function tryParsePlayerResponseFromScripts(debug) {
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

  async function tryActivateTrack(track, debug) {
    const push = (line) => debug.push(line);
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

    const baseLanguage = track.sourceLanguageCode || track.languageCode;

    const payloads = [
      { languageCode: baseLanguage },
      { languageCode: baseLanguage, kind: track.kind },
      track.vssId ? { languageCode: baseLanguage, vssId: track.vssId } : null,
      track.vssId ? { languageCode: baseLanguage, vss_id: track.vssId } : null,
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

  function parseContent(text, contentType, debug) {
    const trimmed = String(text || '').trim();
    const type = String(contentType || '').toLowerCase();

    if (!trimmed) return { format: 'empty', cues: [] };

    if (trimmed.startsWith('{') || trimmed.startsWith('[') || type.includes('json')) {
      try {
        return { format: 'json3', cues: parseJson3ToCues(JSON.parse(trimmed)) };
      } catch (error) {
        debug.push(`Parse JSON lỗi: ${error.message}`);
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

  function addCandidate(candidates, seen, url, reason) {
    const parsed = safeUrl(url);
    if (!parsed) return;

    parsed.hash = '';
    const normalized = parsed.toString();

    if (seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push({ url: normalized, reason });
  }

  function buildFormatVariants(url, track) {
    const parsed = safeUrl(url);
    if (!parsed) return [];

    if (track.isTranslation && track.targetLanguageCode) {
      parsed.searchParams.set('tlang', track.targetLanguageCode);
      parsed.searchParams.set('lang', track.sourceLanguageCode || track.languageCode);
    } else {
      parsed.searchParams.delete('tlang');
      parsed.searchParams.set('lang', track.languageCode);
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

  function matchesTrack(url, track) {
    const parsed = safeUrl(url);
    if (!parsed) return false;
    if (!parsed.pathname.includes('/api/timedtext')) return false;

    const lang = parsed.searchParams.get('lang');
    const tlang = parsed.searchParams.get('tlang');
    const vssId = parsed.searchParams.get('vssid') || parsed.searchParams.get('vss_id');

    if (track.isTranslation) {
      return (
        (!track.vssId || !vssId || track.vssId === vssId) &&
        lang === (track.sourceLanguageCode || track.languageCode) &&
        tlang === track.targetLanguageCode
      );
    }

    if (track.vssId && vssId && track.vssId !== vssId) return false;
    return lang === track.languageCode && !tlang;
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