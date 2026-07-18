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
  const activeNumberElements = new Set();
  const activeRings = new Set();
  let reducedMotion = reducedMotionQuery.matches;
  let bodyObserver = null;
  let pendingScan = 0;
  let pendingScrollRefresh = 0;
  let scrollProgressElement = null;
  let scrollProgressTween = null;

  const scrollRevealSelector = [
    ".leaderboard-inline-entry",
    ".catchup",
    ".stats > .stat-card",
    ".month-summary",
    ".history",
    "footer",
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

    const timeline = gsap.timeline({
      defaults: { ease: "power3.out" },
      onComplete: () => {
        wash.remove();
        delete hero.dataset.gsapCheckin;
        clearAnimatingFlag(answer);
        gsap.set(targets, { clearProps: "transform,opacity,visibility" });
        if (path) gsap.set(path, { clearProps: "strokeDasharray,strokeDashoffset" });
      },
    });

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
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const selected = document.querySelector(`.hero.completed .answer.${type}.selected`);
        if (selected) runCheckinTimeline(selected);
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
    if (reducedMotion || !Flip || !list) return null;
    const targets = list.querySelectorAll("[data-flip-id]");
    if (!targets.length) return null;
    return Flip.getState(targets, { props: "opacity" });
  }

  function playLeaderboardFlip(flipState, list) {
    if (reducedMotion || !Flip || !flipState || !list) return null;
    const targets = list.querySelectorAll("[data-flip-id]");
    if (!targets.length) return null;
    list.classList.add("is-gsap-flipping");
    const animation = Flip.from(flipState, {
      targets,
      absolute: true,
      scale: true,
      simple: true,
      duration: 0.48,
      ease: "power3.inOut",
      stagger: 0.025,
      onEnter: (elements) => gsap.fromTo(elements, { y: 10, autoAlpha: 0 }, {
        y: 0,
        autoAlpha: 1,
        duration: 0.34,
        stagger: 0.025,
        ease: "power2.out",
      }),
      onLeave: (elements) => gsap.to(elements, {
        y: -8,
        autoAlpha: 0,
        duration: 0.2,
        ease: "power2.in",
      }),
      onComplete: () => list.classList.remove("is-gsap-flipping"),
      onInterrupt: () => list.classList.remove("is-gsap-flipping"),
    });
    return animation;
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
    progress.innerHTML = "<i></i>";
    document.body.append(progress);
    scrollProgressElement = progress;

    const bar = progress.firstElementChild;
    gsap.set(bar, { scaleX: 0, transformOrigin: "0 50%" });
    scrollProgressTween = gsap.to(bar, {
      scaleX: 1,
      ease: "none",
      scrollTrigger: {
        id: "page-progress",
        start: 0,
        end: "max",
        scrub: 0.18,
      },
    });
  }

  function revealScrollBatch(elements) {
    elements.forEach((element) => {
      element.dataset.gsapScroll = "waiting";
      element.classList.remove("motion-card", "motion-enter");
      const compactCard = element.matches(".stats > .stat-card:not(.streak-card)");
      const compactIndex = compactCard
        ? Array.from(element.parentElement?.children || []).indexOf(element)
        : 0;
      gsap.set(element, {
        x: compactCard ? (compactIndex % 2 ? 22 : -22) : 0,
        y: element.matches(".history") ? 46 : 34,
        scale: element.matches("footer") ? 1 : 0.97,
        autoAlpha: 0,
        transformOrigin: "50% 100%",
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
        });
        gsap.to(batch, {
          x: 0,
          y: 0,
          scale: 1,
          autoAlpha: 1,
          duration: 0.72,
          stagger: 0.085,
          ease: "power3.out",
          overwrite: "auto",
          onComplete: () => {
            batch.forEach((element) => {
              element.dataset.gsapScroll = "entered";
            });
            gsap.set(batch, { clearProps: "transform,opacity,visibility,transformOrigin" });
          },
        });
      },
    });
    triggers.forEach((trigger) => scrollRevealTriggers.add(trigger));
  }

  function scanScrollMotion(scope = document) {
    if (!ScrollTrigger || reducedMotion) return;
    ensureScrollProgress();
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
    scrollProgressTween?.kill?.();
    scrollProgressTween = null;
    scrollProgressElement?.remove();
    scrollProgressElement = null;
    document.querySelectorAll(scrollRevealSelector).forEach((element) => {
      element.dataset.gsapScroll = "entered";
      gsap.set(element, { clearProps: "transform,opacity,visibility,transformOrigin" });
    });
  }

  function queueScan() {
    if (pendingScan) return;
    pendingScan = requestAnimationFrame(() => {
      pendingScan = 0;
      scanLeaderboardNumbers();
      scanRings();
      scanSheets();
      scanScrollMotion();
    });
  }

  function stopActiveMotion() {
    stopScrollMotion();
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
      requestAnimationFrame(queueScan);
      return () => stopActiveMotion();
    },
  );

  window.ChonglemaGsapMotion = Object.freeze({
    animateNumber,
    captureLeaderboard,
    playLeaderboardFlip,
    scanRings,
    usesScrollTrigger: Boolean(ScrollTrigger),
  });

  document.addEventListener("click", scheduleCheckinTimeline, true);
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
})();
