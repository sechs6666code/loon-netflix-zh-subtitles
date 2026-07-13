(() => {
  const root = document.getElementById("root");
  if (!root) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const seenEntrance = new WeakSet();
  const numberState = new WeakMap();
  const numberLocks = new WeakSet();
  const pieState = new WeakMap();
  const pieAnimation = new WeakMap();
  const seenPieEntrance = new WeakSet();
  let entranceIndex = 0;
  let displayedMonth = null;
  let monthTransitionTimer = 0;

  const clamp = (value, minimum, maximum) =>
    Math.min(maximum, Math.max(minimum, value));

  const easeOutCubic = (progress) => 1 - Math.pow(1 - progress, 3);

  const getTextNode = (element) =>
    Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);

  const numberElements = () =>
    document.querySelectorAll(
      ".pie-center strong, .progress-ring strong, .stats > .stat-card:not(.streak-card) > strong"
    );

  const animateNumber = (element, from, to, duration = 420) => {
    const textNode = getTextNode(element);
    if (!textNode || from === to || reducedMotion.matches) return;

    numberLocks.add(element);
    element.classList.remove("motion-number-changing");
    void element.offsetWidth;
    element.classList.add("motion-number-changing");

    const started = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - started) / duration);
      textNode.data = String(Math.round(from + (to - from) * easeOutCubic(progress)));
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        textNode.data = String(to);
        numberState.set(element, to);
        numberLocks.delete(element);
        window.setTimeout(() => element.classList.remove("motion-number-changing"), 80);
      }
    };

    requestAnimationFrame(tick);
  };

  const scanNumbers = () => {
    numberElements().forEach((element) => {
      if (numberLocks.has(element)) return;
      const textNode = getTextNode(element);
      const value = Number.parseInt(textNode?.data || "", 10);
      if (!Number.isFinite(value)) return;

      if (!numberState.has(element)) {
        numberState.set(element, value);
        return;
      }

      const previous = numberState.get(element);
      if (previous !== value) {
        numberState.set(element, value);
        animateNumber(element, previous, value);
      }
    });
  };

  const parseTrailingNumber = (element) => {
    const match = element?.textContent?.match(/(\d+)\s*$/);
    return match ? Number.parseInt(match[1], 10) : 0;
  };

  const readPieData = (side) => {
    const no = parseTrailingNumber(side.querySelector(".pie-legend .no"));
    const yes = parseTrailingNumber(side.querySelector(".pie-legend .yes"));
    const monthMatch = side.querySelector(":scope > span")?.textContent?.match(/(\d+)月/);
    return {
      month: monthMatch ? Number.parseInt(monthMatch[1], 10) : 0,
      no,
      yes,
    };
  };

  const percentages = (data) => {
    const total = data.no + data.yes;
    if (!total) return { no: 0, yes: 0 };
    const no = (data.no / total) * 100;
    return { no, yes: 100 - no };
  };

  const ensurePieStructure = (side) => {
    const center = side.querySelector(".pie-center");
    if (!center) return;

    let value = center.querySelector(".pie-value");
    if (!value) {
      const strong = center.querySelector("strong");
      const unit = center.querySelector(":scope > small");
      if (strong && unit) {
        value = document.createElement("span");
        value.className = "pie-value";
        center.insertBefore(value, strong);
        value.append(strong, unit);
      }
    }

    if (!center.querySelector(".pie-center-label")) {
      const label = document.createElement("small");
      label.className = "pie-center-label";
      label.textContent = "本月没冲率";
      center.append(label);
    }

    const legend = side.querySelector(".pie-legend");
    legend?.querySelectorAll("span").forEach((item) => {
      const type = item.classList.contains("no") ? "no" : "yes";
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      item.setAttribute("aria-pressed", "false");
      item.setAttribute("aria-label", `突出显示${type === "no" ? "没冲" : "冲了"}的数据`);
    });
  };

  const buildPieGradient = (data, reveal = 100, focus = "") => {
    const values = percentages(data);
    const progress = clamp(reveal, 0, 100);
    const track = "color-mix(in srgb, var(--line) 86%, transparent)";
    const greenStart = focus === "yes"
      ? "color-mix(in srgb, var(--green) 23%, var(--line))"
      : "color-mix(in srgb, var(--green) 80%, #92e8c6)";
    const greenEnd = focus === "yes"
      ? "color-mix(in srgb, var(--green) 28%, var(--line))"
      : "var(--green)";
    const redStart = focus === "no"
      ? "color-mix(in srgb, var(--red) 22%, var(--line))"
      : "color-mix(in srgb, var(--red) 82%, #ffaaa2)";
    const redEnd = focus === "no"
      ? "color-mix(in srgb, var(--red) 27%, var(--line))"
      : "var(--red)";

    if (!data.no && !data.yes) {
      return `conic-gradient(${track} 0% 100%)`;
    }

    const both = values.no > 0 && values.yes > 0;
    const gap = both ? Math.min(.58, values.no * .16, values.yes * .16) : 0;
    const noEnd = Math.max(0, values.no - gap);
    const yesStart = Math.min(100, values.no + gap);
    const stops = [];

    if (values.no > 0 && progress > 0) {
      const greenReveal = Math.min(progress, noEnd || values.no);
      if (greenReveal > 0) {
        stops.push(`${greenStart} 0%`, `${greenEnd} ${greenReveal.toFixed(2)}%`);
      }
    }

    if (both && progress > noEnd) {
      const gapReveal = Math.min(progress, yesStart);
      stops.push(`${track} ${noEnd.toFixed(2)}%`, `${track} ${gapReveal.toFixed(2)}%`);
    }

    if (values.yes > 0 && progress > yesStart) {
      const redReveal = Math.min(progress, 100);
      stops.push(`${redStart} ${yesStart.toFixed(2)}%`, `${redEnd} ${redReveal.toFixed(2)}%`);
    } else if (values.yes > 0 && values.no === 0 && progress > 0) {
      stops.push(`${redStart} 0%`, `${redEnd} ${progress.toFixed(2)}%`);
    }

    if (!stops.length) {
      stops.push(`${track} 0%`);
    }
    stops.push(`${track} ${progress.toFixed(2)}%`, `${track} 100%`);
    return `conic-gradient(from 0deg, ${stops.join(", ")})`;
  };

  const paintPie = (chart, data, reveal = 100) => {
    chart.style.background = buildPieGradient(data, reveal, chart.dataset.pieFocus || "");
  };

  const animatePie = (side, fromData, toData, entrance = false) => {
    const chart = side.querySelector(".pie-chart");
    if (!chart) return;

    const previousAnimation = pieAnimation.get(chart);
    if (previousAnimation) cancelAnimationFrame(previousAnimation.frame);

    if (reducedMotion.matches) {
      paintPie(chart, toData, 100);
      return;
    }

    const token = {};
    const duration = entrance ? 760 : 520;
    const started = performance.now();
    const fromPercent = percentages(fromData);
    const toPercent = percentages(toData);
    side.classList.add("pie-data-changing");

    const tick = (now) => {
      if (pieAnimation.get(chart)?.token !== token) return;
      const progress = Math.min(1, (now - started) / duration);
      const eased = easeOutCubic(progress);

      if (entrance) {
        paintPie(chart, toData, eased * 100);
      } else {
        const noPercent = fromPercent.no + (toPercent.no - fromPercent.no) * eased;
        const synthetic = { no: noPercent, yes: 100 - noPercent };
        paintPie(chart, synthetic, 100);
      }

      if (progress < 1) {
        const frame = requestAnimationFrame(tick);
        pieAnimation.set(chart, { token, frame });
      } else {
        paintPie(chart, toData, 100);
        pieAnimation.delete(chart);
        window.setTimeout(() => side.classList.remove("pie-data-changing"), 80);
      }
    };

    const frame = requestAnimationFrame(tick);
    pieAnimation.set(chart, { token, frame });
  };

  const applyPieHealth = (side, data) => {
    const card = side.closest(".streak-card");
    if (!card) return;
    const rate = percentages(data).no;
    card.dataset.health = data.no + data.yes === 0 ? "empty" : rate >= 80 ? "strong" : "mixed";
    card.dataset.hasYes = data.yes > 0 ? "true" : "false";
  };

  const setPieFocus = (side, focus, shouldAnimate = true) => {
    const chart = side.querySelector(".pie-chart");
    const legend = side.querySelector(".pie-legend");
    if (!chart || !legend) return;

    if (focus) {
      chart.dataset.pieFocus = focus;
      legend.dataset.active = focus;
    } else {
      delete chart.dataset.pieFocus;
      delete legend.dataset.active;
    }

    legend.querySelectorAll("span").forEach((item) => {
      const type = item.classList.contains("no") ? "no" : "yes";
      item.setAttribute("aria-pressed", String(type === focus));
    });

    const state = pieState.get(chart);
    if (state) paintPie(chart, state.data, 100);
    if (shouldAnimate) {
      chart.classList.remove("is-highlighted");
      void chart.offsetWidth;
      chart.classList.add("is-highlighted");
      window.setTimeout(() => chart.classList.remove("is-highlighted"), 390);
    }
  };

  const enterPie = (side) => {
    if (seenPieEntrance.has(side)) return;
    seenPieEntrance.add(side);
    const chart = side.querySelector(".pie-chart");
    const strong = side.querySelector(".pie-center strong");
    const state = chart ? pieState.get(chart) : null;
    if (!chart || !state) return;

    state.entered = true;
    animatePie(side, { no: 0, yes: 0 }, state.data, true);
    const value = Number.parseInt(getTextNode(strong)?.data || "", 10);
    if (strong && Number.isFinite(value) && value > 0) {
      animateNumber(strong, 0, value, 720);
    }
  };

  const pieEntranceObserver = "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            enterPie(entry.target);
            pieEntranceObserver.unobserve(entry.target);
          });
        },
        { threshold: .28, rootMargin: "0px 0px -3%" }
      )
    : null;

  const scanPie = () => {
    document.querySelectorAll(".pie-side").forEach((side) => {
      ensurePieStructure(side);
      const chart = side.querySelector(".pie-chart");
      if (!chart) return;
      const data = readPieData(side);
      applyPieHealth(side, data);

      const previous = pieState.get(chart);
      if (!previous) {
        pieState.set(chart, { data, entered: false });
        paintPie(chart, data, reducedMotion.matches ? 100 : 0);
        if (reducedMotion.matches || !pieEntranceObserver) {
          enterPie(side);
        } else {
          pieEntranceObserver.observe(side);
        }
        return;
      }

      if (previous.data.month !== data.month || previous.data.no !== data.no || previous.data.yes !== data.yes) {
        const fromData = previous.data;
        previous.data = data;
        if (fromData.month !== data.month) setPieFocus(side, "", false);
        if (previous.entered) {
          animatePie(side, fromData, data, false);
        } else {
          paintPie(chart, data, 0);
        }
      }
    });
  };

  const scanMonthTransition = () => {
    const title = document.querySelector(".pie-side > span");
    const match = title?.textContent?.match(/(\d+)月/);
    if (!match) return;
    const current = Number.parseInt(match[1], 10);
    if (!Number.isFinite(current)) return;

    if (displayedMonth === null) {
      displayedMonth = current;
      return;
    }
    if (displayedMonth === current) return;

    const directionClass = current > displayedMonth ? "month-data-next" : "month-data-prev";
    displayedMonth = current;
    const targets = document.querySelectorAll(
      ".stats > .stat-card, .month-summary"
    );
    targets.forEach((target) => target.classList.remove("month-data-next", "month-data-prev"));
    void document.body.offsetWidth;
    targets.forEach((target) => target.classList.add(directionClass));
    window.clearTimeout(monthTransitionTimer);
    monthTransitionTimer = window.setTimeout(() => {
      targets.forEach((target) => target.classList.remove("month-data-next", "month-data-prev"));
    }, 430);
  };

  const entranceObserver = "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("motion-enter");
            entranceObserver.unobserve(entry.target);
          });
        },
        { threshold: 0.08, rootMargin: "0px 0px -4%" }
      )
    : null;

  const scanEntrances = () => {
    document
      .querySelectorAll(
        ".topbar, .hero, .catchup, .stats .stat-card, .month-summary, .history, footer"
      )
      .forEach((element) => {
        if (seenEntrance.has(element)) return;
        seenEntrance.add(element);
        element.classList.add("motion-card");
        element.style.setProperty("--motion-index", String(Math.min(entranceIndex++, 7)));

        if (reducedMotion.matches || !entranceObserver) {
          element.classList.add("motion-enter");
        } else {
          entranceObserver.observe(element);
        }
      });
  };

  const updateCompletedState = () => {
    const hero = document.querySelector(".hero");
    if (!hero) return;

    const selected = hero.querySelector(".answer.selected");
    hero.querySelectorAll(".answer").forEach((answer) => {
      const small = answer.querySelector("small");
      if (!small) return;
      if (!small.dataset.originalCopy) small.dataset.originalCopy = small.textContent;
      small.textContent = small.dataset.originalCopy;
      answer.removeAttribute("title");
    });

    if (hero.classList.contains("completed") && selected && !hero.classList.contains("motion-editing")) {
      const small = selected.querySelector("small");
      if (small) small.textContent = "今日已记录 · 轻点修改";
      selected.title = "修改今天的记录";
    }
  };

  const pulseTodayOnce = () => {
    const today = document.querySelector(".calendar-day.today");
    if (!today || today.dataset.motionPulse === "done") return;
    today.dataset.motionPulse = "done";
    if (reducedMotion.matches) return;
    today.classList.add("motion-today-pulse");
    window.setTimeout(() => today.classList.remove("motion-today-pulse"), 980);
  };

  const scan = () => {
    scanEntrances();
    scanNumbers();
    scanPie();
    scanMonthTransition();
    updateCompletedState();
    pulseTodayOnce();
  };

  const observer = new MutationObserver(() => requestAnimationFrame(scan));
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  document.addEventListener(
    "click",
    (event) => {
      const pieLegendItem = event.target.closest(".pie-legend span");
      if (pieLegendItem) {
        event.preventDefault();
        const side = pieLegendItem.closest(".pie-side");
        const chart = side?.querySelector(".pie-chart");
        if (side && chart) {
          const type = pieLegendItem.classList.contains("no") ? "no" : "yes";
          setPieFocus(side, chart.dataset.pieFocus === type ? "" : type);
        }
        return;
      }

      const selected = event.target.closest(".hero.completed .answer.selected");
      const hero = selected?.closest(".hero");
      if (selected && hero && !hero.classList.contains("motion-editing")) {
        event.preventDefault();
        event.stopPropagation();
        hero.classList.add("motion-editing");
        updateCompletedState();
        return;
      }

      const answer = event.target.closest(".hero.motion-editing .answer");
      if (answer) {
        window.setTimeout(() => {
          answer.closest(".hero")?.classList.remove("motion-editing");
          updateCompletedState();
        }, 80);
      }

      const day = event.target.closest(".calendar-day");
      if (day && !day.disabled) {
        const rect = day.getBoundingClientRect();
        const origin = ((rect.left + rect.width / 2) / window.innerWidth) * 100;
        document.documentElement.style.setProperty("--history-origin-x", `${origin}%`);
      }
    },
    true
  );

  document.addEventListener("keydown", (event) => {
    const item = event.target.closest?.(".pie-legend span");
    if (!item || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    item.click();
  });

  const switchMonth = (direction) => {
    const label = direction > 0 ? "下个月" : "上个月";
    const button = document.querySelector(`.month-switcher button[aria-label="${label}"]`);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  };

  let wheelCooldown = 0;
  document.addEventListener(
    "wheel",
    (event) => {
      if (!event.target.closest(".calendar-month")) return;
      if (Math.abs(event.deltaX) < 34 || Math.abs(event.deltaX) < Math.abs(event.deltaY) * 1.1) return;
      const now = performance.now();
      if (now < wheelCooldown) return;
      wheelCooldown = now + 520;
      event.preventDefault();
      switchMonth(event.deltaX > 0 ? 1 : -1);
    },
    { passive: false }
  );

  reducedMotion.addEventListener?.("change", scan);
  requestAnimationFrame(scan);
})();
