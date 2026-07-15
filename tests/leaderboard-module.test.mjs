import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="root"><main class="shell"><header class="topbar"><div class="menu-wrap"></div></header></main></div>
</body></html>`, {
  url: "https://sechs6666code.github.io/chonglema/",
  pretendToBeVisual: true,
});

const { window } = dom;
Object.defineProperties(globalThis, {
  window: { value: window, configurable: true },
  document: { value: window.document, configurable: true },
  localStorage: { value: window.localStorage, configurable: true },
  navigator: { value: window.navigator, configurable: true },
  MutationObserver: { value: window.MutationObserver, configurable: true },
  requestAnimationFrame: { value: window.requestAnimationFrame.bind(window), configurable: true },
});
window.navigator.vibrate = () => true;
window.localStorage.setItem("did-you-v1", JSON.stringify({
  "2026-07-15": "no",
  "2026-07-14": "no",
}));
window.CHONGLEMA_LEADERBOARD_API = "https://leaderboard.example.test";

let savedPayload = null;
let published = false;
let removed = false;
const mockFetch = async (url, options = {}) => {
  if (options.method === "POST") {
    savedPayload = JSON.parse(options.body);
    published = true;
    return Response.json({ profile: savedPayload });
  }
  if (options.method === "DELETE") {
    const payload = JSON.parse(options.body);
    assert.equal(payload.ownerToken, savedPayload.ownerToken);
    published = false;
    removed = true;
    return Response.json({ deleted: true });
  }
  const entry = published
    ? [{ publicId: savedPayload.publicId, days: savedPayload.ninjaDays, rank: 1, updatedAt: new Date().toISOString() }]
    : [];
  return Response.json({ ninja: entry, rush: [], generatedAt: new Date().toISOString() });
};
Object.defineProperty(globalThis, "fetch", { value: mockFetch, configurable: true });
window.fetch = mockFetch;

await import(new URL(`../assets/leaderboard-module.js?test=${Date.now()}`, import.meta.url));
await new Promise((resolve) => window.setTimeout(resolve, 25));

const trigger = window.document.querySelector(".leaderboard-trigger");
assert.ok(trigger, "the leaderboard trigger should mount in the top bar");
trigger.click();
await new Promise((resolve) => window.setTimeout(resolve, 25));

const overlay = window.document.querySelector("#leaderboard-dialog");
assert.equal(overlay.hidden, false, "clicking the trigger should open the leaderboard dialog");
const input = overlay.querySelector(".leaderboard-id-field input");
input.value = "忍者007";
input.dispatchEvent(new window.Event("input", { bubbles: true }));
overlay.querySelector('[data-visibility="public"]').click();
overlay.querySelector(".leaderboard-save").click();
await new Promise((resolve) => window.setTimeout(resolve, 80));

assert.ok(savedPayload, "saving a public profile should call the shared API");
assert.equal(savedPayload.publicId, "忍者007");
assert.equal(savedPayload.isPublic, true);
assert.equal(typeof savedPayload.ownerToken, "string");
assert.ok(savedPayload.ownerToken.length >= 24);
assert.match(overlay.textContent, /#1/);
assert.match(overlay.textContent, /忍者007/);

overlay.querySelector('[data-visibility="private"]').click();
overlay.querySelector(".leaderboard-save").click();
await new Promise((resolve) => window.setTimeout(resolve, 80));
assert.equal(removed, true, "switching to private should delete the shared profile");
assert.match(overlay.textContent, /只保存在本机/);

dom.window.close();
console.log("leaderboard module interaction tests passed");
