(function () {
  "use strict";

  var NAME = "Netflix 中文字幕翻译";
  var CACHE_PREFIX = "nfx.zhsub.v1";
  var DEFAULTS = {
    provider: "google_web",
    apiKey: "",
    targetVariant: "zh-Hans",
    debug: false,
    timeoutMs: 55000
  };

  var BATCH_SIZES = {
    deepl_free: 30,
    deepl_pro: 50,
    google_v2: 100,
    google_web: 12
  };

  function isLoonRuntime() {
    return typeof $request !== "undefined" && typeof $response !== "undefined" && typeof $done === "function";
  }

  function createLoonEnv() {
    return {
      log: function (message) {
        if (typeof console !== "undefined" && console.log) {
          console.log("[" + NAME + "] " + message);
        }
      },
      notify: function (subtitle, body) {
        if (typeof $notification !== "undefined" && $notification.post) {
          $notification.post(NAME, subtitle, body || "");
        }
      },
      storeRead: function (key) {
        if (typeof $persistentStore === "undefined" || !$persistentStore.read) return null;
        return $persistentStore.read(key);
      },
      storeWrite: function (key, value) {
        if (typeof $persistentStore === "undefined" || !$persistentStore.write) return false;
        return $persistentStore.write(value, key);
      },
      httpPost: function (options) {
        return new Promise(function (resolve, reject) {
          if (typeof $httpClient === "undefined" || !$httpClient.post) {
            reject(new Error("$httpClient.post is unavailable"));
            return;
          }

          $httpClient.post(options, function (error, response, data) {
            if (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
              return;
            }

            resolve({
              status: response && (response.status || response.statusCode),
              headers: response && response.headers,
              body: data
            });
          });
        });
      },
      httpGet: function (options) {
        return new Promise(function (resolve, reject) {
          if (typeof $httpClient === "undefined" || !$httpClient.get) {
            reject(new Error("$httpClient.get is unavailable"));
            return;
          }

          $httpClient.get(options, function (error, response, data) {
            if (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
              return;
            }

            resolve({
              status: response && (response.status || response.statusCode),
              headers: response && response.headers,
              body: data
            });
          });
        });
      }
    };
  }

  function parseArgument(argument, env) {
    var options = {};

    if (argument && typeof argument === "object" && !Array.isArray(argument)) {
      options.provider = argument.provider || argument[0] || argument.arg1;
      options.apiKey = argument.apiKey || argument[1] || argument.arg2;
      options.targetVariant = argument.targetVariant || argument[2] || argument.arg3;
      options.debug = firstDefined(argument.debug, argument[3], argument.arg4);
    } else if (Array.isArray(argument)) {
      options.provider = argument[0];
      options.apiKey = argument[1];
      options.targetVariant = argument[2];
      options.debug = argument[3];
    } else if (typeof argument === "string" && argument.trim()) {
      options = parseArgumentString(argument);
    }

    if (!options.provider && env && env.storeRead) options.provider = env.storeRead("provider");
    if (!options.apiKey && env && env.storeRead) options.apiKey = env.storeRead("apiKey");
    if (!options.targetVariant && env && env.storeRead) options.targetVariant = env.storeRead("targetVariant");
    if (typeof options.debug === "undefined" && env && env.storeRead) options.debug = env.storeRead("debug");

    options.provider = normalizeProvider(options.provider || DEFAULTS.provider);
    options.apiKey = String(options.apiKey || DEFAULTS.apiKey).trim();
    options.targetVariant = normalizeTargetVariant(options.targetVariant || DEFAULTS.targetVariant);
    options.debug = parseBoolean(options.debug, DEFAULTS.debug);
    options.timeoutMs = DEFAULTS.timeoutMs;
    options.batchSize = BATCH_SIZES[options.provider] || 30;
    options.translatorTarget = getTranslatorTarget(options.provider, options.targetVariant);

    return options;
  }

  function firstDefined() {
    for (var i = 0; i < arguments.length; i += 1) {
      if (typeof arguments[i] !== "undefined") return arguments[i];
    }
    return undefined;
  }

  function parseArgumentString(argument) {
    var trimmed = argument.trim();
    if (trimmed[0] === "{") {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        return {};
      }
    }

    var parsed = {};
    trimmed.split("&").forEach(function (part) {
      var pair = part.split("=");
      if (!pair[0]) return;
      parsed[decodeURIComponent(pair[0])] = decodeURIComponent(pair.slice(1).join("=") || "");
    });
    return parsed;
  }

  function normalizeProvider(provider) {
    var value = String(provider || "").trim();
    if (value === "deepl_pro" || value === "google_v2" || value === "google_web") return value;
    return "deepl_free";
  }

  function normalizeTargetVariant(targetVariant) {
    return String(targetVariant || "").toLowerCase() === "zh-hant" ? "zh-Hant" : "zh-Hans";
  }

  function getTranslatorTarget(provider, targetVariant) {
    if (provider === "google_v2" || provider === "google_web") {
      return targetVariant === "zh-Hant" ? "zh-TW" : "zh-CN";
    }
    return targetVariant === "zh-Hant" ? "ZH-HANT" : "ZH-HANS";
  }

  function providerRequiresApiKey(provider) {
    return provider !== "google_web";
  }

  function parseBoolean(value, fallback) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      var normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
      if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
    }
    return fallback;
  }

  function debug(env, options, message) {
    if (options.debug && env && env.log) env.log(message);
  }

  async function runLoon() {
    var env = createLoonEnv();
    try {
      var result = await processResponse({
        request: $request,
        response: $response,
        argument: typeof $argument === "undefined" ? null : $argument,
        env: env
      });
      $done(result);
    } catch (error) {
      env.log("unexpected fallback: " + error.message);
      if (env.notify) env.notify("脚本异常，已回退原字幕", error.message);
      $done({});
    }
  }

  async function processResponse(context) {
    var request = context.request || {};
    var response = context.response || {};
    var env = context.env || {};
    var options = parseArgument(context.argument, env);
    var url = request.url || "";

    if (!isNetflixUrl(url)) {
      return {};
    }

    var body = bodyToString(response.body);
    if (!body) {
      return {};
    }

    var format = detectSubtitleFormat(body, url, response.headers || {});
    if (!format) {
      if (detectNoSubtitleManifest(body)) {
        notifyOnce(env, "no-subtitle-source", "影片没有可处理的字幕轨", "此方案不从音频生成字幕。");
      }
      return {};
    }

    debug(env, options, "subtitle format=" + format + " url=" + stripUrlQuery(url));

    if (providerRequiresApiKey(options.provider) && !options.apiKey && !env.translateBatch) {
      notifyOnce(env, "missing-api-key", "缺少翻译 API Key", "请在插件参数里填写 DeepL 或 Google API Key，或把 provider 改为 google_web。");
      return {};
    }

    try {
      var translated = format === "webvtt"
        ? await transformWebVtt(body, options, env)
        : await transformTtml(body, options, env);

      if (!translated.changed) {
        debug(env, options, "no subtitle text needed translation");
        return {};
      }

      var headers = sanitizeResponseHeaders(response.headers || {});
      return {
        status: response.status || 200,
        headers: headers,
        body: translated.body
      };
    } catch (error) {
      debug(env, options, "translation fallback: " + error.message);
      notifyOnce(env, "translation-failed", "翻译失败，已回退原字幕", error.message);
      return {};
    }
  }

  function isNetflixUrl(url) {
    try {
      var host = new URL(url).hostname.toLowerCase();
      return host === "netflix.com" ||
        host.endsWith(".netflix.com") ||
        host === "nflxvideo.net" ||
        host.endsWith(".nflxvideo.net");
    } catch (error) {
      return false;
    }
  }

  function stripUrlQuery(url) {
    return String(url || "").split("?")[0];
  }

  function bodyToString(body) {
    if (typeof body === "string") return body;
    if (body == null) return "";
    if (typeof TextDecoder !== "undefined" && (body instanceof Uint8Array || Array.isArray(body))) {
      return new TextDecoder("utf-8").decode(body);
    }
    return String(body);
  }

  function detectSubtitleFormat(body, url, headers) {
    var sample = String(body || "").slice(0, 4096);
    var contentType = getHeader(headers, "content-type").toLowerCase();
    var path = stripUrlQuery(url).toLowerCase();

    if (/^\uFEFF?WEBVTT\b/.test(sample) || /\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[.,]\d{3}/.test(sample)) {
      return "webvtt";
    }

    if (contentType.indexOf("text/vtt") >= 0 || path.endsWith(".vtt") || path.endsWith(".webvtt")) {
      return "webvtt";
    }

    if (/<tt[\s>]/i.test(sample) || /<p\b[^>]*(begin|end|dur)=/i.test(sample)) {
      return "ttml";
    }

    if (contentType.indexOf("ttml") >= 0 || contentType.indexOf("imsc") >= 0 || path.endsWith(".ttml") || path.endsWith(".xml")) {
      if (/<p\b/i.test(sample)) return "ttml";
    }

    return null;
  }

  function getHeader(headers, name) {
    if (!headers) return "";
    var target = name.toLowerCase();
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i].toLowerCase() === target) return String(headers[keys[i]] || "");
    }
    return "";
  }

  function detectNoSubtitleManifest(body) {
    var sample = String(body || "").slice(0, 50000);
    return /"(timedtexttracks|textTracks|subtitleTracks|subtitles)"\s*:\s*\[\s*\]/i.test(sample);
  }

  function notifyOnce(env, key, subtitle, body) {
    var cacheKey = CACHE_PREFIX + ".notice." + key;
    if (env.storeRead && env.storeRead(cacheKey)) return;
    if (env.storeWrite) env.storeWrite(cacheKey, String(Date.now()));
    if (env.notify) env.notify(subtitle, body);
  }

  function sanitizeResponseHeaders(headers) {
    var next = {};
    Object.keys(headers || {}).forEach(function (key) {
      var lower = key.toLowerCase();
      if (lower === "content-length" || lower === "content-encoding" || lower === "etag") return;
      next[key] = headers[key];
    });
    return next;
  }

  async function transformWebVtt(body, options, env) {
    var normalized = normalizeNewlines(body);
    var blocks = normalized.split(/\n{2,}/);
    var translatable = [];
    var cueRefs = [];

    blocks.forEach(function (block, blockIndex) {
      var lines = block.split("\n");
      var timingIndex = findTimingLine(lines);
      if (timingIndex < 0) return;
      if (/^\s*(NOTE|STYLE|REGION)\b/.test(lines[0] || "")) return;

      var originalText = lines.slice(timingIndex + 1).join("\n");
      var visible = stripSubtitleMarkup(originalText).trim();
      if (!visible || hasChinese(visible)) return;

      var masked = maskSubtitleMarkup(originalText);
      translatable.push(masked.text);
      cueRefs.push({
        blockIndex: blockIndex,
        timingIndex: timingIndex,
        lines: lines,
        masked: masked
      });
    });

    if (!translatable.length) {
      return { body: body, changed: false };
    }

    var translations = await translateTexts(translatable, options, env);
    cueRefs.forEach(function (ref, index) {
      var translatedText = ref.masked.unmask(translations[index] || translatable[index]);
      ref.lines.splice(ref.timingIndex + 1, ref.lines.length - ref.timingIndex - 1, translatedText);
      blocks[ref.blockIndex] = ref.lines.join("\n");
    });

    return { body: blocks.join("\n\n"), changed: true };
  }

  function findTimingLine(lines) {
    for (var i = 0; i < lines.length; i += 1) {
      if (lines[i].indexOf("-->") >= 0) return i;
    }
    return -1;
  }

  async function transformTtml(body, options, env) {
    var translatable = [];
    var refs = [];
    var index = 0;
    var marked = body.replace(/(<p\b[^>]*>)([\s\S]*?)(<\/p>)/gi, function (match, open, inner, close) {
      var visible = stripSubtitleMarkup(inner).replace(/\s+/g, " ").trim();
      if (!visible || hasChinese(visible)) return match;

      var masked = maskSubtitleMarkup(inner);
      var token = "__NF_SUB_P_" + index + "__";
      index += 1;
      translatable.push(masked.text);
      refs.push({
        token: token,
        open: open,
        close: close,
        masked: masked,
        original: match
      });
      return token;
    });

    if (!translatable.length) {
      return { body: body, changed: false };
    }

    var translations = await translateTexts(translatable, options, env);
    refs.forEach(function (ref, refIndex) {
      var translatedInner = ref.masked.unmask(translations[refIndex] || translatable[refIndex]);
      marked = replaceAll(marked, ref.token, ref.open + translatedInner + ref.close);
    });

    return { body: marked, changed: true };
  }

  function normalizeNewlines(input) {
    return String(input || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function stripSubtitleMarkup(text) {
    return String(text || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ");
  }

  function hasChinese(text) {
    return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(String(text || ""));
  }

  function maskSubtitleMarkup(text) {
    var entries = [];
    var output = String(text || "")
      .replace(/<[^>]+>/g, function (tag) {
        var token = "__NF_SUB_TAG_" + entries.length + "__";
        entries.push({ token: token, value: tag });
        return token;
      })
      .replace(/\n/g, function () {
        var token = "__NF_SUB_BR_" + entries.length + "__";
        entries.push({ token: token, value: "\n" });
        return token;
      });

    return {
      text: output,
      unmask: function (translated) {
        var restored = String(translated || "");
        entries.forEach(function (entry) {
          restored = replaceAll(restored, entry.token, entry.value);
        });
        return restored;
      }
    };
  }

  function replaceAll(input, search, replacement) {
    return String(input).split(search).join(replacement);
  }

  async function translateTexts(texts, options, env) {
    var results = new Array(texts.length);
    var pending = [];
    var pendingIndexByText = {};

    texts.forEach(function (text, index) {
      if (!String(text || "").trim() || hasChinese(stripSubtitleMarkup(text))) {
        results[index] = text;
        return;
      }

      var cacheKey = getCacheKey(options, text);
      var cached = env.storeRead && env.storeRead(cacheKey);
      if (cached) {
        results[index] = cached;
        return;
      }

      if (!pendingIndexByText[text]) {
        pendingIndexByText[text] = [];
        pending.push({ text: text, cacheKey: cacheKey });
      }
      pendingIndexByText[text].push(index);
    });

    for (var offset = 0; offset < pending.length; offset += options.batchSize) {
      var batch = pending.slice(offset, offset + options.batchSize);
      var translatedBatch = await translateBatch(batch.map(function (item) { return item.text; }), options, env);

      if (!Array.isArray(translatedBatch) || translatedBatch.length !== batch.length) {
        throw new Error("translator returned an invalid result count");
      }

      for (var i = 0; i < batch.length; i += 1) {
        var translated = decodeHtmlEntities(String(translatedBatch[i] || batch[i].text));
        if (env.storeWrite) env.storeWrite(batch[i].cacheKey, translated);
        pendingIndexByText[batch[i].text].forEach(function (resultIndex) {
          results[resultIndex] = translated;
        });
      }
    }

    return results;
  }

  async function translateBatch(texts, options, env) {
    if (env.translateBatch) return env.translateBatch(texts, options);
    return translateBatchExternal(texts, options, env);
  }

  async function translateBatchExternal(texts, options, env) {
    if (providerRequiresApiKey(options.provider) && !options.apiKey) throw new Error("missing apiKey");

    if (options.provider === "google_v2") {
      if (!env.httpPost) throw new Error("missing httpPost adapter");
      return translateWithGoogle(texts, options, env);
    }
    if (options.provider === "google_web") {
      if (!env.httpPost) throw new Error("missing httpPost adapter");
      return translateWithGoogleWeb(texts, options, env);
    }
    if (!env.httpPost) throw new Error("missing httpPost adapter");
    return translateWithDeepL(texts, options, env);
  }

  async function translateWithDeepL(texts, options, env) {
    var endpoint = options.provider === "deepl_pro"
      ? "https://api.deepl.com/v2/translate"
      : "https://api-free.deepl.com/v2/translate";
    var payload = {
      text: texts,
      target_lang: options.translatorTarget,
      preserve_formatting: true,
      split_sentences: "nonewlines"
    };

    var response = await env.httpPost({
      url: endpoint,
      headers: {
        "Authorization": "DeepL-Auth-Key " + options.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      timeout: options.timeoutMs
    });
    assertHttpOk(response, "DeepL");

    var json = safeJsonParse(response.body);
    if (!json || !Array.isArray(json.translations)) throw new Error("DeepL response missing translations");
    return json.translations.map(function (item) { return item.text; });
  }

  async function translateWithGoogle(texts, options, env) {
    var response = await env.httpPost({
      url: "https://translation.googleapis.com/language/translate/v2?key=" + encodeURIComponent(options.apiKey),
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        q: texts,
        target: options.translatorTarget,
        format: "text"
      }),
      timeout: options.timeoutMs
    });
    assertHttpOk(response, "Google Translate");

    var json = safeJsonParse(response.body);
    var translations = json && json.data && json.data.translations;
    if (!Array.isArray(translations)) throw new Error("Google response missing translations");
    return translations.map(function (item) { return item.translatedText; });
  }

  async function translateWithGoogleWeb(texts, options, env) {
    var markedTexts = texts.map(function (text, index) {
      return "~" + index + "~" + text;
    });
    var response = await env.httpPost({
      url: "https://translate.google.com/translate_a/single?client=it&dt=qca&dt=t&dt=rmt&dt=bd&dt=rms&dt=sos&dt=md&dt=gt&dt=ld&dt=ss&dt=ex&otf=2&dj=1&hl=en&ie=UTF-8&oe=UTF-8&sl=auto&tl=" + encodeURIComponent(options.translatorTarget),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "GoogleTranslate/6.29.59279 (iPhone; iOS 15.4; en; iPhone14,2)"
      },
      body: "q=" + encodeURIComponent(markedTexts.join("\n")),
      timeout: options.timeoutMs
    });
    assertHttpOk(response, "Google Web Translate");

    var json = safeJsonParse(response.body);
    if (!json || !Array.isArray(json.sentences)) throw new Error("Google Web response missing translations");

    var merged = json.sentences.map(function (item) {
      return item && item.trans ? String(item.trans) : "";
    }).join("");
    var mapped = {};
    var markerPattern = /~(\d+)~\s*([\s\S]*?)(?=~\d+~|$)/g;
    var match;
    while ((match = markerPattern.exec(merged)) !== null) {
      mapped[Number(match[1])] = match[2].replace(/\s+/g, " ").trim();
    }

    var translations = texts.map(function (text, index) {
      return mapped[index] || text;
    });
    if (translations.some(function (translation, index) { return translation === texts[index]; })) {
      throw new Error("Google Web response did not preserve subtitle markers");
    }
    return translations;
  }

  function assertHttpOk(response, providerName) {
    var status = Number(response && response.status);
    if (status < 200 || status >= 300) {
      throw new Error(providerName + " HTTP " + (status || "unknown"));
    }
  }

  function safeJsonParse(input) {
    try {
      return JSON.parse(String(input || ""));
    } catch (error) {
      return null;
    }
  }

  function getCacheKey(options, text) {
    return [
      CACHE_PREFIX,
      options.provider,
      options.targetVariant,
      sha1(String(text || ""))
    ].join(".");
  }

  function decodeHtmlEntities(text) {
    return String(text || "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#(\d+);/g, function (_, code) {
        return String.fromCharCode(Number(code));
      });
  }

  function sha1(message) {
    function rotateLeft(n, s) {
      return (n << s) | (n >>> (32 - s));
    }

    function toHex(value) {
      var hex = "";
      for (var i = 7; i >= 0; i -= 1) {
        hex += ((value >>> (i * 4)) & 0x0f).toString(16);
      }
      return hex;
    }

    var utf8 = unescape(encodeURIComponent(message));
    var words = [];
    for (var i = 0; i < utf8.length; i += 1) {
      words[i >> 2] |= utf8.charCodeAt(i) << (24 - (i % 4) * 8);
    }
    words[utf8.length >> 2] |= 0x80 << (24 - (utf8.length % 4) * 8);
    words[(((utf8.length + 8) >> 6) << 4) + 15] = utf8.length * 8;

    var h0 = 0x67452301;
    var h1 = 0xefcdab89;
    var h2 = 0x98badcfe;
    var h3 = 0x10325476;
    var h4 = 0xc3d2e1f0;

    for (var block = 0; block < words.length; block += 16) {
      var w = new Array(80);
      for (i = 0; i < 16; i += 1) w[i] = words[block + i] || 0;
      for (i = 16; i < 80; i += 1) w[i] = rotateLeft(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

      var a = h0;
      var b = h1;
      var c = h2;
      var d = h3;
      var e = h4;

      for (i = 0; i < 80; i += 1) {
        var f;
        var k;
        if (i < 20) {
          f = (b & c) | ((~b) & d);
          k = 0x5a827999;
        } else if (i < 40) {
          f = b ^ c ^ d;
          k = 0x6ed9eba1;
        } else if (i < 60) {
          f = (b & c) | (b & d) | (c & d);
          k = 0x8f1bbcdc;
        } else {
          f = b ^ c ^ d;
          k = 0xca62c1d6;
        }

        var temp = (rotateLeft(a, 5) + f + e + k + w[i]) | 0;
        e = d;
        d = c;
        c = rotateLeft(b, 30);
        b = a;
        a = temp;
      }

      h0 = (h0 + a) | 0;
      h1 = (h1 + b) | 0;
      h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0;
    }

    return [h0, h1, h2, h3, h4].map(toHex).join("");
  }

  var api = {
    parseArgument: parseArgument,
    processResponse: processResponse,
    transformWebVtt: transformWebVtt,
    transformTtml: transformTtml,
    translateTexts: translateTexts,
    translateBatchExternal: translateBatchExternal,
    detectSubtitleFormat: detectSubtitleFormat,
    detectNoSubtitleManifest: detectNoSubtitleManifest,
    getCacheKey: getCacheKey,
    sha1: sha1,
    runLoon: runLoon
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (isLoonRuntime()) {
    runLoon();
  }
}());
