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
assert.match(source, /gsap-cinematic-refraction/);
assert.match(source, /gsap-cinematic-veil/);
assert.doesNotMatch(source, /gsap-cinematic-(?:glyphs|lens|copy|orbits)|DAILY RITUAL|CHONG LE MEI/);

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="root">
    <header class="topbar"></header>
    <section class="hero">
      <p class="date">7月18日星期六</p>
      <h1>今天，冲了吗？</h1>
      <p class="subline">如实记录就好。</p>
      <div class="check-actions">
        <button class="answer no"><span class="answer-icon"><svg><path d="m5 12 4 4 10-10"></path></svg></span><span><b>没冲</b></span></button>
      </div>
    </section>
    <div class="progress-ring"><svg><circle class="ring-value" style="stroke-dashoffset:25"></circle></svg><strong>12<small>天</small></strong></div>
    <section class="stats"><article class="stat-card">统计</article></section>
    <section class="history">
      <div class="month-switcher"><button aria-label="上个月">‹</button><button aria-label="下个月">›</button></div>
      <div class="calendar-month" aria-label="7月日历，可左右滑动切换月份">
        <div class="calendar-weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
        <div class="calendar-grid"><button class="calendar-day">1</button><button class="calendar-day">2</button></div>
      </div>
    </section>
  </div>
  <strong data-leaderboard-inline-ninja>2</strong>
  <div class="leaderboard-overlay" hidden>
    <section class="leaderboard-panel"><header>排行榜</header><div class="leaderboard-list"><article data-flip-id="profile-a">A</article></div></section>
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
let suppressNextTimelineCompletion = false;
const applyObjectValues = (target, vars) => {
  if (!target || target.nodeType || Array.isArray(target)) return;
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === "number" && key !== "duration") target[key] = value;
  }
};
const timeline = (options = {}) => {
  const suppressCompletion = suppressNextTimelineCompletion;
  suppressNextTimelineCompletion = false;
  const instance = {
    fromTo(target, fromVars, toVars, position) {
      calls.push({ type: "timeline-fromTo", target, fromVars, toVars, position });
      return instance;
    },
    to(target, vars, position) {
      calls.push({ type: "timeline-to", target, vars, position });
      return instance;
    },
    progress() { return instance; },
    kill() {},
  };
  if (!suppressCompletion) window.setTimeout(() => options.onComplete?.(), 5);
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
  quickTo(target, property, vars) {
    calls.push({ type: "quickTo", target, property, vars });
    const setter = (value) => calls.push({ type: "quick-set", target, property, value });
    setter.tween = tween();
    return setter;
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
  utils: {
    random(minimum, maximum, increment = 0) {
      const midpoint = (Number(minimum) + Number(maximum)) / 2;
      return increment ? Math.round(midpoint / increment) * increment : midpoint;
    },
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
  create(vars) {
    calls.push({ type: "scroll-create", vars });
    window.setTimeout(() => vars.onUpdate?.({ getVelocity: () => 1200 }), 0);
    return { kill() { calls.push({ type: "scroll-create-kill" }); } };
  },
  refresh() { calls.push({ type: "scroll-refresh" }); },
};
window.matchMedia = (query) => ({
  media: query,
  matches: query.includes("no-preference"),
  addEventListener() {},
  removeEventListener() {},
});
const vibrationCalls = [];
window.navigator.vibrate = (pattern) => {
  vibrationCalls.push(pattern);
  return true;
};

const answer = window.document.querySelector(".answer");
answer.addEventListener("click", () => {
  answer.classList.add("selected");
  answer.closest(".hero").classList.add("completed", "no");
  answer.closest(".hero").querySelector("h1").textContent = "今日已记录";
});

window.eval(source);
await new Promise((resolve) => window.setTimeout(resolve, 140));
assert.equal(window.document.documentElement.dataset.gsapMotion, "full");
assert.equal(window.document.documentElement.dataset.gsapIntro, "complete");
assert.equal(window.document.querySelector(".gsap-cinematic-intro"), null, "the cinematic overlay should clean itself up");
assert.ok(calls.some((call) => call.type === "timeline-fromTo" && call.target === window.document.querySelector(".hero h1")));
assert.ok(calls.some((call) => call.type === "timeline-fromTo" && call.target?.classList?.contains("gsap-cinematic-refraction")));
assert.equal(calls.find((call) => call.target?.classList?.contains("gsap-cinematic-intro"))?.target.textContent.trim(), "");
assert.ok(calls.some((call) => call.type === "register" && call.plugin === window.Flip));
assert.ok(calls.some((call) => call.type === "register" && call.plugin === window.ScrollTrigger));
assert.ok(calls.some((call) => call.type === "matchMedia" && "reduceMotion" in call.conditions));
assert.ok(calls.some((call) => call.type === "fromTo" && call.target === window.document.querySelector(".ring-value")));
assert.equal(window.ChonglemaGsapMotion.usesScrollTrigger, true);
assert.ok(calls.some((call) => call.type === "scroll-batch"));
assert.equal(window.document.querySelector(".stat-card").dataset.gsapScroll, "entered");
assert.ok(window.document.querySelector(".gsap-scroll-progress"));
assert.ok(window.document.querySelector(".gsap-scroll-progress > b"), "the scroll comet should be mounted");
assert.ok(window.document.querySelector(".history > .gsap-scroll-orb"), "showcase cards should receive a depth layer");
assert.ok(window.document.querySelector(".gsap-velocity-field"), "scroll velocity should mount an atmospheric field");
assert.ok(window.document.querySelector(".history > .gsap-holo-surface"), "showcase cards should receive holographic glass");
assert.ok(calls.some((call) => call.type === "scroll-create" && call.vars.id === "scroll-velocity-field"));
assert.ok(calls.some((call) => call.type === "quickTo" && call.property === "scaleX"));
assert.ok(calls.some((call) => call.type === "quickTo" && call.property === "scaleY"));
assert.ok(calls.every((call) => call.type !== "quickTo" || !["scale", "rotationZ"].includes(call.property)), "quickTo should avoid composite transform aliases that emit reset warnings");

const originalCheckinSetTimeout = window.setTimeout.bind(window);
window.setTimeout = (callback, delay, ...args) => originalCheckinSetTimeout(callback, delay === 1600 ? 8 : delay, ...args);
suppressNextTimelineCompletion = true;
answer.click();
await new Promise((resolve) => window.setTimeout(resolve, 80));
window.setTimeout = originalCheckinSetTimeout;
assert.ok(calls.some((call) => call.type === "timeline-fromTo" && call.target === answer));
assert.equal(window.document.querySelectorAll(".gsap-checkin-wash").length, 0, "the check-in wash should clean itself up");
assert.equal(window.document.querySelectorAll(".gsap-checkin-impact").length, 0, "the full-screen impact should clean itself up");
assert.ok(calls.some((call) => call.type === "timeline-fromTo" && call.target?.classList?.contains("gsap-checkin-impact-flash")));
assert.deepEqual(Array.from(vibrationCalls.at(-1)), [16, 22, 40]);

const leaderboardNumber = window.document.querySelector("[data-leaderboard-inline-ninja]");
leaderboardNumber.firstChild.data = "7";
await new Promise((resolve) => window.setTimeout(resolve, 45));
assert.equal(leaderboardNumber.textContent, "7");
assert.ok(calls.some((call) => call.type === "to" && call.target?.current === 7));

const list = window.document.querySelector(".leaderboard-list");
const flipState = window.ChonglemaGsapMotion.captureLeaderboard(list);
assert.ok(flipState?.flipState, "the race transition should retain the Flip state");
assert.ok(window.document.querySelector(".gsap-leaderboard-race-ghost"), "the outgoing board should be captured as a visual ghost");
list.innerHTML = '<article data-flip-id="profile-a">A2</article><article data-flip-id="profile-b">B</article>';
const originalSetTimeout = window.setTimeout.bind(window);
window.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay === 1600 ? 8 : delay, ...args);
suppressNextTimelineCompletion = true;
window.ChonglemaGsapMotion.playLeaderboardFlip(flipState, list, "rush");
assert.ok(calls.some((call) => call.type === "flip-getState"));
assert.ok(calls.some((call) => call.type === "flip-from"));
assert.equal(list.dataset.gsapRace, "entering");
assert.ok(window.document.querySelector('.gsap-leaderboard-race-fx[data-race-tone="rush"]'));
await new Promise((resolve) => window.setTimeout(resolve, 18));
window.setTimeout = originalSetTimeout;
assert.equal(list.dataset.gsapRace, "entered");
assert.equal(window.document.querySelector(".gsap-leaderboard-race-fx"), null);
assert.equal(window.document.querySelector(".gsap-leaderboard-race-ghost"), null);

const overlay = window.document.querySelector(".leaderboard-overlay");
overlay.hidden = false;
overlay.classList.add("is-open");
await new Promise((resolve) => window.setTimeout(resolve, 35));
assert.ok(calls.some((call) => call.type === "fromTo" && call.target === overlay.querySelector(".leaderboard-panel")));

list.innerHTML = `<div class="leaderboard-podium-scene" data-podium-tone="ninja">
  <i class="leaderboard-podium-horizon"></i>
  <div class="leaderboard-podium">
    <article class="leaderboard-podium-card rank-2" data-podium-rank="2"><i class="leaderboard-podium-beam"></i><em class="leaderboard-podium-crown">Ⅱ</em><span class="leaderboard-podium-avatar">B</span><i class="leaderboard-podium-plinth"><span>2</span></i></article>
    <article class="leaderboard-podium-card rank-1" data-podium-rank="1"><i class="leaderboard-podium-beam"></i><em class="leaderboard-podium-crown">♛</em><span class="leaderboard-podium-avatar">A</span><i class="leaderboard-podium-plinth"><span>1</span></i></article>
    <article class="leaderboard-podium-card rank-3" data-podium-rank="3"><i class="leaderboard-podium-beam"></i><em class="leaderboard-podium-crown">Ⅲ</em><span class="leaderboard-podium-avatar">C</span><i class="leaderboard-podium-plinth"><span>3</span></i></article>
  </div>
</div>`;
const originalPodiumSetTimeout = window.setTimeout.bind(window);
window.setTimeout = (callback, delay, ...args) => originalPodiumSetTimeout(callback, delay === 2400 ? 8 : delay, ...args);
suppressNextTimelineCompletion = true;
window.ChonglemaGsapMotion.scanShowcaseEffects();
await new Promise((resolve) => window.setTimeout(resolve, 45));
window.setTimeout = originalPodiumSetTimeout;
const podiumScene = list.querySelector(".leaderboard-podium-scene");
assert.equal(podiumScene.dataset.gsapPodium, "entered");
assert.ok(calls.some((call) => call.type === "timeline-fromTo" && call.target?.includes?.(podiumScene.querySelector('.rank-1'))));

window.document.querySelector('[aria-label="下个月"]').click();
await new Promise((resolve) => window.setTimeout(resolve, 15));
assert.ok(calls.some((call) => call.type === "timeline-to" && call.target?.classList?.contains("gsap-calendar-ghost")));
const currentMonth = window.document.querySelector(".calendar-month:not(.gsap-calendar-ghost)");
const nextMonth = currentMonth.cloneNode(true);
nextMonth.classList.add("next");
currentMonth.replaceWith(nextMonth);
await new Promise((resolve) => window.setTimeout(resolve, 45));
assert.equal(nextMonth.dataset.gsapCalendar, "entered");
assert.ok(calls.some((call) => call.type === "timeline-fromTo" && call.target === nextMonth));

const originalMilestoneSetTimeout = window.setTimeout.bind(window);
window.setTimeout = (callback, delay, ...args) => originalMilestoneSetTimeout(callback, delay === 3400 ? 8 : delay, ...args);
suppressNextTimelineCompletion = true;
const milestone = window.ChonglemaGsapMotion.celebrateMilestone(30, "rush");
assert.ok(milestone?.classList.contains("gsap-milestone-custom"));
assert.equal(milestone.dataset.milestoneType, "rush");
assert.equal(milestone.querySelectorAll(".gsap-milestone-particles > i").length, 28);
assert.match(milestone.textContent, /连冲 30 天/);
assert.ok(calls.some((call) => call.type === "timeline-fromTo" && call.target === milestone));
await new Promise((resolve) => window.setTimeout(resolve, 15));
window.setTimeout = originalMilestoneSetTimeout;
assert.equal(window.document.querySelector(".gsap-milestone-custom"), null, "custom milestone effects should clean up");

window.dispatchEvent(new window.Event("pagehide"));
await new Promise((resolve) => window.setTimeout(resolve, 20));
assert.equal(window.document.querySelector(".gsap-scroll-progress"), null);
dom.window.close();
console.log("GSAP motion interaction tests passed");
