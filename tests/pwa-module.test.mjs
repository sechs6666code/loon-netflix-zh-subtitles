import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const source = await readFile(new URL("../assets/pwa-module.js", import.meta.url), "utf8");
const dom = new JSDOM(`<!doctype html><body>
  <div id="root"><button class="leaderboard-inline-entry">排行榜</button><section class="stats"></section></div>
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
await new Promise((resolve) => setTimeout(resolve, 10));

const entry = window.document.querySelector(".pwa-reminder-entry");
assert.ok(entry, "the reminder entry should mount");
assert.equal(entry.nextElementSibling?.className, "leaderboard-inline-entry", "the reminder entry should stay above the leaderboard without disturbing its anchor");

entry.click();
await new Promise((resolve) => setTimeout(resolve, 10));
const dialog = window.document.querySelector("#pwa-reminder-dialog");
assert.equal(dialog.hidden, false);
const time = dialog.querySelector("#pwa-reminder-time");
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

dialog.querySelector("[data-pwa-test]").click();
await new Promise((resolve) => setTimeout(resolve, 20));
assert.ok(requests.some((request) => request.url.endsWith("/v1/push/test")), "the test button should call the live delivery endpoint");

console.log("pwa module tests passed");
