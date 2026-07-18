import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const [source, indexSource, serviceWorkerSource] = await Promise.all([
  readFile(new URL("../assets/gsap-motion.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../sw.js", import.meta.url), "utf8"),
]);
await Promise.all([
  access(new URL("../assets/gsap.min.js", import.meta.url)),
  access(new URL("../assets/Flip.min.js", import.meta.url)),
  access(new URL("../assets/ScrollTrigger.min.js", import.meta.url)),
  access(new URL("../assets/gsap-motion.css", import.meta.url)),
]);
assert.ok(indexSource.indexOf("gsap.min.js") < indexSource.indexOf("gsap-motion.js"));
assert.ok(indexSource.indexOf("Flip.min.js") < indexSource.indexOf("gsap-motion.js"));
assert.ok(indexSource.indexOf("ScrollTrigger.min.js") < indexSource.indexOf("gsap-motion.js"));
assert.match(serviceWorkerSource, /gsap\.min\.js/);
assert.match(serviceWorkerSource, /Flip\.min\.js/);
assert.match(serviceWorkerSource, /ScrollTrigger\.min\.js/);
assert.match(serviceWorkerSource, /gsap-motion\.js/);

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="root">
    <section class="hero">
      <h1>今天，冲了吗？</h1>
      <p class="subline">如实记录就好。</p>
      <div class="check-actions">
        <button class="answer no"><span class="answer-icon"><svg><path d="m5 12 4 4 10-10"></path></svg></span><span><b>没冲</b></span></button>
      </div>
    </section>
    <div class="progress-ring"><svg><circle class="ring-value" style="stroke-dashoffset:25"></circle></svg><strong>12<small>天</small></strong></div>
    <section class="stats"><article class="stat-card">统计</article></section>
    <section class="history">历史</section>
  </div>
  <strong data-leaderboard-inline-ninja>2</strong>
  <div class="leaderboard-list"><article data-flip-id="profile-a">A</article></div>
  <div class="leaderboard-overlay" hidden>
    <section class="leaderboard-panel"><header>排行榜</header></section>
  </div>
</body></html>`, {
  url: "https://example.test/",
  runScripts: "dangerously",
  pretendToBeVisual: true,
});

const { window } = dom;
const calls = [];
const finishLater = (vars = {}) => {
  window.setTimeout(() => {
    vars.onUpdate?.();
    vars.onComplete?.();
  }, 0);
};
const tween = () => ({ kill() { calls.push({ type: "kill" }); } });
const applyObjectValues = (target, vars) => {
  if (!target || target.nodeType || Array.isArray(target)) return;
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === "number" && key !== "duration") target[key] = value;
  }
};
const timeline = (options = {}) => {
  const instance = {
    fromTo(target, fromVars, toVars, position) {
      calls.push({ type: "timeline-fromTo", target, fromVars, toVars, position });
      return instance;
    },
    to(target, vars, position) {
      calls.push({ type: "timeline-to", target, vars, position });
      return instance;
    },
    kill() {},
  };
  window.setTimeout(() => options.onComplete?.(), 5);
  return instance;
};

window.gsap = {
  registerPlugin(...plugins) { plugins.forEach((plugin) => calls.push({ type: "register", plugin })); },
  to(target, vars) {
    calls.push({ type: "to", target, vars });
    applyObjectValues(target, vars);
    finishLater(vars);
    return tween();
  },
  fromTo(target, fromVars, toVars) {
    calls.push({ type: "fromTo", target, fromVars, toVars });
    applyObjectValues(target, toVars);
    finishLater(toVars);
    return tween();
  },
  set(target, vars) {
    calls.push({ type: "set", target, vars });
    const targets = Array.isArray(target) ? target : [target];
    targets.forEach((item) => {
      if (item?.style && Number.isFinite(Number(vars.strokeDashoffset))) {
        item.style.strokeDashoffset = String(vars.strokeDashoffset);
      }
    });
  },
  timeline,
  killTweensOf(target) { calls.push({ type: "killTweensOf", target }); },
  matchMedia() {
    return {
      add(conditions, handler) {
        calls.push({ type: "matchMedia", conditions });
        return handler({ conditions: { reduceMotion: false, fullMotion: true } });
      },
      revert() {},
    };
  },
};
window.Flip = {
  getState(targets, options) {
    calls.push({ type: "flip-getState", targets, options });
    return { targets };
  },
  from(state, vars) {
    calls.push({ type: "flip-from", state, vars });
    finishLater(vars);
    return tween();
  },
};
window.ScrollTrigger = {
  batch(targets, vars) {
    const elements = Array.from(targets);
    calls.push({ type: "scroll-batch", targets: elements, vars });
    window.setTimeout(() => vars.onEnter?.(elements, []), 0);
    return elements.map(() => ({ kill() { calls.push({ type: "scroll-kill" }); } }));
  },
  refresh() { calls.push({ type: "scroll-refresh" }); },
};
window.matchMedia = (query) => ({
  media: query,
  matches: query.includes("no-preference"),
  addEventListener() {},
  removeEventListener() {},
});

const answer = window.document.querySelector(".answer");
answer.addEventListener("click", () => {
  answer.classList.add("selected");
  answer.closest(".hero").classList.add("completed", "no");
  answer.closest(".hero").querySelector("h1").textContent = "今日已记录";
});

window.eval(source);
await new Promise((resolve) => window.setTimeout(resolve, 70));
assert.equal(window.document.documentElement.dataset.gsapMotion, "full");
assert.ok(calls.some((call) => call.type === "register" && call.plugin === window.Flip));
assert.ok(calls.some((call) => call.type === "register" && call.plugin === window.ScrollTrigger));
assert.ok(calls.some((call) => call.type === "matchMedia" && "reduceMotion" in call.conditions));
assert.ok(calls.some((call) => call.type === "fromTo" && call.target === window.document.querySelector(".ring-value")));
assert.equal(window.ChonglemaGsapMotion.usesScrollTrigger, true);
assert.ok(calls.some((call) => call.type === "scroll-batch"));
assert.equal(window.document.querySelector(".stat-card").dataset.gsapScroll, "entered");
assert.ok(window.document.querySelector(".gsap-scroll-progress"));

answer.click();
await new Promise((resolve) => window.setTimeout(resolve, 80));
assert.ok(calls.some((call) => call.type === "timeline-fromTo" && call.target === answer));
assert.equal(window.document.querySelectorAll(".gsap-checkin-wash").length, 0, "the check-in wash should clean itself up");

const leaderboardNumber = window.document.querySelector("[data-leaderboard-inline-ninja]");
leaderboardNumber.firstChild.data = "7";
await new Promise((resolve) => window.setTimeout(resolve, 45));
assert.equal(leaderboardNumber.textContent, "7");
assert.ok(calls.some((call) => call.type === "to" && call.target?.current === 7));

const list = window.document.querySelector(".leaderboard-list");
const flipState = window.ChonglemaGsapMotion.captureLeaderboard(list);
list.innerHTML = '<article data-flip-id="profile-a">A2</article><article data-flip-id="profile-b">B</article>';
window.ChonglemaGsapMotion.playLeaderboardFlip(flipState, list);
assert.ok(calls.some((call) => call.type === "flip-getState"));
assert.ok(calls.some((call) => call.type === "flip-from"));

const overlay = window.document.querySelector(".leaderboard-overlay");
overlay.hidden = false;
overlay.classList.add("is-open");
await new Promise((resolve) => window.setTimeout(resolve, 35));
assert.ok(calls.some((call) => call.type === "fromTo" && call.target === overlay.querySelector(".leaderboard-panel")));

window.dispatchEvent(new window.Event("pagehide"));
await new Promise((resolve) => window.setTimeout(resolve, 20));
assert.equal(window.document.querySelector(".gsap-scroll-progress"), null);
dom.window.close();
console.log("GSAP motion interaction tests passed");
