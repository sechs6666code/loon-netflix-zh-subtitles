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

console.log("service worker tests passed");
