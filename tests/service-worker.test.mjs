import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import vm from "node:vm";

const [source, manifestSource] = await Promise.all([
  readFile(new URL("../sw.js", import.meta.url), "utf8"),
  readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"),
]);
const manifest = JSON.parse(manifestSource);
assert.equal(manifest.display, "standalone");
assert.equal(manifest.start_url, "./");
assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
await Promise.all(manifest.icons.map((icon) => access(new URL(`../${icon.src.replace(/^\.\//, "")}`, import.meta.url))));

const handlers = new Map();
let notification = null;
const context = {
  URL,
  Promise,
  console,
  caches: { open: async () => ({}), keys: async () => [] },
  fetch: async () => new Response("ok"),
  self: {
    location: { origin: "https://sechs6666code.github.io" },
    registration: {
      scope: "https://sechs6666code.github.io/chonglema/",
      async showNotification(title, options) { notification = { title, options }; },
    },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    skipWaiting: async () => {},
    addEventListener(type, handler) { handlers.set(type, handler); },
  },
};
vm.runInNewContext(source, context, { filename: "sw.js" });
for (const type of ["install", "activate", "fetch", "push", "notificationclick"]) {
  assert.equal(typeof handlers.get(type), "function", `${type} handler should be registered`);
}

let pushPromise;
handlers.get("push")({
  data: { json: () => ({ title: "测试提醒", body: "保持节奏", url: "./?source=test" }) },
  waitUntil(value) { pushPromise = value; },
});
await pushPromise;
assert.equal(notification.title, "测试提醒");
assert.equal(notification.options.body, "保持节奏");
assert.equal(notification.options.data.url, "./?source=test");

const now = new Date();
const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
context.indexedDB = {
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        objectStoreNames: { contains: () => true },
        transaction() {
          return {
            objectStore() {
              return {
                get() {
                  const getRequest = {};
                  queueMicrotask(() => {
                    getRequest.result = { key: "today-record", date: todayKey, recorded: true };
                    getRequest.onsuccess?.();
                  });
                  return getRequest;
                },
              };
            },
          };
        },
      };
      request.onsuccess?.();
    });
    return request;
  },
};

notification = null;
handlers.get("push")({
  data: { json: () => ({ title: "每日提醒", tag: "chonglema-daily" }) },
  waitUntil(value) { pushPromise = value; },
});
await pushPromise;
assert.equal(notification, null, "a daily reminder should stay silent when this device already recorded today");

handlers.get("push")({
  data: { json: () => ({ title: "测试提醒", tag: "chonglema-test" }) },
  waitUntil(value) { pushPromise = value; },
});
await pushPromise;
assert.equal(notification.title, "测试提醒", "test notifications should bypass daily suppression");

console.log("service worker tests passed");
