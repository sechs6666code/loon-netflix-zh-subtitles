import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="root"><main class="shell">
    <header class="topbar"><div class="menu-wrap"></div></header>
    <section class="hero"></section>
    <section class="stats"></section>
  </main></div>
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
let copiedRecoveryCode = "";
Object.defineProperty(window.navigator, "clipboard", {
  value: { writeText: async (value) => { copiedRecoveryCode = value; } },
  configurable: true,
});
window.localStorage.setItem("did-you-v1", JSON.stringify({
  "2026-07-15": "no",
  "2026-07-14": "no",
  "2026-07-13": "yes",
  "2026-07-12": "yes",
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
  const ninja = published
    ? [{ publicId: savedPayload.publicId, days: savedPayload.ninjaDays, rank: 1, updatedAt: new Date().toISOString() }]
    : [];
  const rush = published
    ? [{ publicId: savedPayload.publicId, days: savedPayload.rushDays, rank: 1, updatedAt: new Date().toISOString() }]
    : [];
  return Response.json({ ninja, rush, generatedAt: new Date().toISOString() });
};
Object.defineProperty(globalThis, "fetch", { value: mockFetch, configurable: true });
window.fetch = mockFetch;

await import(new URL(`../assets/leaderboard-module.js?test=${Date.now()}`, import.meta.url));
await new Promise((resolve) => window.setTimeout(resolve, 25));

const trigger = window.document.querySelector(".leaderboard-trigger");
assert.ok(trigger, "the leaderboard trigger should mount in the top bar");
const inlineEntry = window.document.querySelector(".leaderboard-inline-entry");
const stats = window.document.querySelector(".stats");
assert.ok(inlineEntry, "a prominent leaderboard entry should mount in the main flow");
assert.equal(inlineEntry.nextElementSibling, stats, "the main entry should sit directly above the stats");
assert.match(inlineEntry.getAttribute("aria-label"), /历史最长忍住 2 天/);
assert.match(inlineEntry.getAttribute("aria-label"), /历史最长连冲 2 天/);
assert.match(inlineEntry.textContent, /双榜排行/);
assert.match(inlineEntry.textContent, /忍住/);
assert.match(inlineEntry.textContent, /连冲/);

inlineEntry.remove();
await new Promise((resolve) => window.setTimeout(resolve, 25));
assert.equal(inlineEntry.nextElementSibling, stats, "the main entry should remount after a React-style rerender");

inlineEntry.click();
await new Promise((resolve) => window.setTimeout(resolve, 25));

const overlay = window.document.querySelector("#leaderboard-dialog");
assert.equal(overlay.hidden, false, "clicking the trigger should open the leaderboard dialog");
assert.equal(
  overlay.querySelector(".leaderboard-local-scores").nextElementSibling,
  overlay.querySelector(".leaderboard-board-card"),
  "the leaderboard should appear immediately above milestones",
);
assert.equal(
  overlay.querySelector(".leaderboard-board-card").nextElementSibling,
  overlay.querySelector(".leaderboard-milestones"),
  "milestones should follow the leaderboard",
);
const input = overlay.querySelector(".leaderboard-id-field input");
input.value = "忍者007";
input.dispatchEvent(new window.Event("input", { bubbles: true }));
overlay.querySelector('[data-visibility="public"]').click();
overlay.querySelector(".leaderboard-save").click();
await new Promise((resolve) => window.setTimeout(resolve, 80));

assert.ok(savedPayload, "saving a public profile should call the shared API");
assert.equal(savedPayload.publicId, "忍者007");
assert.equal(savedPayload.isPublic, true);
assert.equal(savedPayload.ninjaDays, 2);
assert.equal(savedPayload.rushDays, 2, "historical longest streaks should let one profile join both boards");
assert.equal(typeof savedPayload.ownerToken, "string");
assert.ok(savedPayload.ownerToken.length >= 24);
assert.match(overlay.textContent, /#1/);
assert.match(overlay.textContent, /忍者007/);
overlay.querySelector('[data-tab="rush"]').click();
assert.match(overlay.querySelector("[data-leaderboard-board-label]").textContent, /历史最长连冲/);
assert.match(overlay.querySelector("[data-leaderboard-my-rank]").textContent, /#1/);
overlay.querySelector('[data-tab="ninja"]').click();
assert.equal(overlay.querySelectorAll(".leaderboard-badge").length, 10, "both streak types should render five milestone badges");

overlay.querySelector("[data-recovery-copy]").click();
await new Promise((resolve) => window.setTimeout(resolve, 10));
assert.match(copiedRecoveryCode, /^CLM1\./, "the recovery action should copy a portable recovery code");
overlay.querySelector("[data-recovery-open]").click();
const recoveryInput = overlay.querySelector("#leaderboard-recovery-code");
recoveryInput.value = copiedRecoveryCode;
overlay.querySelector("[data-recovery-verify]").click();
assert.equal(overlay.querySelector(".leaderboard-recovery-candidate").hidden, false);
assert.match(overlay.querySelector(".leaderboard-recovery-candidate").textContent, /忍者007/);

window.localStorage.setItem("chonglema-leaderboard-rank-snapshot-v1", JSON.stringify({
  identity: "忍者007",
  date: "2026-07-14",
  previous: { ninja: null, rush: null },
  current: { ninja: 3, rush: null },
}));
overlay.querySelector(".leaderboard-refresh").click();
await new Promise((resolve) => window.setTimeout(resolve, 30));
assert.match(overlay.querySelector("[data-leaderboard-rank-insight]").textContent, /今日上升 2 名/);

overlay.querySelector('[data-visibility="private"]').click();
overlay.querySelector(".leaderboard-save").click();
await new Promise((resolve) => window.setTimeout(resolve, 80));
assert.equal(removed, true, "switching to private should delete the shared profile");
assert.match(overlay.textContent, /只保存在本机/);

overlay.querySelector(".leaderboard-close").click();
assert.equal(window.document.activeElement, inlineEntry, "closing the dialog should restore focus to its opener");

dom.window.close();
console.log("leaderboard module interaction tests passed");
