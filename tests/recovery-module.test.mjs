import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const source = fs.readFileSync(new URL("../assets/recovery-module.js", import.meta.url), "utf8");
const now = new Date();
const release = new Date(now.getTime() - (56 * 60 * 60 * 1000));
const dateKey = [
  release.getFullYear(),
  String(release.getMonth() + 1).padStart(2, "0"),
  String(release.getDate()).padStart(2, "0"),
].join("-");

const dom = new JSDOM(
  "<!doctype html><html><body><main><p class=\"month-summary\">本月摘要</p><section class=\"history\"></section></main></body></html>",
  {
    url: "https://example.test/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  }
);

const { window } = dom;
window.matchMedia = () => ({
  matches: true,
  addEventListener() {},
  removeEventListener() {},
});
window.navigator.vibrate = () => true;
window.localStorage.setItem("did-you-v1", JSON.stringify({ [dateKey]: "yes" }));
window.eval(source);

await new Promise((resolve) => window.setTimeout(resolve, 40));

const module = window.document.querySelector("#recovery-vault");
assert.ok(module, "recovery module should mount after the monthly summary");
assert.equal(module.previousElementSibling.className, "month-summary");

const progress = Number(module.querySelector(".recovery-percent-number").textContent);
assert.ok(progress >= 60 && progress <= 76, `56-hour progress should be in the expected non-linear range, got ${progress}`);
assert.match(module.querySelector(".recovery-status-pill").textContent, /明显恢复/);

const summary = module.querySelector(".recovery-summary");
summary.click();
assert.equal(summary.getAttribute("aria-expanded"), "true");
assert.ok(module.classList.contains("is-expanded"));

module.querySelector(".recovery-edit-button").click();
const editor = window.document.querySelector("#recovery-editor");
assert.ok(editor.classList.contains("is-open"));

const manualTime = new Date(now.getTime() - (12 * 60 * 60 * 1000));
const offset = manualTime.getTimezoneOffset() * 60_000;
editor.querySelector("input").value = new Date(manualTime.getTime() - offset).toISOString().slice(0, 16);
editor.querySelector(".recovery-editor-save").click();

const stored = JSON.parse(window.localStorage.getItem("chonglema-recovery-v1"));
assert.equal(stored.source, "manual");
assert.ok(Math.abs(stored.timestamp - manualTime.getTime()) < 61_000);
assert.ok(!editor.classList.contains("is-open"));
assert.match(module.querySelector(".recovery-status-pill").textContent, /恢复启动/);

dom.window.close();
console.log("recovery module interaction tests passed");
