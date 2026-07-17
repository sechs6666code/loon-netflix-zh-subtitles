import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const source = await readFile(new URL("../assets/pwa-module.js", import.meta.url), "utf8");
const dom = new JSDOM(`<!doctype html><body>
  <div id="root"><div class="saved">今天已经记下 · 没冲</div><button class="leaderboard-inline-entry">排行榜</button><section class="stats"></section></div>
</body>`, {
  url: "https://sechs6666code.github.io/chonglema/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const { window } = dom;
const requests = [];
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test-subscription",
  keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
  toJSON() { return { endpoint: this.endpoint, keys: this.keys }; },
  async unsubscribe() { return true; },
};
const registration = {
  pushManager: {
    current: null,
    async getSubscription() { return this.current; },
    async subscribe(options) {
      assert.equal(options.userVisibleOnly, true);
      this.current = subscription;
      return subscription;
    },
  },
};
let privateState = null;
const privateDb = {
  objectStoreNames: { contains: () => true },
  transaction() {
    return {
      objectStore() {
        return { put(value) { privateState = value; } };
      },
    };
  },
};
window.indexedDB = {
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = privateDb;
      request.onsuccess?.();
    });
    return request;
  },
};

Object.defineProperty(window.navigator, "serviceWorker", {
  configurable: true,
  value: {
    ready: Promise.resolve(registration),
    async register(path, options) {
      assert.equal(path, "./sw.js");
      assert.equal(options.scope, "./");
      return registration;
    },
  },
});
Object.defineProperty(window.navigator, "platform", { configurable: true, value: "Linux x86_64" });
window.PushManager = function PushManager() {};
window.Notification = { permission: "granted", async requestPermission() { return "granted"; } };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.CHONGLEMA_LEADERBOARD_API = "https://api.example.test";
const today = new Date();
const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
window.localStorage.setItem("did-you-v1", JSON.stringify({ [todayKey]: "no" }));
window.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), options });
  if (String(url).endsWith("/v1/push/config")) {
    return new Response(JSON.stringify({ publicKey: "BLKjL3ehQgBt0WZWfkPWCtNSKTfyCaRK_DL7wTz6l1Sk6knprnSmUF9TUv34ISNfFHILqguIQgK_aPzCJjg_uJA" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ saved: true, sent: true, deleted: true }), {
    headers: { "Content-Type": "application/json" },
  });
};

window.eval(source);
await new Promise((resolve) => setTimeout(resolve, 120));

const savedStatus = window.document.querySelector(".saved");
assert.equal(savedStatus.getAttribute("role"), "status");
assert.equal(savedStatus.getAttribute("aria-live"), "polite");
assert.equal(savedStatus.getAttribute("aria-hidden"), "true", "a visually hidden save toast should not announce stale text");
assert.equal(privateState?.date, todayKey);
assert.equal(privateState?.recorded, true, "today's private record state should be mirrored without uploading the record");

const entry = window.document.querySelector(".pwa-reminder-entry");
assert.ok(entry, "the reminder entry should mount");
assert.equal(entry.nextElementSibling?.className, "leaderboard-inline-entry", "the reminder entry should stay above the leaderboard without disturbing its anchor");

entry.click();
await new Promise((resolve) => setTimeout(resolve, 10));
const dialog = window.document.querySelector("#pwa-reminder-dialog");
assert.equal(dialog.hidden, false);
const time = dialog.querySelector("#pwa-reminder-time");
assert.equal(time.type, "text", "the reminder time should use an explicit 24-hour display");
assert.equal(time.inputMode, "numeric");
time.value = "2045";
time.dispatchEvent(new window.Event("input", { bubbles: true }));
assert.equal(time.value, "20:45", "four numeric digits should format into a mobile-friendly 24-hour time");
time.value = "20:45";
dialog.querySelector("[data-pwa-enable]").click();
await new Promise((resolve) => setTimeout(resolve, 30));

const saveRequest = requests.find((request) => request.url.endsWith("/v1/push/subscription") && request.options.method === "POST");
assert.ok(saveRequest, "enabling should save the push subscription");
const savedPayload = JSON.parse(saveRequest.options.body);
assert.equal(savedPayload.reminderTime, "20:45");
assert.equal(savedPayload.subscription.endpoint, subscription.endpoint);
assert.equal(entry.classList.contains("is-enabled"), true);
assert.equal(entry.querySelector("[data-pwa-entry-time]").textContent, "20:45");
assert.match(dialog.querySelector("[data-pwa-message]").textContent, /15 分钟/);
assert.match(dialog.querySelector(".pwa-privacy-note").textContent, /本机会在今天已记录时静默当天提醒/);

const savesBeforeInvalidTime = requests.filter((request) => request.url.endsWith("/v1/push/subscription") && request.options.method === "POST").length;
time.value = "25:90";
dialog.querySelector("[data-pwa-enable]").click();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.match(dialog.querySelector("[data-pwa-message]").textContent, /00:00—23:59/);
assert.equal(
  requests.filter((request) => request.url.endsWith("/v1/push/subscription") && request.options.method === "POST").length,
  savesBeforeInvalidTime,
  "invalid 24-hour times should not be uploaded",
);

dialog.querySelector("[data-pwa-test]").click();
await new Promise((resolve) => setTimeout(resolve, 20));
assert.ok(requests.some((request) => request.url.endsWith("/v1/push/test")), "the test button should call the live delivery endpoint");

const deniedDom = new JSDOM(`<!doctype html><body><div id="root"><section class="stats"></section></div></body>`, {
  url: "https://sechs6666code.github.io/chonglema/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const deniedWindow = deniedDom.window;
Object.defineProperty(deniedWindow.navigator, "serviceWorker", {
  configurable: true,
  value: {
    ready: Promise.resolve(registration),
    async register() { return registration; },
  },
});
Object.defineProperty(deniedWindow.navigator, "platform", { configurable: true, value: "Linux x86_64" });
deniedWindow.PushManager = function PushManager() {};
deniedWindow.Notification = { permission: "denied", async requestPermission() { return "denied"; } };
deniedWindow.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
deniedWindow.CHONGLEMA_LEADERBOARD_API = "https://api.example.test";
deniedWindow.fetch = window.fetch;
deniedWindow.eval(source);
await new Promise((resolve) => setTimeout(resolve, 20));
deniedWindow.document.querySelector(".pwa-reminder-entry").click();
await new Promise((resolve) => setTimeout(resolve, 20));
const deniedDialog = deniedWindow.document.querySelector("#pwa-reminder-dialog");
assert.equal(deniedDialog.querySelector("[data-pwa-enable]").disabled, true);
assert.match(deniedDialog.querySelector("[data-pwa-enable]").textContent, /恢复通知权限/);
assert.equal(deniedDialog.querySelector("[data-pwa-permission-help]").hidden, false);
assert.match(deniedDialog.querySelector("[data-pwa-permission-help]").textContent, /网站设置/);

console.log("pwa module tests passed");
