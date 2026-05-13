const test = require("node:test");
const assert = require("node:assert/strict");
const subtitles = require("../scripts/netflix-zh-subtitles");

function makeEnv(overrides = {}) {
  const store = new Map();
  const notices = [];
  return {
    store,
    notices,
    logs: [],
    storeRead(key) {
      return store.has(key) ? store.get(key) : null;
    },
    storeWrite(key, value) {
      store.set(key, value);
      return true;
    },
    notify(subtitle, body) {
      notices.push({ subtitle, body });
    },
    log(message) {
      this.logs.push(message);
    },
    ...overrides
  };
}

const baseArgument = {
  provider: "deepl_free",
  apiKey: "test-key",
  targetVariant: "zh-Hans",
  debug: false
};

test("translates WebVTT cues and keeps timing lines", async () => {
  const env = makeEnv({
    async translateBatch(texts) {
      return texts.map((text) => text.replace("Hello", "你好").replace("world", "世界"));
    }
  });
  const body = [
    "WEBVTT",
    "",
    "1",
    "00:00:01.000 --> 00:00:03.000 align:center",
    "Hello <i>world</i>",
    ""
  ].join("\n");

  const result = await subtitles.processResponse({
    request: { url: "https://ipv4-c123.nflxvideo.net/?o=subtitle" },
    response: { status: 200, headers: { "Content-Type": "text/vtt", "Content-Length": "10" }, body },
    argument: baseArgument,
    env
  });

  assert.match(result.body, /WEBVTT/);
  assert.match(result.body, /00:00:01\.000 --> 00:00:03\.000 align:center/);
  assert.match(result.body, /你好 <i>世界<\/i>/);
  assert.equal(result.headers["Content-Length"], undefined);
});

test("translates TTML p nodes and preserves XML tags", async () => {
  const env = makeEnv({
    async translateBatch(texts) {
      return texts.map((text) => text.replace("Hello", "你好").replace("world", "世界"));
    }
  });
  const body = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:01.000" end="00:00:03.000">Hello <span style="italic">world</span></p></div></body></tt>';

  const result = await subtitles.processResponse({
    request: { url: "https://www.netflix.com/ttml.xml" },
    response: { status: 200, headers: { "Content-Type": "application/ttml+xml" }, body },
    argument: baseArgument,
    env
  });

  assert.match(result.body, /<p begin="00:00:01\.000" end="00:00:03\.000">/);
  assert.match(result.body, /你好 <span style="italic">世界<\/span>/);
});

test("skips cues that are already Chinese", async () => {
  let calls = 0;
  const env = makeEnv({
    async translateBatch(texts) {
      calls += texts.length;
      return texts;
    }
  });
  const body = [
    "WEBVTT",
    "",
    "00:00:01.000 --> 00:00:03.000",
    "已经是中文",
    ""
  ].join("\n");

  const result = await subtitles.processResponse({
    request: { url: "https://sub.netflix.com/title.vtt" },
    response: { status: 200, headers: { "Content-Type": "text/vtt" }, body },
    argument: baseArgument,
    env
  });

  assert.deepEqual(result, {});
  assert.equal(calls, 0);
});

test("falls back to original response when translation fails", async () => {
  const env = makeEnv({
    async translateBatch() {
      throw new Error("quota exceeded");
    }
  });
  const body = [
    "WEBVTT",
    "",
    "00:00:01.000 --> 00:00:03.000",
    "Hello",
    ""
  ].join("\n");

  const result = await subtitles.processResponse({
    request: { url: "https://sub.netflix.com/title.vtt" },
    response: { status: 200, headers: { "Content-Type": "text/vtt" }, body },
    argument: baseArgument,
    env
  });

  assert.deepEqual(result, {});
  assert.equal(env.notices.length, 1);
  assert.match(env.notices[0].subtitle, /翻译失败/);
});

test("uses persistent cache by provider, target and sha1 source text", async () => {
  let batches = 0;
  const env = makeEnv({
    async translateBatch(texts) {
      batches += 1;
      return texts.map(() => "你好");
    }
  });
  const options = subtitles.parseArgument(baseArgument, env);

  const first = await subtitles.translateTexts(["Hello", "Hello"], options, env);
  const second = await subtitles.translateTexts(["Hello"], options, env);

  assert.deepEqual(first, ["你好", "你好"]);
  assert.deepEqual(second, ["你好"]);
  assert.equal(batches, 1);
  assert.equal([...env.store.keys()].some((key) => key.includes("deepl_free.zh-Hans.")), true);
});

test("builds DeepL request mapping", async () => {
  let captured;
  const env = makeEnv({
    async httpPost(options) {
      captured = options;
      return {
        status: 200,
        body: JSON.stringify({ translations: [{ text: "你好" }] })
      };
    }
  });
  const options = subtitles.parseArgument({ ...baseArgument, provider: "deepl_pro", targetVariant: "zh-Hant" }, env);

  const translated = await subtitles.translateBatchExternal(["Hello"], options, env);

  assert.deepEqual(translated, ["你好"]);
  assert.equal(captured.url, "https://api.deepl.com/v2/translate");
  assert.equal(captured.headers.Authorization, "DeepL-Auth-Key test-key");
  assert.equal(JSON.parse(captured.body).target_lang, "ZH-HANT");
});

test("builds Google request mapping", async () => {
  let captured;
  const env = makeEnv({
    async httpPost(options) {
      captured = options;
      return {
        status: 200,
        body: JSON.stringify({ data: { translations: [{ translatedText: "你好 &amp; 世界" }] } })
      };
    }
  });
  const options = subtitles.parseArgument({ ...baseArgument, provider: "google_v2" }, env);

  const translated = await subtitles.translateBatchExternal(["Hello & world"], options, env);

  assert.deepEqual(translated, ["你好 &amp; 世界"]);
  assert.match(captured.url, /^https:\/\/translation\.googleapis\.com\/language\/translate\/v2\?key=test-key$/);
  assert.equal(JSON.parse(captured.body).target, "zh-CN");
});

test("builds Google Web request mapping without an API key", async () => {
  let captured;
  const env = makeEnv({
    async httpGet(options) {
      captured = options;
      return {
        status: 200,
        body: JSON.stringify([[["你好", "Hello", null, null]]])
      };
    }
  });
  const options = subtitles.parseArgument({ provider: "google_web", apiKey: "", targetVariant: "zh-Hans" }, env);

  const translated = await subtitles.translateBatchExternal(["Hello"], options, env);

  assert.deepEqual(translated, ["你好"]);
  assert.equal(options.provider, "google_web");
  assert.equal(options.apiKey, "");
  assert.match(captured.url, /^https:\/\/translate\.googleapis\.com\/translate_a\/single\?/);
  assert.match(captured.url, /client=gtx/);
  assert.match(captured.url, /tl=zh-CN/);
  assert.match(captured.url, /q=Hello/);
});

test("google_web processes subtitle responses without apiKey", async () => {
  const env = makeEnv({
    async httpGet() {
      return {
        status: 200,
        body: JSON.stringify([[["你好", "Hello", null, null]]])
      };
    }
  });
  const body = [
    "WEBVTT",
    "",
    "00:00:01.000 --> 00:00:03.000",
    "Hello",
    ""
  ].join("\n");

  const result = await subtitles.processResponse({
    request: { url: "https://sub.netflix.com/title.vtt" },
    response: { status: 200, headers: { "Content-Type": "text/vtt" }, body },
    argument: { provider: "google_web", apiKey: "", targetVariant: "zh-Hans" },
    env
  });

  assert.match(result.body, /你好/);
  assert.equal(env.notices.length, 0);
});

test("detects no-subtitle manifests and notifies without mutating response", async () => {
  const env = makeEnv();
  const result = await subtitles.processResponse({
    request: { url: "https://www.netflix.com/manifest" },
    response: { status: 200, headers: { "Content-Type": "application/json" }, body: '{"timedtexttracks":[]}' },
    argument: baseArgument,
    env
  });

  assert.deepEqual(result, {});
  assert.equal(env.notices.length, 1);
  assert.match(env.notices[0].subtitle, /没有可处理的字幕轨/);
});

test("sha1 implementation matches known vector", () => {
  assert.equal(subtitles.sha1("abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
});

test("accepts Loon arg1 style arguments and early TTML detection", () => {
  const env = makeEnv();
  const options = subtitles.parseArgument({
    arg1: "google_v2",
    arg2: "google-key",
    arg3: "zh-Hant",
    arg4: "true"
  }, env);

  assert.equal(options.provider, "google_v2");
  assert.equal(options.apiKey, "google-key");
  assert.equal(options.targetVariant, "zh-Hant");
  assert.equal(options.debug, true);
  assert.equal(subtitles.detectSubtitleFormat('<tt xmlns="http://www.w3.org/ns/ttml"><body>', "https://www.netflix.com/sub.xml", {}), "ttml");
});
