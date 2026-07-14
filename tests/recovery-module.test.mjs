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
assert.ok(module.querySelector(".recovery-liquid-caustics"), "liquid refraction layer should render");
assert.ok(module.querySelector(".recovery-glass-glint"), "glass highlight layer should render");
assert.ok(module.querySelector(".recovery-edge-refraction"), "glass edge refraction should render");
assert.equal(module.querySelectorAll(".recovery-liquid-chamber").length, 2, "left and right chambers should render independently");
assert.ok(module.querySelector(".recovery-motion-hint"), "one-time tilt hint should render");

const reducedMotionToggle = module.querySelector(".recovery-motion-toggle");
assert.ok(reducedMotionToggle, "motion control should render");
assert.equal(reducedMotionToggle.disabled, true, "motion control should respect reduced-motion settings");
assert.equal(reducedMotionToggle.tagName, "BUTTON", "the full motion row should be the switch target");
assert.match(module.querySelector(".recovery-motion-status").textContent, /减少动态效果/);
assert.equal(module.querySelectorAll(".recovery-data-row").length, 3, "recovery details should use a three-segment data grid");
assert.ok(module.querySelector("details.recovery-disclaimer"), "trend disclaimer should be collapsible");

const progress = Number(module.querySelector(".recovery-percent-number").textContent);
assert.ok(progress >= 60 && progress <= 76, `56-hour progress should be in the expected non-linear range, got ${progress}`);
assert.match(module.querySelector(".recovery-status-pill").textContent, /明显恢复|接近平时水平/);
assert.ok(module.querySelectorAll(".recovery-particle").length >= 3, "progress should render layered particles");
assert.ok(
  new Set([...module.querySelectorAll(".recovery-particle")].map((particle) => particle.style.getPropertyValue("--particle-scale"))).size >= 3,
  "particles should use three visual depths"
);

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

module.querySelector(".recovery-edit-button").click();
const stableTime = new Date(now.getTime() - (6 * 24 * 60 * 60 * 1000));
editor.querySelector("input").value = new Date(stableTime.getTime() - offset).toISOString().slice(0, 16);
editor.querySelector(".recovery-editor-save").click();
await new Promise((resolve) => window.setTimeout(resolve, 30));
assert.ok(module.classList.contains("is-stable"), "six days should enter the stable interval");
assert.equal(module.querySelector(".recovery-percent-number").textContent, "100");
assert.ok(
  Number.parseFloat(module.style.getPropertyValue("--recovery-level")) <= 94,
  "100 percent should keep a visible air gap instead of visually overfilling"
);

dom.window.close();

const motionDom = new JSDOM(
  "<!doctype html><html><body><main><button class=\"answer yes\">冲了</button><button class=\"answer no\">没冲</button><p class=\"month-summary\">本月摘要</p><section class=\"history\"></section></main></body></html>",
  {
    url: "https://example.test/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  }
);

const motionWindow = motionDom.window;
const orientationMock = {
  angle: 0,
  addEventListener() {},
  removeEventListener() {},
};
Object.defineProperty(motionWindow.screen, "orientation", {
  configurable: true,
  value: orientationMock,
});
motionWindow.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
motionWindow.navigator.vibrate = () => true;
let permissionRequests = 0;
class MockDeviceOrientationEvent extends motionWindow.Event {}
MockDeviceOrientationEvent.requestPermission = async () => {
  permissionRequests += 1;
  return "granted";
};
Object.defineProperty(motionWindow, "DeviceOrientationEvent", {
  configurable: true,
  value: MockDeviceOrientationEvent,
});
motionWindow.localStorage.setItem("did-you-v1", JSON.stringify({ [dateKey]: "yes" }));
motionWindow.eval(source);
await new Promise((resolve) => motionWindow.setTimeout(resolve, 50));

const motionModule = motionWindow.document.querySelector("#recovery-vault");
const motionToggle = motionModule.querySelector(".recovery-motion-toggle");
motionToggle.click();
await new Promise((resolve) => motionWindow.setTimeout(resolve, 30));
assert.equal(permissionRequests, 1, "motion permission should only be requested after a user gesture");
assert.equal(motionToggle.getAttribute("aria-checked"), "true");
assert.ok(motionModule.classList.contains("has-motion"));

const dispatchOrientation = (beta, gamma) => {
  const event = new motionWindow.Event("deviceorientation");
  Object.defineProperties(event, {
    beta: { value: beta },
    gamma: { value: gamma },
  });
  motionWindow.dispatchEvent(event);
};
dispatchOrientation(0, 0);
for (let index = 0; index < 7; index += 1) dispatchOrientation(0, 0);
dispatchOrientation(0, 24);
await new Promise((resolve) => motionWindow.setTimeout(resolve, 220));
const portraitTilt = Number.parseFloat(motionModule.style.getPropertyValue("--recovery-liquid-tilt"));
const portraitShift = Number.parseFloat(motionModule.style.getPropertyValue("--recovery-motion-x"));
assert.ok(portraitTilt < 0, "the liquid surface should counter-rotate against a positive portrait tilt");
assert.ok(portraitShift > 0, "the liquid mass should still shift toward the physically lower side");
assert.match(source, /const MOTION_TILT_GAIN = 1\.2;/, "the liquid should use an intentionally exaggerated tilt gain");
assert.match(source, /const MOTION_TILT_LIMIT = 32;/, "the liquid should allow a visibly wide tilt range");
assert.doesNotMatch(
  source,
  /deltaSide \* MOTION_TILT_GAIN \* mobility/,
  "recovery progress should not suppress the liquid surface angle"
);

const calibrateButton = motionModule.querySelector(".recovery-calibrate-button");
assert.equal(calibrateButton.disabled, false, "calibration should be available while motion is enabled");

motionToggle.click();
orientationMock.angle = 90;
motionToggle.click();
await new Promise((resolve) => motionWindow.setTimeout(resolve, 30));
for (let index = 0; index < 7; index += 1) dispatchOrientation(0, 0);
dispatchOrientation(20, 0);
await new Promise((resolve) => motionWindow.setTimeout(resolve, 220));
const landscapeTilt = Number.parseFloat(motionModule.style.getPropertyValue("--recovery-liquid-tilt"));
assert.ok(landscapeTilt < 0, "landscape orientation should preserve counter-rotation direction");
assert.equal(permissionRequests, 2, "each iOS re-enable should request permission from a user gesture");

motionWindow.document.querySelector(".answer.yes").click();
assert.ok(motionModule.classList.contains("is-releasing"), "release check-in should trigger drain feedback");
motionWindow.document.querySelector(".answer.no").click();
assert.ok(motionModule.classList.contains("is-affirming"), "no-release check-in should trigger a calm pulse");

motionToggle.click();
assert.equal(motionToggle.getAttribute("aria-checked"), "false");
assert.ok(!motionModule.classList.contains("has-motion"));

motionDom.window.close();
console.log("recovery module interaction tests passed");
