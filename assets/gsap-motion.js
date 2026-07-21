(() => {
  const root = document.getElementById("root");
  const gsap = window.gsap;
  const Flip = window.Flip;
  const ScrollTrigger = window.ScrollTrigger;
  if (!root || !gsap) return;

  const plugins = [Flip, ScrollTrigger].filter(Boolean);
  if (plugins.length) gsap.registerPlugin(...plugins);

  const html = document.documentElement;
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const numberTweens = new WeakMap();
  const numberTargetState = new WeakMap();
  const numberCompletion = new WeakMap();
  const leaderboardNumberState = new WeakMap();
  const leaderboardNumberLocks = new WeakSet();
  const ringState = new WeakMap();
  const ringTweens = new WeakMap();
  const controlledSheetState = new WeakMap();
  const scrollRevealSeen = new WeakSet();
  const scrollRevealTriggers = new Set();
  const scrollDepthTweens = new Set();
  const scrollDecorationTweens = new WeakMap();
  const activeCheckinTimelines = new Set();
  const activeLeaderboardRaceTimelines = new Set();
  const transientTimelineSafetyTimers = new Set();
  const activeMilestoneTimelines = new Set();
  const activePodiumTimelines = new Set();
  const activeCalendarTimelines = new Set();
  const podiumScenesSeen = new WeakSet();
  const calendarMonthsSeen = new WeakSet();
  const reactiveCardControls = new Map();
  const activeNumberElements = new Set();
  const activeRings = new Set();
  let reducedMotion = reducedMotionQuery.matches;
  let bodyObserver = null;
  let pendingScan = 0;
  let pendingScrollRefresh = 0;
  let scrollProgressElement = null;
  let scrollRevealIndex = 0;
  let velocityFieldElement = null;
  let velocityScrollTrigger = null;
  let velocityResetTimer = 0;
  let velocityFieldControls = null;
  let calendarGesture = null;
  let calendarGhost = null;
  let calendarCaptureStamp = 0;
  let calendarCaptureDirection = 0;
  let cinematicIntroStarted = false;
  let cinematicIntroTimeline = null;
  let cinematicIntroElement = null;
  let cinematicIntroSafetyTimer = 0;

  html.dataset.gsapIntro = reducedMotion ? "reduced" : "pending";

  const milestoneDays = [3, 7, 14, 30, 60, 90, 180, 365];
  const scrollProgressTweens = new Set();

  function armTimelineSafety(timeline, delay, finish) {
    if (!timeline || !Number.isFinite(delay)) return () => {};
    const timer = window.setTimeout(() => {
      transientTimelineSafetyTimers.delete(timer);
      try {
        timeline.progress?.(1);
      } finally {
        finish?.();
      }
    }, delay);
    transientTimelineSafetyTimers.add(timer);
    return () => {
      window.clearTimeout(timer);
      transientTimelineSafetyTimers.delete(timer);
    };
  }

  const scrollRevealSelector = [
    ".leaderboard-inline-entry",
    ".catchup",
    ".stats > .stat-card",
    ".month-summary",
    ".history",
    "footer",
  ].join(", ");

  const scrollShowcaseSelector = [
    ".leaderboard-inline-entry",
    ".stats > .streak-card",
    ".history",
  ].join(", ");

  const reactiveCardSelector = [
    ".leaderboard-inline-entry",
    ".stats > .stat-card",
    ".history",
  ].join(", ");

  const leaderboardNumberSelector = [
    "[data-leaderboard-trigger-count]",
    "[data-leaderboard-inline-ninja]",
    "[data-leaderboard-inline-rush]",
    "[data-leaderboard-ninja-days]",
    "[data-leaderboard-rush-days]",
    "[data-leaderboard-current-days]",
  ].join(", ");

  const sheetDefinitions = [
    {
      overlay: ".leaderboard-overlay",
      panel: ".leaderboard-panel",
      open: (element) => element.classList.contains("is-open") && !element.hidden,
    },
    {
      overlay: ".pwa-reminder-overlay",
      panel: ".pwa-reminder-panel",
      open: (element) => element.classList.contains("is-open") && !element.hidden,
    },
    {
      overlay: ".recovery-editor",
      panel: ".recovery-editor-panel",
      open: (element) => element.classList.contains("is-open"),
    },
  ];

  const transientSheetDefinitions = [
    { overlay: ".month-sheet", panel: ".month-panel" },
    { overlay: ".history-sheet", panel: ".history-panel" },
  ];

  const getTextNode = (element) =>
    Array.from(element?.childNodes || []).find((node) => node.nodeType === Node.TEXT_NODE);

  const clamp = (minimum, maximum, value) =>
    Math.min(maximum, Math.max(minimum, Number(value) || 0));

  const makeQuickTo = (target, property, options) => {
    if (typeof gsap.quickTo === "function") return gsap.quickTo(target, property, options);
    return (value) => gsap.to(target, {
      [property]: value,
      ...options,
      overwrite: "auto",
    });
  };

  const parseElementNumber = (element) => {
    const textNode = getTextNode(element);
    const value = Number.parseInt(textNode?.data || element?.textContent || "", 10);
    return { textNode, value };
  };

  const clearAnimatingFlag = (element) => {
    element?.removeAttribute("data-gsap-animating");
  };

  function animateNumber(element, from, to, duration = 0.55, onComplete = null) {
    const textNode = getTextNode(element);
    const start = Number(from);
    const end = Number(to);
    if (!element || !textNode || !Number.isFinite(start) || !Number.isFinite(end)) {
      onComplete?.();
      return null;
    }

    numberTweens.get(element)?.kill();
    numberTweens.delete(element);
    numberTargetState.delete(element);
    numberCompletion.delete(element);
    numberTargetState.set(element, end);
    if (onComplete) numberCompletion.set(element, onComplete);
    if (reducedMotion || start === end) {
      textNode.data = String(Math.round(end));
      clearAnimatingFlag(element);
      numberTargetState.delete(element);
      numberCompletion.delete(element);
      onComplete?.();
      return null;
    }

    const value = { current: start };
    element.dataset.gsapAnimating = "number";
    activeNumberElements.add(element);
    textNode.data = String(Math.round(start));

    let tween = null;
    tween = gsap.to(value, {
      current: end,
      duration,
      ease: "power2.out",
      overwrite: "auto",
      onUpdate: () => {
        textNode.data = String(Math.round(value.current));
      },
      onComplete: () => {
        textNode.data = String(Math.round(end));
        numberTweens.delete(element);
        numberTargetState.delete(element);
        numberCompletion.delete(element);
        activeNumberElements.delete(element);
        clearAnimatingFlag(element);
        onComplete?.();
      },
      onInterrupt: () => {
        activeNumberElements.delete(element);
        clearAnimatingFlag(element);
      },
    });
    numberTweens.set(element, tween);
    return tween;
  }

  function scanLeaderboardNumbers() {
    document.querySelectorAll(leaderboardNumberSelector).forEach((element) => {
      if (leaderboardNumberLocks.has(element)) return;
      const { value } = parseElementNumber(element);
      if (!Number.isFinite(value)) return;
      if (!leaderboardNumberState.has(element)) {
        leaderboardNumberState.set(element, value);
        return;
      }
      const previous = leaderboardNumberState.get(element);
      if (previous === value) return;
      leaderboardNumberState.set(element, value);
      leaderboardNumberLocks.add(element);
      animateNumber(element, previous, value, 0.52, () => {
        leaderboardNumberLocks.delete(element);
      });
    });
  }

  function animateRing(circle, from, to, duration = 0.68) {
    const start = Number(from);
    const end = Number(to);
    if (!circle || !Number.isFinite(start) || !Number.isFinite(end)) return null;

    ringTweens.get(circle)?.kill();
    ringState.set(circle, end);
    if (reducedMotion || start === end) {
      gsap.set(circle, { strokeDashoffset: end });
      clearAnimatingFlag(circle);
      return null;
    }

    circle.dataset.gsapAnimating = "ring";
    activeRings.add(circle);
    let tween = null;
    tween = gsap.fromTo(
      circle,
      { strokeDashoffset: start },
      {
        strokeDashoffset: end,
        duration,
        ease: "power2.out",
        overwrite: "auto",
        onComplete: () => {
          ringTweens.delete(circle);
          activeRings.delete(circle);
          clearAnimatingFlag(circle);
        },
        onInterrupt: () => {
          activeRings.delete(circle);
          clearAnimatingFlag(circle);
        },
      },
    );
    ringTweens.set(circle, tween);
    return tween;
  }

  function scanRings() {
    document.querySelectorAll(".progress-ring .ring-value").forEach((circle) => {
      const target = Number.parseFloat(circle.style.strokeDashoffset || circle.getAttribute("stroke-dashoffset") || "100");
      if (!Number.isFinite(target)) return;
      if (!ringState.has(circle)) {
        ringState.set(circle, target);
        animateRing(circle, 100, target, 0.76);
        return;
      }
      const previous = ringState.get(circle);
      if (Math.abs(previous - target) > 0.01) animateRing(circle, previous, target);
    });
  }

  const localDateKey = (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  };

  function readLocalRecords() {
    try {
      const records = JSON.parse(localStorage.getItem("did-you-v1") || "{}");
      return records && typeof records === "object" ? records : {};
    } catch {
      return {};
    }
  }

  function readCurrentStreak(recordType) {
    const records = readLocalRecords();
    const date = new Date();
    let days = 0;
    while (records[localDateKey(date)] === recordType) {
      days += 1;
      date.setDate(date.getDate() - 1);
    }
    return days;
  }

  function finishCinematicIntro() {
    const hero = document.querySelector(".hero");
    const topbar = document.querySelector(".topbar");
    const targets = [
      hero,
      topbar,
      hero?.querySelector(".date"),
      hero?.querySelector("h1"),
      hero?.querySelector(".subline"),
      ...Array.from(hero?.querySelectorAll(".answer") || []),
    ].filter(Boolean);
    window.clearTimeout(cinematicIntroSafetyTimer);
    cinematicIntroSafetyTimer = 0;
    cinematicIntroElement?.remove();
    cinematicIntroElement = null;
    cinematicIntroTimeline = null;
    html.dataset.gsapIntro = reducedMotion ? "reduced" : "complete";
    topbar?.classList.remove("motion-card", "motion-enter");
    hero?.classList.remove("motion-card", "motion-enter");
    gsap.set(targets, { clearProps: "transform,opacity,visibility,transformOrigin,transformStyle,clipPath" });
  }

  function runCinematicIntro() {
    if (cinematicIntroStarted || reducedMotion) {
      if (reducedMotion) html.dataset.gsapIntro = "reduced";
      return null;
    }
    const hero = document.querySelector(".hero");
    const topbar = document.querySelector(".topbar");
    const date = hero?.querySelector(".date");
    const title = hero?.querySelector("h1");
    const subline = hero?.querySelector(".subline");
    const allAnswers = Array.from(hero?.querySelectorAll(".answer") || []);
    const selected = hero?.querySelector(".answer.selected");
    const answers = hero?.classList.contains("completed") && !hero.classList.contains("motion-editing") && selected
      ? [selected]
      : allAnswers;
    if (!hero || !topbar || !date || !title || !subline || !answers.length) return null;

    cinematicIntroStarted = true;
    html.dataset.gsapIntro = "playing";
    hero.dataset.gsapCinematic = "playing";
    const overlay = document.createElement("div");
    overlay.className = "gsap-cinematic-intro";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <i class="gsap-cinematic-veil"></i>
      <i class="gsap-cinematic-bloom"></i>
      <span class="gsap-cinematic-refraction"><i></i><i></i></span>
      <i class="gsap-cinematic-edge"></i>
    `;
    document.body.append(overlay);
    cinematicIntroElement = overlay;

    const veil = overlay.querySelector(".gsap-cinematic-veil");
    const bloom = overlay.querySelector(".gsap-cinematic-bloom");
    const refraction = overlay.querySelector(".gsap-cinematic-refraction");
    const refractionEdges = Array.from(refraction?.children || []);
    const edge = overlay.querySelector(".gsap-cinematic-edge");
    const targets = [topbar, date, title, subline, ...answers];
    gsap.killTweensOf(targets);
    gsap.set([hero, ...targets], { transformPerspective: 1200, transformStyle: "preserve-3d" });

    let timeline = null;
    timeline = gsap.timeline({
      defaults: { ease: "power4.out" },
      onComplete: () => {
        delete hero.dataset.gsapCinematic;
        finishCinematicIntro();
      },
      onInterrupt: () => {
        delete hero.dataset.gsapCinematic;
        finishCinematicIntro();
      },
    });
    cinematicIntroTimeline = timeline;
    timeline
      .fromTo(overlay, { autoAlpha: 1 }, { autoAlpha: 1, duration: 0.01 }, 0)
      .fromTo(veil, { autoAlpha: 1 }, {
        autoAlpha: 0.18,
        duration: 0.82,
        ease: "power2.inOut",
      }, 0.08)
      .fromTo(bloom, { xPercent: -42, yPercent: 28, scale: 0.62, rotation: -14, autoAlpha: 0 }, {
        xPercent: 34,
        yPercent: -24,
        scale: 1.28,
        rotation: 18,
        autoAlpha: 0.72,
        duration: 1.08,
        ease: "expo.inOut",
      }, 0)
      .fromTo(refraction, { xPercent: -280, rotation: -16, scaleX: 0.52, autoAlpha: 0 }, {
        xPercent: 280,
        rotation: 7,
        scaleX: 1.08,
        autoAlpha: 0.92,
        duration: 1.08,
        ease: "expo.inOut",
      }, 0.02)
      .fromTo(refractionEdges, { scaleY: 0.35, autoAlpha: 0 }, {
        scaleY: 1,
        autoAlpha: 0.72,
        duration: 0.46,
        stagger: 0.08,
        ease: "power3.out",
      }, 0.16)
      .fromTo(edge, { xPercent: -190, scaleX: 0.28, autoAlpha: 0 }, {
        xPercent: 190,
        scaleX: 1,
        autoAlpha: 0.74,
        duration: 0.78,
        ease: "expo.inOut",
      }, 0.1)
      .fromTo(topbar, { y: -24, z: -70, autoAlpha: 0 }, {
        y: 0,
        z: 0,
        autoAlpha: 1,
        duration: 0.58,
      }, 0.08)
      .fromTo(date, { y: -20, z: -90, rotationX: 48, autoAlpha: 0 }, {
        y: 0,
        z: 0,
        rotationX: 0,
        autoAlpha: 1,
        duration: 0.6,
        ease: "back.out(1.2)",
      }, 0.12)
      .fromTo(title, {
        y: 38,
        z: -150,
        scale: 0.9,
        rotationX: 12,
        autoAlpha: 0,
        clipPath: "inset(0 0 100% 0)",
      }, {
        y: 0,
        z: 0,
        scale: 1,
        rotationX: 0,
        autoAlpha: 1,
        clipPath: "inset(0 0 0% 0)",
        duration: 0.76,
        ease: "expo.out",
      }, 0.16)
      .fromTo(subline, { y: 16, z: -60, autoAlpha: 0 }, {
        y: 0,
        z: 0,
        autoAlpha: 1,
        duration: 0.5,
      }, 0.26)
      .fromTo(answers, {
        y: 54,
        z: -120,
        scale: 0.92,
        rotationX: 11,
        autoAlpha: 0,
        transformOrigin: "50% 100%",
      }, {
        y: 0,
        z: 0,
        scale: 1,
        rotationX: 0,
        autoAlpha: 1,
        duration: 0.7,
        stagger: 0.08,
        ease: "back.out(1.28)",
      }, 0.34)
      .to(refraction, { autoAlpha: 0, duration: 0.2, ease: "power2.in" }, 0.88)
      .to(edge, { autoAlpha: 0, duration: 0.16 }, 0.82)
      .to(bloom, { scale: 1.55, autoAlpha: 0, duration: 0.42, ease: "power2.in" }, 0.72)
      .to(veil, { autoAlpha: 0, duration: 0.3, ease: "power2.in" }, 0.7)
      .to(overlay, { autoAlpha: 0, duration: 0.32, ease: "power2.inOut" }, 0.9);
    window.clearTimeout(cinematicIntroSafetyTimer);
    cinematicIntroSafetyTimer = window.setTimeout(() => {
      if (html.dataset.gsapIntro !== "playing") return;
      cinematicIntroTimeline?.progress?.(1);
      if (html.dataset.gsapIntro === "playing") {
        delete hero.dataset.gsapCinematic;
        finishCinematicIntro();
      }
    }, 2100);
    return timeline;
  }

  function milestoneParticleMarkup(count = 28) {
    return Array.from({ length: count }, (_, index) =>
      `<i style="--particle:${index}" aria-hidden="true"></i>`).join("");
  }

  function milestoneRayMarkup(count = 12) {
    return Array.from({ length: count }, (_, index) =>
      `<i style="--ray:${index}" aria-hidden="true"></i>`).join("");
  }

  function animateMilestoneOverlay(overlay, type = "ninja") {
    if (!overlay || overlay.dataset.gsapMilestone) return null;
    overlay.dataset.gsapMilestone = "animating";
    overlay.dataset.milestoneType = type === "rush" ? "rush" : "ninja";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "assertive");

    const card = overlay.querySelector(":scope > div:not(.gsap-milestone-fx)");
    if (!card) return null;
    card.classList.add("gsap-milestone-card");
    const core = card.querySelector(":scope > span");
    const title = card.querySelector(":scope > b");
    const copy = card.querySelector(":scope > p");
    core?.classList.add("gsap-milestone-core");

    if (!card.querySelector(".gsap-milestone-kicker")) {
      const kicker = document.createElement("small");
      kicker.className = "gsap-milestone-kicker";
      kicker.textContent = type === "rush" ? "RUSH STREAK UNLOCKED" : "NINJA STREAK UNLOCKED";
      card.prepend(kicker);
    }

    const fx = document.createElement("div");
    fx.className = "gsap-milestone-fx";
    fx.setAttribute("aria-hidden", "true");
    fx.innerHTML = `
      <i class="gsap-milestone-flash"></i>
      <i class="gsap-milestone-ring ring-one"></i>
      <i class="gsap-milestone-ring ring-two"></i>
      <i class="gsap-milestone-ring ring-three"></i>
      <span class="gsap-milestone-rays">${milestoneRayMarkup()}</span>
      <span class="gsap-milestone-particles">${milestoneParticleMarkup()}</span>
    `;
    overlay.append(fx);

    if (reducedMotion) {
      overlay.dataset.gsapMilestone = "complete";
      fx.remove();
      return null;
    }

    const kicker = card.querySelector(".gsap-milestone-kicker");
    const flash = fx.querySelector(".gsap-milestone-flash");
    const rings = Array.from(fx.querySelectorAll(".gsap-milestone-ring"));
    const rays = fx.querySelector(".gsap-milestone-rays");
    const particles = Array.from(fx.querySelectorAll(".gsap-milestone-particles > i"));
    const vectors = particles.map((_, index) => {
      const angle = (Math.PI * 2 * index) / particles.length + gsap.utils.random(-0.09, 0.09);
      const distance = gsap.utils.random(120, 250, 2);
      return {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        rotation: gsap.utils.random(-220, 220, 5),
        scale: gsap.utils.random(0.65, 1.65, 0.05),
      };
    });

    let timeline = null;
    let finished = false;
    let cancelSafety = () => {};
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelSafety();
      activeMilestoneTimelines.delete(timeline);
      overlay.dataset.gsapMilestone = "complete";
      fx.remove();
      gsap.set([overlay, card, core, kicker, title, copy].filter(Boolean), {
        clearProps: "transform,opacity,visibility,transformOrigin",
      });
      if (overlay.classList.contains("gsap-milestone-custom")) overlay.remove();
    };
    timeline = gsap.timeline({
      defaults: { ease: "power3.out" },
      onComplete: finish,
      onInterrupt: finish,
    });
    activeMilestoneTimelines.add(timeline);

    timeline
      .fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, 0)
      .fromTo(flash, { scale: 0.2, autoAlpha: 0 }, {
        scale: 2.4,
        autoAlpha: 0.9,
        duration: 0.5,
        ease: "power2.out",
      }, 0)
      .to(flash, { scale: 3.4, autoAlpha: 0, duration: 0.65 }, 0.38)
      .fromTo(card, {
        y: 78,
        z: -180,
        scale: 0.48,
        rotationX: 34,
        rotationZ: -5,
        autoAlpha: 0,
      }, {
        y: 0,
        z: 0,
        scale: 1,
        rotationX: 0,
        rotationZ: 0,
        autoAlpha: 1,
        duration: 0.82,
        ease: "back.out(1.9)",
      }, 0.08)
      .fromTo(rings, { scale: 0.12, rotation: -35, autoAlpha: 0 }, {
        scale: (index) => 1.7 + index * 0.38,
        rotation: (index) => 42 + index * 30,
        autoAlpha: (index) => 0.58 - index * 0.12,
        duration: 1.25,
        stagger: 0.07,
        ease: "expo.out",
      }, 0.06)
      .fromTo(rays, { scale: 0.15, rotation: -35, autoAlpha: 0 }, {
        scale: 1.8,
        rotation: 28,
        autoAlpha: 0.72,
        duration: 1.25,
        ease: "expo.out",
      }, 0.05)
      .fromTo(particles, { x: 0, y: 0, scale: 0, rotation: 0, autoAlpha: 0 }, {
        x: (index) => vectors[index].x,
        y: (index) => vectors[index].y,
        scale: (index) => vectors[index].scale,
        rotation: (index) => vectors[index].rotation,
        autoAlpha: 1,
        duration: 1.05,
        stagger: 0.008,
        ease: "power4.out",
      }, 0.14)
      .fromTo([kicker, core, title, copy].filter(Boolean), { y: 24, scale: 0.82, autoAlpha: 0 }, {
        y: 0,
        scale: 1,
        autoAlpha: 1,
        duration: 0.5,
        stagger: 0.055,
        ease: "back.out(1.7)",
      }, 0.32)
      .to(core, { scale: 1.2, rotation: 8, duration: 0.22, repeat: 1, yoyo: true }, 0.88)
      .to(particles, {
        y: "+=58",
        rotation: "+=150",
        autoAlpha: 0,
        duration: 0.9,
        stagger: 0.006,
        ease: "power2.in",
      }, 1.02)
      .to([rings, rays], { scale: "+=0.8", autoAlpha: 0, duration: 0.75 }, 1.05)
      .to(card, { y: -18, scale: 1.05, autoAlpha: 0, duration: 0.38, ease: "power3.in" }, 2.12)
      .to(overlay, { autoAlpha: 0, duration: 0.32, ease: "power2.in" }, 2.18);

    cancelSafety = armTimelineSafety(timeline, 3400, finish);
    return timeline;
  }

  function celebrateMilestone(days, type = "ninja") {
    const value = Number(days);
    if (!milestoneDays.includes(value)) return null;
    const current = document.querySelector(".milestone-pop");
    if (current) {
      animateMilestoneOverlay(current, type);
      return current;
    }

    const overlay = document.createElement("div");
    overlay.className = "milestone-pop gsap-milestone-custom";
    overlay.innerHTML = `
      <div>
        <span>✦</span>
        <b>${type === "rush" ? "连冲" : "连续忍住"} ${value} 天</b>
        <p>里程碑已解锁，继续刷新纪录。</p>
      </div>
    `;
    document.body.append(overlay);
    animateMilestoneOverlay(overlay, type);
    if (reducedMotion) window.setTimeout(() => overlay.remove(), 1800);
    return overlay;
  }

  function scheduleMilestoneCheck(recordType, previousDays, attempt = 0) {
    window.setTimeout(() => {
      const nextDays = readCurrentStreak(recordType);
      if (nextDays <= previousDays && attempt < 1) {
        scheduleMilestoneCheck(recordType, previousDays, attempt + 1);
        return;
      }
      if (nextDays <= previousDays || !milestoneDays.includes(nextDays)) return;
      const type = recordType === "yes" ? "rush" : "ninja";
      const nativeOverlay = document.querySelector(".milestone-pop");
      if (nativeOverlay) animateMilestoneOverlay(nativeOverlay, type);
      else celebrateMilestone(nextDays, type);
    }, attempt ? 180 : 90);
  }

  function scanMilestones(scope = document) {
    scope.querySelectorAll?.(".milestone-pop").forEach((overlay) => {
      animateMilestoneOverlay(overlay, overlay.dataset.milestoneType || "ninja");
    });
  }

  function checkinParticleMarkup(count = 30) {
    return Array.from({ length: count }, (_, index) =>
      `<i class="gsap-checkin-particle" style="--particle:${index}" aria-hidden="true"></i>`).join("");
  }

  function checkinStreakMarkup(count = 12) {
    return Array.from({ length: count }, (_, index) =>
      `<i class="gsap-checkin-streak" style="--streak:${index}" aria-hidden="true"></i>`).join("");
  }

  function triggerCheckinHaptics(type) {
    try {
      window.navigator?.vibrate?.(type === "yes" ? [12, 18, 26, 18, 44] : [16, 22, 40]);
    } catch {
      // Haptics are a progressive enhancement and may be blocked by the device.
    }
  }

  function createCheckinImpact(answer, type) {
    if (!answer || reducedMotion) return null;
    const rect = answer.getBoundingClientRect();
    const hero = answer.closest(".hero");
    const impact = document.createElement("div");
    impact.className = "gsap-checkin-impact";
    impact.dataset.impactType = type === "yes" ? "rush" : "ninja";
    impact.setAttribute("aria-hidden", "true");
    impact.style.setProperty("--impact-x", `${Math.round(rect.left + rect.width / 2)}px`);
    impact.style.setProperty("--impact-y", `${Math.round(rect.top + rect.height / 2)}px`);
    impact.innerHTML = `
      <i class="gsap-checkin-impact-flash"></i>
      <span class="gsap-checkin-impact-rings"><i></i><i></i><i></i></span>
      <span class="gsap-checkin-impact-streaks">${checkinStreakMarkup()}</span>
      <span class="gsap-checkin-impact-particles">${checkinParticleMarkup()}</span>
    `;
    document.body.append(impact);

    const flash = impact.querySelector(".gsap-checkin-impact-flash");
    const rings = Array.from(impact.querySelectorAll(".gsap-checkin-impact-rings > i"));
    const streaks = Array.from(impact.querySelectorAll(".gsap-checkin-streak"));
    const particles = Array.from(impact.querySelectorAll(".gsap-checkin-particle"));
    const radius = Math.min(360, Math.max(180, window.innerWidth * 0.32));
    const vectors = particles.map((_, index) => {
      const angle = (Math.PI * 2 * index) / particles.length + gsap.utils.random(-0.16, 0.16);
      const distance = gsap.utils.random(radius * 0.52, radius, 2);
      return {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        rotation: gsap.utils.random(-280, 280, 5),
        scale: gsap.utils.random(0.55, 1.55, 0.05),
      };
    });
    const direction = type === "yes" ? 1 : -1;
    let timeline = null;
    let finished = false;
    let cancelSafety = () => {};
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelSafety();
      activeCheckinTimelines.delete(timeline);
      impact.remove();
      if (hero) gsap.set(hero, { clearProps: "transform" });
    };
    timeline = gsap.timeline({
      defaults: { ease: "power4.out" },
      onComplete: finish,
      onInterrupt: finish,
    });
    activeCheckinTimelines.add(timeline);
    timeline
      .fromTo(impact, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.01 }, 0)
      .fromTo(flash, { scale: 0.08, autoAlpha: 0.95 }, {
        scale: 3.1,
        autoAlpha: 0,
        duration: 0.58,
        ease: "expo.out",
      }, 0)
      .fromTo(rings, { scale: 0.06, rotation: -24, autoAlpha: 0.92 }, {
        scale: (index) => 1.42 + index * 0.48,
        rotation: (index) => 26 + index * 22,
        autoAlpha: 0,
        duration: 0.82,
        stagger: 0.055,
        ease: "expo.out",
      }, 0.02)
      .fromTo(streaks, { scaleY: 0.05, yPercent: 12, autoAlpha: 0 }, {
        scaleY: 1,
        yPercent: -82,
        autoAlpha: 0.84,
        duration: 0.56,
        stagger: 0.018,
      }, 0.04)
      .to(streaks, { yPercent: -125, scaleY: 1.7, autoAlpha: 0, duration: 0.34 }, 0.42)
      .fromTo(particles, { x: 0, y: 0, scale: 0, rotation: 0, autoAlpha: 0 }, {
        x: (index) => vectors[index].x,
        y: (index) => vectors[index].y,
        scale: (index) => vectors[index].scale,
        rotation: (index) => vectors[index].rotation,
        autoAlpha: 1,
        duration: 0.72,
        stagger: 0.004,
      }, 0.03)
      .to(particles, {
        y: "+=42",
        rotation: "+=120",
        autoAlpha: 0,
        duration: 0.44,
        stagger: 0.003,
        ease: "power2.in",
      }, 0.43)
      .to(hero, { x: direction * 6, rotation: direction * 0.24, duration: 0.055, ease: "power2.out" }, 0.03)
      .to(hero, { x: direction * -4, rotation: direction * -0.16, duration: 0.07 }, 0.085)
      .to(hero, { x: 0, rotation: 0, duration: 0.16, ease: "power3.out" }, 0.155)
      .to(impact, { autoAlpha: 0, duration: 0.18, ease: "power2.in" }, 0.78);
    cancelSafety = armTimelineSafety(timeline, 1600, finish);
    return timeline;
  }

  function runCheckinTimeline(answer) {
    const hero = answer?.closest(".hero");
    if (!answer || !hero || !hero.classList.contains("completed") || reducedMotion) return;

    const icon = answer.querySelector(".answer-icon");
    const path = icon?.querySelector("path");
    const headline = hero.querySelector("h1");
    const subline = hero.querySelector(".subline");
    const wash = document.createElement("span");
    wash.className = "gsap-checkin-wash";
    wash.setAttribute("aria-hidden", "true");
    answer.append(wash);
    const type = answer.classList.contains("yes") ? "yes" : "no";
    createCheckinImpact(answer, type);

    const pathLength = typeof path?.getTotalLength === "function"
      ? Math.max(24, path.getTotalLength())
      : 32;
    const targets = [answer, icon, path, headline, subline].filter(Boolean);
    gsap.killTweensOf(targets);
    hero.dataset.gsapCheckin = "animating";
    answer.dataset.gsapAnimating = "checkin";

    if (path) {
      gsap.set(path, {
        strokeDasharray: pathLength,
        strokeDashoffset: pathLength,
      });
    }

    let timeline = null;
    let finished = false;
    let cancelSafety = () => {};
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelSafety();
      activeCheckinTimelines.delete(timeline);
      wash.remove();
      delete hero.dataset.gsapCheckin;
      clearAnimatingFlag(answer);
      gsap.set(targets, { clearProps: "transform,opacity,visibility" });
      if (path) gsap.set(path, { clearProps: "strokeDasharray,strokeDashoffset" });
    };
    timeline = gsap.timeline({
      defaults: { ease: "power3.out" },
      onComplete: finish,
      onInterrupt: finish,
    });
    activeCheckinTimelines.add(timeline);

    timeline
      .fromTo(answer, { y: 7, scale: 0.975 }, { y: 0, scale: 1, duration: 0.48 }, 0)
      .fromTo(icon, { scale: 0.7, rotation: -7, autoAlpha: 0.38 }, {
        scale: 1,
        rotation: 0,
        autoAlpha: 1,
        duration: 0.48,
        ease: "back.out(1.6)",
      }, 0.04)
      .fromTo(wash, { scale: 0.35, autoAlpha: 0 }, {
        scale: 0.82,
        autoAlpha: 0.82,
        duration: 0.22,
      }, 0.03)
      .to(wash, { scale: 1.38, autoAlpha: 0, duration: 0.48, ease: "power2.out" }, 0.24)
      .fromTo([headline, subline].filter(Boolean), { y: 8, autoAlpha: 0 }, {
        y: 0,
        autoAlpha: 1,
        duration: 0.42,
        stagger: 0.055,
      }, 0.1);

    if (path) {
      timeline.to(path, { strokeDashoffset: 0, duration: 0.44, ease: "power2.out" }, 0.1);
    }
    cancelSafety = armTimelineSafety(timeline, 1400, finish);
    window.setTimeout(scanRings, 0);
    return timeline;
  }

  function scheduleCheckinTimeline(event) {
    const answer = event.target.closest?.(".hero .answer");
    const hero = answer?.closest(".hero");
    if (!answer || !hero) return;

    const isOpeningEditor = hero.classList.contains("completed")
      && answer.classList.contains("selected")
      && !hero.classList.contains("motion-editing");
    if (isOpeningEditor) return;

    const type = answer.classList.contains("yes") ? "yes" : "no";
    const previousStreakDays = readCurrentStreak(type);
    triggerCheckinHaptics(type);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const selected = document.querySelector(`.hero.completed .answer.${type}.selected`);
        if (selected) {
          runCheckinTimeline(selected);
          scheduleMilestoneCheck(type, previousStreakDays);
        }
        scanLeaderboardNumbers();
        scanRings();
      });
    });
  }

  function findSheetDefinition(element) {
    return sheetDefinitions.find((definition) => element.matches?.(definition.overlay));
  }

  function animateSheet(element, isOpen, definition) {
    const panel = element.querySelector(definition.panel);
    if (!panel || reducedMotion) {
      controlledSheetState.set(element, isOpen);
      return;
    }
    if (controlledSheetState.get(element) === isOpen) return;
    controlledSheetState.set(element, isOpen);
    element.dataset.gsapSheet = isOpen ? "opening" : "closing";
    gsap.killTweensOf([element, panel]);

    if (isOpen) {
      gsap.fromTo(element, { autoAlpha: 0 }, {
        autoAlpha: 1,
        duration: 0.22,
        ease: "power2.out",
        overwrite: "auto",
      });
      gsap.fromTo(panel, { y: 24, scale: 0.985, autoAlpha: 0.84 }, {
        y: 0,
        scale: 1,
        autoAlpha: 1,
        duration: 0.44,
        ease: "power3.out",
        overwrite: "auto",
        onComplete: () => {
          element.dataset.gsapSheet = "open";
          gsap.set(panel, { clearProps: "transform,opacity,visibility" });
        },
      });
      return;
    }

    gsap.to(panel, {
      y: 14,
      scale: 0.992,
      autoAlpha: 0.9,
      duration: 0.2,
      ease: "power2.in",
      overwrite: "auto",
    });
    gsap.to(element, {
      autoAlpha: 0,
      duration: 0.2,
      ease: "power2.in",
      overwrite: "auto",
      onComplete: () => {
        element.dataset.gsapSheet = "closed";
      },
    });
  }

  function animateTransientSheet(element, definition) {
    if (!element || element.dataset.gsapSheet || reducedMotion) return;
    const panel = element.querySelector(definition.panel);
    if (!panel) return;
    element.dataset.gsapSheet = "opening";
    gsap.fromTo(element, { autoAlpha: 0 }, {
      autoAlpha: 1,
      duration: 0.2,
      ease: "power2.out",
    });
    gsap.fromTo(panel, { y: 24, scale: 0.985, autoAlpha: 0.82 }, {
      y: 0,
      scale: 1,
      autoAlpha: 1,
      duration: 0.42,
      ease: "power3.out",
      onComplete: () => {
        element.dataset.gsapSheet = "open";
        gsap.set(panel, { clearProps: "transform,opacity,visibility" });
      },
    });
  }

  function scanSheets(scope = document) {
    sheetDefinitions.forEach((definition) => {
      scope.querySelectorAll?.(definition.overlay).forEach((element) => {
        const isOpen = definition.open(element);
        if (!controlledSheetState.has(element)) {
          controlledSheetState.set(element, false);
          if (!isOpen) return;
        }
        animateSheet(element, isOpen, definition);
      });
    });
    transientSheetDefinitions.forEach((definition) => {
      scope.querySelectorAll?.(definition.overlay).forEach((element) => {
        animateTransientSheet(element, definition);
      });
    });
  }

  function captureLeaderboard(list) {
    if (reducedMotion || !list) return null;
    const targets = list.querySelectorAll("[data-flip-id]");
    const flipState = Flip && targets.length
      ? Flip.getState(targets, { props: "opacity" })
      : null;
    const board = list.closest(".leaderboard-board-card") || list.parentElement;
    const listRect = list.getBoundingClientRect();
    const boardRect = board?.getBoundingClientRect();
    let ghost = null;
    if (board && list.childElementCount && boardRect) {
      ghost = list.cloneNode(true);
      ghost.classList.add("gsap-leaderboard-race-ghost", "is-gsap-flipping");
      ghost.removeAttribute("aria-live");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      ghost.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      Object.assign(ghost.style, {
        top: `${Math.round(listRect.top - boardRect.top)}px`,
        left: `${Math.round(listRect.left - boardRect.left)}px`,
        width: `${Math.round(listRect.width)}px`,
        height: `${Math.round(listRect.height)}px`,
      });
      board.append(ghost);
    }
    list.classList.add("is-gsap-flipping");
    return {
      flipState,
      ghost,
      previousTone: list.querySelector(".leaderboard-podium-scene")?.dataset.podiumTone || "ninja",
    };
  }

  function playLeaderboardFlip(capturedState, list, nextTone = "ninja") {
    if (reducedMotion || !list) {
      capturedState?.ghost?.remove?.();
      list?.classList.remove("is-gsap-flipping");
      return null;
    }
    const payload = capturedState && Object.prototype.hasOwnProperty.call(capturedState, "flipState")
      ? capturedState
      : { flipState: capturedState, ghost: null, previousTone: nextTone === "rush" ? "ninja" : "rush" };
    const targets = list.querySelectorAll("[data-flip-id]");
    const tone = nextTone === "rush" ? "rush" : "ninja";
    const direction = tone === "rush" ? 1 : -1;
    const board = list.closest(".leaderboard-board-card") || list.parentElement;
    const summary = Array.from(board?.querySelectorAll(".leaderboard-board-summary > div") || []);
    const selectedTab = board?.querySelector(`[data-tab="${tone}"]`);
    const raceFx = document.createElement("div");
    raceFx.className = "gsap-leaderboard-race-fx";
    raceFx.dataset.raceTone = tone;
    raceFx.setAttribute("aria-hidden", "true");
    raceFx.innerHTML = `
      <span class="gsap-leaderboard-race-label"><small>${tone === "rush" ? "RUSH CIRCUIT" : "NINJA CIRCUIT"}</small><b>${tone === "rush" ? "连冲赛道" : "忍者赛道"}</b></span>
      <span class="gsap-leaderboard-race-lines">${Array.from({ length: 7 }, (_, index) => `<i style="--lane:${index}"></i>`).join("")}</span>
      <i class="gsap-leaderboard-race-flare"></i>
    `;
    board?.append(raceFx);
    const raceLabel = raceFx.querySelector(".gsap-leaderboard-race-label");
    const raceLines = Array.from(raceFx.querySelectorAll(".gsap-leaderboard-race-lines > i"));
    const raceFlare = raceFx.querySelector(".gsap-leaderboard-race-flare");
    list.classList.add("is-gsap-flipping");
    list.dataset.gsapRace = "entering";

    let flipAnimation = null;
    if (Flip && payload.flipState && targets.length) {
      flipAnimation = Flip.from(payload.flipState, {
        targets,
        absolute: true,
        scale: true,
        simple: true,
        duration: 0.58,
        ease: "power3.inOut",
        stagger: 0.028,
        onEnter: (elements) => gsap.fromTo(elements, { y: 18, z: -80, autoAlpha: 0 }, {
          y: 0,
          z: 0,
          autoAlpha: 1,
          duration: 0.46,
          stagger: 0.035,
          ease: "back.out(1.45)",
        }),
        onLeave: (elements) => gsap.to(elements, {
          y: -14,
          z: -70,
          autoAlpha: 0,
          duration: 0.24,
          ease: "power2.in",
        }),
      });
    }

    let timeline = null;
    let finished = false;
    let cancelSafety = () => {};
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelSafety();
      activeLeaderboardRaceTimelines.delete(timeline);
      flipAnimation?.progress?.(1);
      payload.ghost?.remove?.();
      raceFx.remove();
      list.classList.remove("is-gsap-flipping");
      list.dataset.gsapRace = "entered";
      gsap.set([list, ...targets, ...summary, selectedTab].filter(Boolean), {
        clearProps: "transform,opacity,visibility,transformOrigin",
      });
      window.setTimeout(() => scanShowcaseEffects(list), 0);
    };
    timeline = gsap.timeline({
      defaults: { ease: "power4.out" },
      onComplete: finish,
      onInterrupt: finish,
    });
    activeLeaderboardRaceTimelines.add(timeline);
    timeline
      .fromTo(raceFx, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.08 }, 0)
      .fromTo(raceLines, { xPercent: direction * -170, scaleX: 0.2, autoAlpha: 0 }, {
        xPercent: direction * 175,
        scaleX: 1,
        autoAlpha: 0.86,
        duration: 0.72,
        stagger: 0.025,
        ease: "power3.inOut",
      }, 0)
      .fromTo(raceFlare, { xPercent: direction * -140, scaleX: 0.15, autoAlpha: 0 }, {
        xPercent: direction * 150,
        scaleX: 1.5,
        autoAlpha: 0.92,
        duration: 0.62,
        ease: "power2.inOut",
      }, 0.04)
      .fromTo(raceLabel, { x: direction * 52, z: -120, scale: 0.72, rotationY: direction * -18, autoAlpha: 0 }, {
        x: 0,
        z: 0,
        scale: 1,
        rotationY: 0,
        autoAlpha: 1,
        duration: 0.42,
        ease: "back.out(1.7)",
      }, 0.08)
      .to(raceLabel, { x: direction * -34, z: 90, scale: 1.08, autoAlpha: 0, duration: 0.3, ease: "power3.in" }, 0.42);
    if (payload.ghost) {
      timeline.fromTo(payload.ghost, { x: 0, z: 0, rotationY: 0, autoAlpha: 1 }, {
        x: direction * -120,
        z: -180,
        rotationY: direction * 14,
        autoAlpha: 0,
        duration: 0.42,
        ease: "power3.in",
      }, 0);
    }
    timeline
      .fromTo(list, {
        x: direction * 104,
        z: -150,
        scale: 0.93,
        rotationY: direction * -12,
        skewX: direction * -3.5,
        autoAlpha: 0.12,
        transformOrigin: direction > 0 ? "0% 50%" : "100% 50%",
      }, {
        x: 0,
        z: 0,
        scale: 1,
        rotationY: 0,
        skewX: 0,
        autoAlpha: 1,
        duration: 0.68,
        ease: "expo.out",
      }, 0.16);
    if (summary.length) {
      timeline.fromTo(summary, { x: direction * 26, autoAlpha: 0 }, {
        x: 0,
        autoAlpha: 1,
        duration: 0.42,
        stagger: 0.045,
      }, 0.26);
    }
    if (selectedTab) {
      timeline.fromTo(selectedTab, { scaleX: 0.7, scaleY: 0.86 }, {
        scaleX: 1,
        scaleY: 1,
        duration: 0.46,
        ease: "elastic.out(1, 0.48)",
      }, 0.22);
    }
    timeline.to(raceFx, { autoAlpha: 0, duration: 0.2, ease: "power2.in" }, 0.68);
    timeline.flipAnimation = flipAnimation;
    cancelSafety = armTimelineSafety(timeline, 1600, finish);
    return timeline;
  }

  function animatePodiumScene(scene) {
    if (!scene || reducedMotion || podiumScenesSeen.has(scene)) return null;
    const overlay = scene.closest(".leaderboard-overlay");
    if (!overlay?.classList.contains("is-open") || overlay.hidden || scene.closest(".is-gsap-flipping")) {
      return null;
    }

    const cards = [
      scene.querySelector('.leaderboard-podium-card[data-podium-rank="2"]'),
      scene.querySelector('.leaderboard-podium-card[data-podium-rank="3"]'),
      scene.querySelector('.leaderboard-podium-card[data-podium-rank="1"]'),
    ].filter(Boolean);
    if (!cards.length) return null;

    podiumScenesSeen.add(scene);
    scene.dataset.gsapPodium = "entering";
    const horizon = scene.querySelector(".leaderboard-podium-horizon");
    const crowns = cards.map((card) => card.querySelector(".leaderboard-podium-crown")).filter(Boolean);
    const avatars = cards.map((card) => card.querySelector(".leaderboard-podium-avatar")).filter(Boolean);
    const beams = cards.map((card) => card.querySelector(".leaderboard-podium-beam")).filter(Boolean);
    const plinths = cards.map((card) => card.querySelector(".leaderboard-podium-plinth")).filter(Boolean);
    let timeline = null;
    let finished = false;
    let cancelSafety = () => {};
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelSafety();
      scene.dataset.gsapPodium = "entered";
      gsap.set([horizon, ...cards, ...crowns, ...avatars, ...beams, ...plinths].filter(Boolean), {
        clearProps: "transform,opacity,visibility,transformOrigin",
      });
      if (timeline) activePodiumTimelines.delete(timeline);
    };

    timeline = gsap.timeline({ onComplete: finish, onInterrupt: finish });
    activePodiumTimelines.add(timeline);
    if (horizon) {
      timeline.fromTo(horizon, {
        scale: 0.35,
        rotationX: 78,
        autoAlpha: 0,
      }, {
        scale: 1,
        rotationX: 67,
        autoAlpha: 1,
        duration: 0.9,
        ease: "expo.out",
      }, 0);
    }
    timeline.fromTo(cards, {
      y: 96,
      z: -230,
      scale: 0.68,
      rotationX: 28,
      rotationY: (index) => (index === cards.length - 1 ? 0 : index ? 15 : -15),
      autoAlpha: 0,
      transformOrigin: "50% 100%",
    }, {
      y: 0,
      z: 0,
      scale: 1,
      rotationX: 0,
      rotationY: 0,
      autoAlpha: 1,
      duration: 1.08,
      stagger: 0.12,
      ease: "back.out(1.55)",
    }, 0.08);
    timeline.fromTo(plinths, {
      y: 28,
      scaleX: 0.45,
      autoAlpha: 0,
    }, {
      y: 0,
      scaleX: 1,
      autoAlpha: 1,
      duration: 0.62,
      stagger: 0.1,
      ease: "power4.out",
    }, 0.34);
    timeline.fromTo(avatars, {
      z: -80,
      scale: 0.35,
      rotation: -18,
      autoAlpha: 0,
    }, {
      z: 24,
      scale: 1,
      rotation: 0,
      autoAlpha: 1,
      duration: 0.68,
      stagger: 0.1,
      ease: "back.out(2.1)",
    }, 0.46);
    timeline.fromTo(crowns, {
      y: -42,
      z: 90,
      scale: 1.8,
      rotation: -22,
      autoAlpha: 0,
    }, {
      y: 0,
      z: 32,
      scale: 1,
      rotation: 0,
      autoAlpha: 1,
      duration: 0.72,
      stagger: 0.1,
      ease: "elastic.out(1, 0.45)",
    }, 0.7);
    timeline.fromTo(beams, { scaleY: 0.15, autoAlpha: 0 }, {
      scaleY: 1,
      autoAlpha: 0.78,
      duration: 0.72,
      stagger: 0.08,
      ease: "power2.out",
    }, 0.68);
    cancelSafety = armTimelineSafety(timeline, 2400, finish);
    return timeline;
  }

  function scanLeaderboardPodiums(scope = document) {
    if (reducedMotion) return;
    scope.querySelectorAll?.(".leaderboard-podium-scene").forEach(animatePodiumScene);
  }

  function updateReactiveCard(control) {
    const { element } = control;
    if (!element.isConnected || reducedMotion) return;
    const scrollState = element.dataset.gsapScroll;
    if (scrollState === "waiting" || scrollState === "entering" || element.closest(".is-gsap-flipping")) return;

    const velocity = control.velocity;
    const direction = element.dataset.gsapScrollDirection === "right" ? 1 : -1;
    const hoverStrength = control.pointerActive ? 1 : 0;
    control.rotationXTo(control.pointerY * -7.2 * hoverStrength + velocity * -2.6);
    control.rotationYTo(control.pointerX * 8.4 * hoverStrength + velocity * direction * 0.8);
    control.rotationZTo(velocity * direction * 0.72);
    control.yTo(velocity * -3.4);
    const scale = 1 + hoverStrength * 0.012 + Math.abs(velocity) * 0.007;
    control.scaleXTo(scale);
    control.scaleYTo(scale);
    control.glareXTo(control.pointerX * 52);
    control.glareYTo(control.pointerY * 42);
    control.glareOpacityTo(hoverStrength ? 0.84 : Math.abs(velocity) * 0.28);
    control.spectrumOpacityTo(hoverStrength ? 0.56 : Math.abs(velocity) * 0.22);
  }

  function resetReactivePointer(control) {
    control.pointerActive = false;
    control.pointerX = 0;
    control.pointerY = 0;
    control.rect = null;
    updateReactiveCard(control);
  }

  function ensureHolographicCard(element) {
    if (!element || reactiveCardControls.has(element)) return;
    let surface = element.querySelector(":scope > .gsap-holo-surface");
    if (!surface) {
      surface = document.createElement("span");
      surface.className = "gsap-holo-surface";
      surface.setAttribute("aria-hidden", "true");
      surface.innerHTML = '<i class="gsap-holo-glare"></i><b class="gsap-holo-spectrum"></b><em class="gsap-holo-grid"></em>';
      element.append(surface);
    }
    element.dataset.gsapHolo = "true";
    const glare = surface.querySelector(".gsap-holo-glare");
    const spectrum = surface.querySelector(".gsap-holo-spectrum");
    const control = {
      element,
      surface,
      pointerActive: false,
      pointerX: 0,
      pointerY: 0,
      velocity: 0,
      rect: null,
      rotationXTo: makeQuickTo(element, "rotationX", { duration: 0.48, ease: "power3.out" }),
      rotationYTo: makeQuickTo(element, "rotationY", { duration: 0.48, ease: "power3.out" }),
      rotationZTo: makeQuickTo(element, "rotation", { duration: 0.42, ease: "power3.out" }),
      yTo: makeQuickTo(element, "y", { duration: 0.42, ease: "power3.out" }),
      scaleXTo: makeQuickTo(element, "scaleX", { duration: 0.48, ease: "power3.out" }),
      scaleYTo: makeQuickTo(element, "scaleY", { duration: 0.48, ease: "power3.out" }),
      glareXTo: makeQuickTo(glare, "xPercent", { duration: 0.28, ease: "power2.out" }),
      glareYTo: makeQuickTo(glare, "yPercent", { duration: 0.28, ease: "power2.out" }),
      glareOpacityTo: makeQuickTo(glare, "opacity", { duration: 0.24, ease: "power2.out" }),
      spectrumOpacityTo: makeQuickTo(spectrum, "opacity", { duration: 0.32, ease: "power2.out" }),
    };

    const move = (event) => {
      if (event.pointerType === "touch" && !control.pointerActive) return;
      if (!control.rect) control.rect = element.getBoundingClientRect();
      const width = Math.max(1, control.rect.width);
      const height = Math.max(1, control.rect.height);
      control.pointerActive = true;
      control.pointerX = clamp(-1, 1, ((event.clientX - control.rect.left) / width - 0.5) * 2);
      control.pointerY = clamp(-1, 1, ((event.clientY - control.rect.top) / height - 0.5) * 2);
      updateReactiveCard(control);
    };
    const enter = (event) => {
      if (event.pointerType === "touch") return;
      control.rect = element.getBoundingClientRect();
      move(event);
    };
    const down = (event) => {
      control.rect = element.getBoundingClientRect();
      move(event);
    };
    const leave = () => resetReactivePointer(control);
    control.listeners = { move, enter, down, leave };
    element.addEventListener("pointerenter", enter, { passive: true });
    element.addEventListener("pointermove", move, { passive: true });
    element.addEventListener("pointerdown", down, { passive: true });
    element.addEventListener("pointerleave", leave, { passive: true });
    element.addEventListener("pointerup", leave, { passive: true });
    element.addEventListener("pointercancel", leave, { passive: true });
    reactiveCardControls.set(element, control);
  }

  function scanReactiveCards(scope = document) {
    if (reducedMotion) return;
    scope.querySelectorAll?.(reactiveCardSelector).forEach(ensureHolographicCard);
  }

  function applyScrollVelocity(rawVelocity, scheduleReset = true) {
    if (!velocityFieldControls || reducedMotion) return;
    const velocity = clamp(-2300, 2300, rawVelocity);
    const normalized = velocity / 2300;
    const intensity = Math.min(1, Math.abs(normalized) * 1.4);
    velocityFieldControls.rotationTo(normalized * 5.5);
    velocityFieldControls.scaleYTo(1 + intensity * 0.26);
    velocityFieldControls.glowOpacityTo(intensity * 0.72);
    const glowScale = 0.82 + intensity * 0.72;
    velocityFieldControls.glowScaleXTo(glowScale);
    velocityFieldControls.glowScaleYTo(glowScale);
    velocityFieldControls.lineXTo.forEach((setter, index) => {
      setter(normalized * (34 + index * 18));
    });
    reactiveCardControls.forEach((control) => {
      control.velocity = normalized;
      updateReactiveCard(control);
    });
    if (!scheduleReset) return;
    window.clearTimeout(velocityResetTimer);
    velocityResetTimer = window.setTimeout(() => applyScrollVelocity(0, false), 150);
  }

  function ensureVelocityField() {
    if (reducedMotion || velocityFieldElement?.isConnected) return;
    const field = document.createElement("span");
    field.className = "gsap-velocity-field";
    field.setAttribute("aria-hidden", "true");
    field.innerHTML = "<i></i><i></i><i></i><i></i><b></b>";
    document.body.append(field);
    velocityFieldElement = field;
    const lines = Array.from(field.querySelectorAll("i"));
    const glow = field.querySelector("b");
    velocityFieldControls = {
      rotationTo: makeQuickTo(field, "rotation", { duration: 0.36, ease: "power3.out" }),
      scaleYTo: makeQuickTo(field, "scaleY", { duration: 0.36, ease: "power3.out" }),
      glowOpacityTo: makeQuickTo(glow, "opacity", { duration: 0.28, ease: "power2.out" }),
      glowScaleXTo: makeQuickTo(glow, "scaleX", { duration: 0.36, ease: "power3.out" }),
      glowScaleYTo: makeQuickTo(glow, "scaleY", { duration: 0.36, ease: "power3.out" }),
      lineXTo: lines.map((line) => makeQuickTo(line, "xPercent", { duration: 0.38, ease: "power3.out" })),
    };
    if (typeof ScrollTrigger?.create === "function") {
      velocityScrollTrigger = ScrollTrigger.create({
        id: "scroll-velocity-field",
        start: 0,
        end: "max",
        onUpdate: (self) => applyScrollVelocity(self.getVelocity?.() || 0),
      });
    }
  }

  function stopReactiveMotion() {
    window.clearTimeout(velocityResetTimer);
    velocityResetTimer = 0;
    velocityScrollTrigger?.kill?.();
    velocityScrollTrigger = null;
    if (velocityFieldControls) {
      [
        velocityFieldControls.rotationTo,
        velocityFieldControls.scaleYTo,
        velocityFieldControls.glowOpacityTo,
        velocityFieldControls.glowScaleXTo,
        velocityFieldControls.glowScaleYTo,
        ...velocityFieldControls.lineXTo,
      ].forEach((setter) => setter?.tween?.kill?.());
    }
    velocityFieldControls = null;
    velocityFieldElement?.remove();
    velocityFieldElement = null;
    reactiveCardControls.forEach((control, element) => {
      const { move, enter, down, leave } = control.listeners;
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointerleave", leave);
      element.removeEventListener("pointerup", leave);
      element.removeEventListener("pointercancel", leave);
      [
        control.rotationXTo,
        control.rotationYTo,
        control.rotationZTo,
        control.yTo,
        control.scaleXTo,
        control.scaleYTo,
        control.glareXTo,
        control.glareYTo,
        control.glareOpacityTo,
        control.spectrumOpacityTo,
      ].forEach((setter) => setter?.tween?.kill?.());
      gsap.set(element, { clearProps: "transform,transformOrigin" });
      control.surface.remove();
      delete element.dataset.gsapHolo;
    });
    reactiveCardControls.clear();
  }

  function captureCalendarExit(direction) {
    const resolvedDirection = direction > 0 ? 1 : -1;
    if (reducedMotion || !direction) return null;
    const now = Date.now();
    if (now - calendarCaptureStamp < 90 && calendarCaptureDirection === resolvedDirection) return calendarGhost;
    const month = document.querySelector(".calendar-month:not(.gsap-calendar-ghost)");
    const history = month?.closest(".history");
    if (!month || !history) return null;

    const monthRect = month.getBoundingClientRect();
    const historyRect = history.getBoundingClientRect();
    const ghost = month.cloneNode(true);
    ghost.classList.remove("is-dragging", "is-snapping", "next", "prev");
    ghost.classList.add("gsap-calendar-ghost");
    ghost.dataset.gsapCalendarGhost = resolvedDirection > 0 ? "next" : "prev";
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    calendarGhost?.remove();
    calendarGhost = ghost;
    calendarCaptureStamp = now;
    calendarCaptureDirection = resolvedDirection;
    history.append(ghost);
    gsap.set(ghost, {
      position: "absolute",
      top: monthRect.top - historyRect.top,
      left: monthRect.left - historyRect.left,
      width: monthRect.width,
      height: monthRect.height,
      margin: 0,
      zIndex: 7,
      transformPerspective: 980,
      transformOrigin: resolvedDirection > 0 ? "0% 50%" : "100% 50%",
    });
    let timeline = null;
    let finished = false;
    let cancelSafety = () => {};
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelSafety();
      ghost.remove();
      if (calendarGhost === ghost) calendarGhost = null;
      if (timeline) activeCalendarTimelines.delete(timeline);
    };
    timeline = gsap.timeline({ onComplete: finish, onInterrupt: finish });
    activeCalendarTimelines.add(timeline);
    timeline.to(ghost, {
      x: resolvedDirection * -Math.min(190, Math.max(110, monthRect.width * 0.38)),
      z: 170,
      rotationY: resolvedDirection * -42,
      rotationZ: resolvedDirection * -3.2,
      scale: 0.92,
      autoAlpha: 0,
      duration: 0.78,
      ease: "power3.in",
    }, 0);
    timeline.to(ghost.querySelectorAll(".calendar-day"), {
      x: resolvedDirection * -24,
      y: (index) => (index % 2 ? -12 : 12),
      rotation: (index) => (index % 2 ? -5 : 5),
      autoAlpha: 0,
      duration: 0.42,
      stagger: { amount: 0.22, from: resolvedDirection > 0 ? "start" : "end" },
      ease: "power2.in",
    }, 0.05);
    cancelSafety = armTimelineSafety(timeline, 1500, finish);
    return ghost;
  }

  function captureCalendarNavigation(event) {
    const button = event.target.closest?.(".month-switcher button, .month-grid > button, .floating-today");
    if (!button || button.disabled) return;
    if (button.matches('[aria-label="下个月"]')) captureCalendarExit(1);
    else if (button.matches('[aria-label="上个月"]')) captureCalendarExit(-1);
    else if (button.matches(".month-grid > button")) {
      const current = Number.parseInt(document.querySelector(".month-current")?.textContent || "", 10);
      const next = Number.parseInt(button.textContent || "", 10);
      if (Number.isFinite(current) && Number.isFinite(next) && current !== next) captureCalendarExit(next > current ? 1 : -1);
    } else if (button.matches(".floating-today")) {
      const current = Number.parseInt(document.querySelector(".month-current")?.textContent || "", 10);
      const today = new Date().getMonth() + 1;
      if (Number.isFinite(current) && current !== today) captureCalendarExit(today > current ? 1 : -1);
    }
  }

  function beginCalendarGesture(event) {
    if (event.button > 0 || !event.target.closest?.(".calendar-month:not(.gsap-calendar-ghost)")) return;
    calendarGesture = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }

  function finishCalendarGesture(event) {
    if (!calendarGesture || event.pointerId !== calendarGesture.pointerId) return;
    const deltaX = event.clientX - calendarGesture.x;
    const deltaY = event.clientY - calendarGesture.y;
    calendarGesture = null;
    if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
      captureCalendarExit(deltaX < 0 ? 1 : -1);
    }
  }

  function animateCalendarMonth(month) {
    if (!month || calendarMonthsSeen.has(month)) return null;
    calendarMonthsSeen.add(month);
    const direction = month.classList.contains("next") ? 1 : month.classList.contains("prev") ? -1 : 0;
    if (!direction || reducedMotion) return null;

    const weekdays = month.querySelectorAll(".calendar-weekdays > span");
    const days = month.querySelectorAll(".calendar-day:not(.outside-month)");
    const empty = month.querySelector(".empty-month");
    month.dataset.gsapCalendar = "entering";
    let timeline = null;
    let finished = false;
    let cancelSafety = () => {};
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelSafety();
      month.dataset.gsapCalendar = "entered";
      gsap.set([month, ...weekdays, ...days, empty].filter(Boolean), {
        clearProps: "transform,opacity,visibility,transformOrigin",
      });
      if (timeline) activeCalendarTimelines.delete(timeline);
    };
    timeline = gsap.timeline({ onComplete: finish, onInterrupt: finish });
    activeCalendarTimelines.add(timeline);
    timeline.fromTo(month, {
      x: direction * 126,
      z: -190,
      scale: 0.92,
      rotationX: 8,
      rotationY: direction * -28,
      rotationZ: direction * 2.2,
      autoAlpha: 0,
      transformOrigin: direction > 0 ? "100% 50%" : "0% 50%",
      transformPerspective: 980,
    }, {
      x: 0,
      z: 0,
      scale: 1,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      autoAlpha: 1,
      duration: 0.86,
      ease: "back.out(1.35)",
    }, 0);
    timeline.fromTo(weekdays, {
      y: -18,
      rotationX: -48,
      autoAlpha: 0,
    }, {
      y: 0,
      rotationX: 0,
      autoAlpha: 1,
      duration: 0.5,
      stagger: { amount: 0.24, from: direction > 0 ? "start" : "end" },
      ease: "power3.out",
    }, 0.12);
    timeline.fromTo(days, {
      x: direction * 22,
      y: 34,
      z: -90,
      scale: 0.52,
      rotationX: 62,
      rotationY: direction * -16,
      autoAlpha: 0,
      transformOrigin: "50% 100%",
    }, {
      x: 0,
      y: 0,
      z: 0,
      scale: 1,
      rotationX: 0,
      rotationY: 0,
      autoAlpha: 1,
      duration: 0.62,
      stagger: {
        amount: 0.52,
        grid: "auto",
        from: direction > 0 ? "start" : "end",
      },
      ease: "back.out(1.7)",
    }, 0.18);
    if (empty) {
      timeline.fromTo(empty, { y: 20, scale: 0.94, autoAlpha: 0 }, {
        y: 0,
        scale: 1,
        autoAlpha: 1,
        duration: 0.56,
        ease: "back.out(1.5)",
      }, 0.32);
    }
    cancelSafety = armTimelineSafety(timeline, 2100, finish);
    return timeline;
  }

  function scanCalendarTransitions(scope = document) {
    scope.querySelectorAll?.(".calendar-month:not(.gsap-calendar-ghost)").forEach(animateCalendarMonth);
  }

  function stopCalendarMotion() {
    activeCalendarTimelines.forEach((timeline) => timeline.kill?.());
    activeCalendarTimelines.clear();
    calendarGhost?.remove();
    calendarGhost = null;
    calendarGesture = null;
    document.querySelectorAll(".calendar-month:not(.gsap-calendar-ghost)").forEach((month) => {
      month.dataset.gsapCalendar = "entered";
      gsap.set([month, ...month.querySelectorAll(".calendar-weekdays > span, .calendar-day, .empty-month")], {
        clearProps: "transform,opacity,visibility,transformOrigin",
      });
    });
  }

  function scheduleScrollRefresh() {
    if (!ScrollTrigger || reducedMotion || pendingScrollRefresh) return;
    pendingScrollRefresh = requestAnimationFrame(() => {
      pendingScrollRefresh = requestAnimationFrame(() => {
        pendingScrollRefresh = 0;
        ScrollTrigger.refresh();
      });
    });
  }

  function ensureScrollProgress() {
    if (!ScrollTrigger || reducedMotion || scrollProgressElement?.isConnected) return;
    const progress = document.createElement("span");
    progress.className = "gsap-scroll-progress";
    progress.setAttribute("aria-hidden", "true");
    progress.innerHTML = "<i></i><b></b><em></em>";
    document.body.append(progress);
    scrollProgressElement = progress;

    const bar = progress.firstElementChild;
    const comet = progress.querySelector("b");
    const bloom = progress.querySelector("em");
    gsap.set(bar, { scaleX: 0, transformOrigin: "0 50%" });
    const progressTween = gsap.to(bar, {
      scaleX: 1,
      ease: "none",
      scrollTrigger: {
        id: "page-progress",
        start: 0,
        end: "max",
        scrub: 0.18,
      },
    });
    const cometTween = gsap.to(comet, {
      x: () => Math.max(0, window.innerWidth - 18),
      rotation: 720,
      ease: "none",
      scrollTrigger: {
        id: "page-progress-comet",
        start: 0,
        end: "max",
        scrub: 0.32,
        invalidateOnRefresh: true,
      },
    });
    const bloomTween = gsap.to(bloom, {
      x: () => Math.max(0, window.innerWidth - 34),
      scale: 1.45,
      ease: "none",
      scrollTrigger: {
        id: "page-progress-bloom",
        start: 0,
        end: "max",
        scrub: 0.48,
        invalidateOnRefresh: true,
      },
    });
    [progressTween, cometTween, bloomTween].forEach((tween) => scrollProgressTweens.add(tween));
  }

  function getScrollLayers(element) {
    if (element.matches(".leaderboard-inline-entry")) {
      return Array.from(element.querySelectorAll(
        ":scope > .leaderboard-inline-icon, :scope > .leaderboard-inline-copy, :scope > .leaderboard-inline-scores, :scope > .leaderboard-inline-cta",
      ));
    }
    if (element.matches(".streak-card")) {
      return Array.from(element.querySelectorAll(":scope > .wellness-side"));
    }
    if (element.matches(".history")) {
      return Array.from(element.querySelectorAll(":scope > .section-head, :scope > .calendar-month, :scope > .legend"));
    }
    if (element.matches(".stat-card")) {
      return Array.from(element.querySelectorAll(":scope > span, :scope > strong, :scope > small"));
    }
    if (element.matches(".catchup")) {
      return Array.from(element.querySelectorAll(":scope > span, :scope > b"));
    }
    return [];
  }

  function setupScrollDepth(element, orb, wire) {
    if (!ScrollTrigger || reducedMotion || scrollDecorationTweens.has(orb)) return;
    const orbTween = gsap.fromTo(orb, {
      xPercent: -82,
      yPercent: -38,
      rotation: -28,
      scale: 0.72,
    }, {
      xPercent: 88,
      yPercent: 54,
      rotation: 52,
      scale: 1.28,
      ease: "none",
      scrollTrigger: {
        trigger: element,
        start: "clamp(top bottom)",
        end: "clamp(bottom top)",
        scrub: 0.72,
      },
    });
    const wireTween = gsap.fromTo(wire, {
      xPercent: 52,
      yPercent: 26,
      rotation: 38,
      scale: 0.82,
    }, {
      xPercent: -44,
      yPercent: -32,
      rotation: -58,
      scale: 1.18,
      ease: "none",
      scrollTrigger: {
        trigger: element,
        start: "clamp(top bottom)",
        end: "clamp(bottom top)",
        scrub: 1.05,
      },
    });
    scrollDecorationTweens.set(orb, [orbTween, wireTween]);
    scrollDepthTweens.add(orbTween);
    scrollDepthTweens.add(wireTween);
  }

  function ensureScrollDecorations(element) {
    if (!element || reducedMotion) return;
    element.dataset.gsapShowcase = "true";
    let orb = element.querySelector(":scope > .gsap-scroll-orb");
    let wire = element.querySelector(":scope > .gsap-scroll-wire");
    let sheen = element.querySelector(":scope > .gsap-scroll-sheen");
    if (!orb) {
      orb = document.createElement("span");
      orb.className = "gsap-scroll-orb";
      orb.setAttribute("aria-hidden", "true");
      element.append(orb);
    }
    if (!wire) {
      wire = document.createElement("span");
      wire.className = "gsap-scroll-wire";
      wire.setAttribute("aria-hidden", "true");
      element.append(wire);
    }
    if (!sheen) {
      sheen = document.createElement("span");
      sheen.className = "gsap-scroll-sheen";
      sheen.setAttribute("aria-hidden", "true");
      element.append(sheen);
    }
    setupScrollDepth(element, orb, wire);
  }

  function revealScrollBatch(elements) {
    elements.forEach((element) => {
      element.dataset.gsapScroll = "waiting";
      element.classList.remove("motion-card", "motion-enter");
      const order = scrollRevealIndex++;
      const compactCard = element.matches(".stats > .stat-card:not(.streak-card)");
      const compactIndex = compactCard
        ? Array.from(element.parentElement?.children || []).indexOf(element)
        : 0;
      const direction = compactCard ? (compactIndex % 2 ? 1 : -1) : (order % 2 ? 1 : -1);
      element.dataset.gsapScrollDirection = direction > 0 ? "right" : "left";
      gsap.set(element, {
        x: element.matches("footer, .month-summary") ? 0 : direction * (element.matches(".history") ? 82 : 62),
        y: element.matches(".history") ? 82 : 58,
        z: element.matches("footer") ? 0 : -140,
        scale: element.matches("footer") ? 0.92 : 0.86,
        rotationX: element.matches("footer") ? 0 : 17,
        rotationY: element.matches("footer, .month-summary") ? 0 : direction * -11,
        rotationZ: element.matches(".history") ? direction * 1.8 : direction * 0.8,
        skewY: element.matches("footer") ? 0 : direction * 1.25,
        autoAlpha: 0,
        transformOrigin: "50% 100%",
        transformPerspective: 1100,
      });
    });

    const triggers = ScrollTrigger.batch(elements, {
      start: "clamp(top 90%)",
      once: true,
      interval: 0.08,
      batchMax: 3,
      onEnter: (batch) => {
        batch.forEach((element) => {
          element.dataset.gsapScroll = "entering";
          const direction = element.dataset.gsapScrollDirection === "right" ? 1 : -1;
          const layers = getScrollLayers(element);
          const sheen = element.querySelector(":scope > .gsap-scroll-sheen");
          let timeline = null;
          timeline = gsap.timeline({
            defaults: { ease: "expo.out" },
            onComplete: () => {
              element.dataset.gsapScroll = "entered";
              gsap.set([element, ...layers, sheen].filter(Boolean), {
                clearProps: "transform,opacity,visibility,transformOrigin",
              });
            },
          });
          timeline.to(element, {
            x: 0,
            y: 0,
            z: 0,
            scale: 1,
            rotationX: 0,
            rotationY: 0,
            rotationZ: 0,
            skewY: 0,
            autoAlpha: 1,
            duration: 1.08,
            ease: "back.out(1.42)",
            overwrite: "auto",
          }, 0);
          if (layers.length) {
            timeline.fromTo(layers, {
              x: direction * 26,
              y: 28,
              z: -90,
              rotationY: direction * -8,
              scale: 0.9,
              autoAlpha: 0,
            }, {
              x: 0,
              y: 0,
              z: 0,
              rotationY: 0,
              scale: 1,
              autoAlpha: 1,
              duration: 0.82,
              stagger: 0.065,
              ease: "power4.out",
            }, 0.18);
          }
          if (sheen) {
            timeline.fromTo(sheen, { xPercent: -190, autoAlpha: 0 }, {
              xPercent: 230,
              autoAlpha: 0.86,
              duration: 0.92,
              ease: "power2.inOut",
            }, 0.12);
          }
        });
      },
    });
    triggers.forEach((trigger) => scrollRevealTriggers.add(trigger));
  }

  function scanScrollMotion(scope = document) {
    if (!ScrollTrigger || reducedMotion) return;
    ensureScrollProgress();
    document.querySelectorAll(scrollShowcaseSelector).forEach(ensureScrollDecorations);
    const elements = Array.from(scope.querySelectorAll?.(scrollRevealSelector) || [])
      .filter((element) => !scrollRevealSeen.has(element));
    if (!elements.length) return;
    elements.forEach((element) => scrollRevealSeen.add(element));
    revealScrollBatch(elements);
    scheduleScrollRefresh();
  }

  function stopScrollMotion() {
    if (pendingScrollRefresh) cancelAnimationFrame(pendingScrollRefresh);
    pendingScrollRefresh = 0;
    scrollRevealTriggers.forEach((trigger) => trigger.kill?.());
    scrollRevealTriggers.clear();
    scrollDepthTweens.forEach((tween) => {
      tween.scrollTrigger?.kill?.();
      tween.kill?.();
    });
    scrollDepthTweens.clear();
    scrollProgressTweens.forEach((tween) => {
      tween.scrollTrigger?.kill?.();
      tween.kill?.();
    });
    scrollProgressTweens.clear();
    scrollProgressElement?.remove();
    scrollProgressElement = null;
    document.querySelectorAll(".gsap-scroll-orb, .gsap-scroll-wire, .gsap-scroll-sheen").forEach((element) => element.remove());
    document.querySelectorAll(scrollRevealSelector).forEach((element) => {
      element.dataset.gsapScroll = "entered";
      delete element.dataset.gsapShowcase;
      delete element.dataset.gsapScrollDirection;
      gsap.set(element, { clearProps: "transform,opacity,visibility,transformOrigin" });
    });
  }

  function scanShowcaseEffects(scope = document) {
    ensureVelocityField();
    scanReactiveCards(scope);
    scanLeaderboardPodiums(scope);
    scanCalendarTransitions(scope);
  }

  function queueScan() {
    if (pendingScan) return;
    pendingScan = requestAnimationFrame(() => {
      pendingScan = 0;
      runCinematicIntro();
      scanLeaderboardNumbers();
      scanRings();
      scanSheets();
      scanScrollMotion();
      scanShowcaseEffects();
      scanMilestones();
    });
  }

  function stopActiveMotion() {
    cinematicIntroTimeline?.kill?.();
    finishCinematicIntro();
    activeCheckinTimelines.forEach((timeline) => timeline.kill?.());
    activeCheckinTimelines.clear();
    document.querySelectorAll(".gsap-checkin-impact").forEach((element) => element.remove());
    activeLeaderboardRaceTimelines.forEach((timeline) => timeline.kill?.());
    activeLeaderboardRaceTimelines.clear();
    document.querySelectorAll(".gsap-leaderboard-race-fx, .gsap-leaderboard-race-ghost").forEach((element) => element.remove());
    document.querySelectorAll(".leaderboard-list").forEach((list) => {
      list.classList.remove("is-gsap-flipping");
      delete list.dataset.gsapRace;
      gsap.set(list, { clearProps: "transform,opacity,visibility,transformOrigin" });
    });
    stopScrollMotion();
    stopReactiveMotion();
    stopCalendarMotion();
    activePodiumTimelines.forEach((timeline) => timeline.kill?.());
    activePodiumTimelines.clear();
    document.querySelectorAll(".leaderboard-podium-scene").forEach((scene) => {
      scene.dataset.gsapPodium = "entered";
      gsap.set([
        scene.querySelector(".leaderboard-podium-horizon"),
        ...scene.querySelectorAll(".leaderboard-podium-card, .leaderboard-podium-crown, .leaderboard-podium-avatar, .leaderboard-podium-beam, .leaderboard-podium-plinth"),
      ].filter(Boolean), { clearProps: "transform,opacity,visibility,transformOrigin" });
    });
    activeMilestoneTimelines.forEach((timeline) => timeline.kill?.());
    activeMilestoneTimelines.clear();
    transientTimelineSafetyTimers.forEach((timer) => window.clearTimeout(timer));
    transientTimelineSafetyTimers.clear();
    document.querySelectorAll(".milestone-pop").forEach((overlay) => {
      const card = overlay.querySelector(":scope > div:not(.gsap-milestone-fx)");
      const targets = [overlay, card, ...Array.from(card?.children || [])].filter(Boolean);
      gsap.set(targets, { clearProps: "transform,opacity,visibility,transformOrigin" });
      overlay.querySelector(".gsap-milestone-fx")?.remove();
      if (overlay.classList.contains("gsap-milestone-custom")) overlay.remove();
      else overlay.dataset.gsapMilestone = "complete";
    });
    activeNumberElements.forEach((element) => {
      const target = numberTargetState.get(element);
      const complete = numberCompletion.get(element);
      numberTweens.get(element)?.kill();
      if (Number.isFinite(target)) {
        const textNode = getTextNode(element);
        if (textNode) textNode.data = String(Math.round(target));
      }
      numberTweens.delete(element);
      numberTargetState.delete(element);
      numberCompletion.delete(element);
      clearAnimatingFlag(element);
      complete?.();
    });
    activeNumberElements.clear();
    activeRings.forEach((circle) => {
      ringTweens.get(circle)?.kill();
      const target = ringState.get(circle);
      if (Number.isFinite(target)) gsap.set(circle, { strokeDashoffset: target });
      clearAnimatingFlag(circle);
    });
    activeRings.clear();
    gsap.killTweensOf([
      ".answer",
      ".answer-icon",
      ".answer-icon path",
      ".hero h1",
      ".subline",
      ".gsap-checkin-wash",
      ".gsap-checkin-impact",
      ".gsap-cinematic-intro",
      ".gsap-leaderboard-race-fx",
      ".gsap-leaderboard-race-ghost",
      ".leaderboard-overlay",
      ".leaderboard-panel",
      ".pwa-reminder-overlay",
      ".pwa-reminder-panel",
      ".recovery-editor",
      ".recovery-editor-panel",
      ".month-sheet",
      ".month-panel",
      ".history-sheet",
      ".history-panel",
    ]);
    document.querySelectorAll(".gsap-checkin-wash").forEach((element) => element.remove());
    document.querySelectorAll("[data-gsap-animating]").forEach(clearAnimatingFlag);
    document.querySelectorAll(".is-gsap-flipping").forEach((element) => element.classList.remove("is-gsap-flipping"));
    sheetDefinitions.forEach((definition) => {
      document.querySelectorAll(definition.overlay).forEach((element) => {
        const panel = element.querySelector(definition.panel);
        gsap.set(element, { clearProps: "opacity,visibility" });
        if (panel) gsap.set(panel, { clearProps: "transform,opacity,visibility" });
        controlledSheetState.set(element, definition.open(element));
      });
    });
    transientSheetDefinitions.forEach((definition) => {
      document.querySelectorAll(definition.overlay).forEach((element) => {
        const panel = element.querySelector(definition.panel);
        gsap.set(element, { clearProps: "opacity,visibility" });
        if (panel) gsap.set(panel, { clearProps: "transform,opacity,visibility" });
      });
    });
  }

  const media = gsap.matchMedia();
  media.add(
    {
      reduceMotion: "(prefers-reduced-motion: reduce)",
      fullMotion: "(prefers-reduced-motion: no-preference)",
    },
    (context) => {
      reducedMotion = Boolean(context.conditions.reduceMotion);
      html.dataset.gsapMotion = reducedMotion ? "reduced" : "full";
      if (reducedMotion) stopActiveMotion();
      else html.dataset.gsapIntro = cinematicIntroStarted ? "complete" : "pending";
      requestAnimationFrame(queueScan);
      return () => stopActiveMotion();
    },
  );

  window.ChonglemaGsapMotion = Object.freeze({
    animateNumber,
    captureLeaderboard,
    celebrateMilestone,
    playLeaderboardFlip,
    scanRings,
    scanShowcaseEffects,
    usesScrollTrigger: Boolean(ScrollTrigger),
  });

  document.addEventListener("click", scheduleCheckinTimeline, true);
  document.addEventListener("click", captureCalendarNavigation, true);
  document.addEventListener("pointerdown", beginCalendarGesture, true);
  document.addEventListener("pointerup", finishCalendarGesture, true);
  document.addEventListener("pointercancel", () => { calendarGesture = null; }, true);
  bodyObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes") {
        const definition = findSheetDefinition(mutation.target);
        if (definition) animateSheet(mutation.target, definition.open(mutation.target), definition);
        return;
      }
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        const definition = findSheetDefinition(node);
        if (definition) {
          controlledSheetState.set(node, false);
          animateSheet(node, definition.open(node), definition);
        }
        transientSheetDefinitions.forEach((item) => {
          if (node.matches(item.overlay)) animateTransientSheet(node, item);
          node.querySelectorAll?.(item.overlay).forEach((element) => animateTransientSheet(element, item));
        });
      });
    });
    queueScan();
  });
  bodyObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "hidden"],
    childList: true,
    characterData: true,
    subtree: true,
  });

  window.addEventListener("pagehide", () => {
    bodyObserver?.disconnect();
    if (pendingScan) cancelAnimationFrame(pendingScan);
    stopActiveMotion();
    media.revert();
  }, { once: true });

  html.classList.add("gsap-motion-ready");
  requestAnimationFrame(queueScan);
  window.setTimeout(() => {
    if (!cinematicIntroStarted && html.dataset.gsapIntro === "pending") {
      html.dataset.gsapIntro = "complete";
    }
  }, 1800);
})();
