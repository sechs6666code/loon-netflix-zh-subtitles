(() => {
  const MODULE_ID = "recovery-vault";
  const EDITOR_ID = "recovery-editor";
  const RECORDS_KEY = "did-you-v1";
  const RECOVERY_KEY = "chonglema-recovery-v1";
  const MOTION_KEY = "chonglema-recovery-motion-v1";
  const MOTION_HINT_KEY = "chonglema-recovery-motion-hint-v1";
  const MOTION_CALIBRATION_COUNT = 7;
  const MOTION_TILT_GAIN = 1.2;
  const MOTION_TILT_LIMIT = 32;
  const RECOVERY_VESSEL_ASPECT = 894 / 760;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const lowPerformanceDevice =
    (Number(navigator.hardwareConcurrency) > 0 && Number(navigator.hardwareConcurrency) <= 4) ||
    (Number(navigator.deviceMemory) > 0 && Number(navigator.deviceMemory) <= 4);

  const stages = [
    { label: "刚刚释放", maximum: 20 },
    { label: "恢复启动", maximum: 45 },
    { label: "明显恢复", maximum: 70 },
    { label: "接近平时水平", maximum: 90 },
    { label: "稳定区间", maximum: 100 },
  ];

  const encouragements = [
    "先照顾好当下，规律作息就够了。",
    "恢复已经启动，把注意力慢慢放回生活。",
    "你的身体正在逐步回到稳定状态。",
    "保持现在的节奏，恢复正在趋于平稳。",
    "已经进入稳定区间，把注意力投入更重要的事情。",
  ];

  const particlePositions = [
    [18, 18, -1.1],
    [71, 27, -2.6],
    [39, 47, -4.4],
    [82, 55, -1.9],
    [57, 68, -5.2],
    [27, 76, -3.4],
    [66, 84, -6.1],
    [48, 32, -7.3],
  ];

  let moduleElement;
  let editorElement;
  let releaseState = null;
  let recordsSnapshot = "";
  let currentProgress = null;
  let currentVisualLevel = 0;
  let toastTimer = 0;
  let feedbackTimer = 0;
  let motionHintTimer = 0;
  let mountObserver;
  let stageObserver;
  let motionEnabled = false;
  let motionPermissionPending = false;
  let motionPreferred = readMotionPreference();
  let motionFrame = 0;
  let motionLastFrame = 0;
  let motionBaseline = null;
  let motionCalibrationSamples = [];
  let motionCalibrating = false;
  let motionLastReading = null;
  let motionInViewport = true;
  let motionListening = false;
  const motionTarget = { tilt: 0, x: 0, y: 0, surge: 0 };
  const motionCurrent = { tilt: 0, x: 0, y: 0, surge: 0, particleX: 0 };
  const motionVelocity = { tilt: 0, x: 0, y: 0, surge: 0, particleX: 0 };

  const localDateKey = (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const clamp = (value, minimum, maximum) =>
    Math.min(maximum, Math.max(minimum, value));

  const deadZone = (value, threshold) => {
    if (Math.abs(value) <= threshold) return 0;
    return Math.sign(value) * (Math.abs(value) - threshold);
  };

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] || 0;
  };

  function screenAngle() {
    const angle = Number(window.screen?.orientation?.angle ?? window.orientation ?? 0);
    return ((angle % 360) + 360) % 360;
  }

  function normalizedOrientation(beta, gamma) {
    switch (screenAngle()) {
      case 90:
        return { side: beta, front: -gamma };
      case 180:
        return { side: -gamma, front: -beta };
      case 270:
        return { side: -beta, front: gamma };
      default:
        return { side: gamma, front: beta };
    }
  }

  function springStep(key, target, deltaSeconds, stiffness = 72, damping = 10) {
    motionVelocity[key] += (target - motionCurrent[key]) * stiffness * deltaSeconds;
    motionVelocity[key] *= Math.exp(-damping * deltaSeconds);
    motionCurrent[key] += motionVelocity[key] * deltaSeconds;
  }

  function readMotionPreference() {
    try {
      return localStorage.getItem(MOTION_KEY) === "on";
    } catch {
      return false;
    }
  }

  function writeMotionPreference(enabled) {
    motionPreferred = enabled;
    try {
      localStorage.setItem(MOTION_KEY, enabled ? "on" : "off");
    } catch {
      // Motion remains available for the current session when storage is blocked.
    }
  }

  releaseState = readReleaseState();

  function readRecords() {
    try {
      const records = JSON.parse(localStorage.getItem(RECORDS_KEY) || "{}");
      return records && typeof records === "object" ? records : {};
    } catch {
      return {};
    }
  }

  function readReleaseState() {
    try {
      const state = JSON.parse(localStorage.getItem(RECOVERY_KEY) || "null");
      if (!state || !Number.isFinite(Number(state.timestamp))) return null;
      const timestamp = Number(state.timestamp);
      if (timestamp > Date.now() + 60_000) return null;
      return {
        timestamp,
        source: state.source === "manual" ? "manual" : "checkin",
        dateKey: state.dateKey || localDateKey(timestamp),
      };
    } catch {
      return null;
    }
  }

  function saveReleaseState(state) {
    releaseState = state;
    if (state) {
      localStorage.setItem(RECOVERY_KEY, JSON.stringify(state));
    } else {
      localStorage.removeItem(RECOVERY_KEY);
    }
    render();
  }

  function latestReleaseFromCheckins(records = readRecords()) {
    const today = localDateKey();
    const dateKey = Object.entries(records)
      .filter(([key, value]) => value === "yes" && /^\d{4}-\d{2}-\d{2}$/.test(key) && key <= today)
      .map(([key]) => key)
      .sort()
      .at(-1);

    if (!dateKey) return null;

    const isToday = dateKey === today;
    const timestamp = isToday
      ? Date.now()
      : new Date(`${dateKey}T12:00:00`).getTime();

    return {
      timestamp,
      source: "checkin",
      dateKey,
    };
  }

  function syncWithCheckins(force = false) {
    const records = readRecords();
    const snapshot = JSON.stringify(records);
    if (!force && snapshot === recordsSnapshot) return;

    const previous = recordsSnapshot ? JSON.parse(recordsSnapshot) : {};
    recordsSnapshot = snapshot;
    const latest = latestReleaseFromCheckins(records);

    if (!releaseState) {
      if (latest) saveReleaseState(latest);
      return;
    }

    if (releaseState.source === "checkin") {
      if (!latest) {
        saveReleaseState(null);
        return;
      }

      const newlyMarkedToday =
        latest.dateKey === localDateKey() &&
        previous[latest.dateKey] !== "yes" &&
        records[latest.dateKey] === "yes";

      const storedDayWasRemoved = records[releaseState.dateKey] !== "yes";
      if (
        newlyMarkedToday ||
        storedDayWasRemoved ||
        latest.dateKey !== releaseState.dateKey
      ) {
        saveReleaseState(latest);
      }
      return;
    }

    if (latest && latest.dateKey > localDateKey(releaseState.timestamp)) {
      saveReleaseState(latest);
    }
  }

  function recoveryProgress(hours) {
    if (!Number.isFinite(hours) || hours <= 0) return 0;
    if (hours >= 120) return 100;

    if (hours <= 48) {
      return 63 * Math.pow(hours / 48, 0.58);
    }

    const elapsed = hours - 48;
    const numerator = 1 - Math.exp(-elapsed / 80);
    const denominator = 1 - Math.exp(-72 / 80);
    return 63 + 37 * (numerator / denominator);
  }

  function hoursForProgress(target) {
    if (target <= 0) return 0;
    if (target >= 100) return 120;

    let low = 0;
    let high = 120;
    for (let index = 0; index < 48; index += 1) {
      const middle = (low + high) / 2;
      if (recoveryProgress(middle) < target) low = middle;
      else high = middle;
    }
    return high;
  }

  function stageIndexFor(progress) {
    if (progress <= 20) return 0;
    if (progress <= 45) return 1;
    if (progress <= 70) return 2;
    if (progress <= 90) return 3;
    return 4;
  }

  function formatElapsed(milliseconds) {
    const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
    if (totalMinutes < 2) return "刚刚记录";
    if (totalMinutes < 60) return `${totalMinutes}分钟`;

    const totalHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (totalHours < 24) {
      return minutes ? `${totalHours}小时${minutes}分钟` : `${totalHours}小时`;
    }

    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return hours ? `${days}天${hours}小时` : `${days}天`;
  }

  function formatRemaining(hours) {
    const minutes = Math.max(0, Math.ceil(hours * 60));
    if (minutes <= 1) return "即将进入";
    if (minutes < 60) return `约${minutes}分钟后`;

    const roundedHours = Math.ceil(minutes / 60);
    if (roundedHours < 24) return `约${roundedHours}小时后`;

    const days = Math.floor(roundedHours / 24);
    const hoursLeft = roundedHours % 24;
    return hoursLeft ? `约${days}天${hoursLeft}小时后` : `约${days}天后`;
  }

  function formatRecordedAt(timestamp) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
  }

  function toDateTimeInput(timestamp) {
    const date = new Date(timestamp);
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function animatePercentage(to) {
    const numbers = [...(moduleElement?.querySelectorAll(".recovery-percent-number") || [])];
    if (!numbers.length) return;
    const setNumber = (value) => numbers.forEach((number) => { number.textContent = value; });
    const toggleCounting = (counting) => numbers.forEach((number) => number.classList.toggle("is-counting", counting));

    if (to == null) {
      setNumber("--");
      toggleCounting(false);
      currentProgress = null;
      return;
    }

    const target = Math.round(to);
    if (reducedMotion.matches) {
      setNumber(String(target));
      toggleCounting(false);
      currentProgress = target;
      return;
    }

    const from = currentProgress == null ? 0 : currentProgress;
    if (currentProgress == null) {
      setNumber("0");
      currentProgress = 0;
    }
    if (from === target) {
      toggleCounting(false);
      return;
    }
    toggleCounting(true);
    const started = performance.now();
    const duration = 620;

    const tick = (now) => {
      const ratio = clamp((now - started) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - ratio, 3);
      setNumber(String(Math.round(from + (target - from) * eased)));
      if (ratio < 1) requestAnimationFrame(tick);
      else {
        currentProgress = target;
        toggleCounting(false);
      }
    };

    requestAnimationFrame(tick);
  }

  function renderParticles(progress) {
    const fills = [...(moduleElement?.querySelectorAll(".recovery-liquid-fill") || [])];
    if (!fills.length) return;

    const particleLimit = lowPerformanceDevice ? 5 : particlePositions.length;
    const count = progress == null || progress < 6
      ? 0
      : progress >= 91
        ? particleLimit
        : clamp(Math.round(progress / 14), 1, particleLimit);
    const isStable = (progress || 0) > 90;
    const speed = isStable
      ? 13.2
      : clamp(10.4 - (progress || 0) * .036, 7.2, 10.4);
    const depthStyles = [
      { scale: .72, opacity: .4, blur: .45 },
      { scale: 1, opacity: .62, blur: 0 },
      { scale: 1.18, opacity: .74, blur: .12 },
    ];

    fills.forEach((fill) => {
      fill.querySelectorAll(".recovery-particle").forEach((particle) => particle.remove());
    });
    particlePositions.slice(0, count).forEach(([left, bottom, delay], index) => {
      const depth = depthStyles[index % depthStyles.length];
      const chamberIndex = left < 50 ? 0 : 1;
      const fill = fills[chamberIndex] || fills[0];
      const chamberLeft = chamberIndex === 0 ? left * 2 : (left - 50) * 2;
      const particle = document.createElement("img");
      particle.className = "recovery-particle";
      particle.src = "./assets/recovery-particle.png";
      particle.alt = "";
      particle.setAttribute("aria-hidden", "true");
      particle.style.left = `${clamp(chamberLeft, 8, 92)}%`;
      particle.style.bottom = `${Math.min(bottom, 86)}%`;
      particle.style.setProperty("--particle-speed", `${speed + index * .34}s`);
      particle.style.setProperty("--particle-delay", `${delay}s`);
      particle.style.setProperty("--particle-scale", depth.scale);
      particle.style.setProperty("--particle-opacity", isStable ? depth.opacity * .76 : depth.opacity);
      particle.style.setProperty("--particle-blur", `${depth.blur}px`);
      particle.style.setProperty(
        "--particle-drift",
        `var(--recovery-particle-drift-${index % 3 === 0 ? "far" : index % 3 === 1 ? "mid" : "near"})`
      );
      fill.append(particle);
    });
  }

  function renderTimeline(activeIndex) {
    moduleElement?.querySelectorAll(".recovery-stage").forEach((stage, index) => {
      stage.classList.toggle("is-current", activeIndex === index);
      stage.classList.toggle("is-passed", activeIndex > index);
    });
  }

  function setText(selector, value) {
    const element = moduleElement?.querySelector(selector);
    if (element) element.textContent = value;
  }

  function render() {
    if (!moduleElement) return;

    const unit = moduleElement.querySelector(".recovery-percent-value small");
    if (!releaseState) {
      currentVisualLevel = 0;
      moduleElement.classList.add("is-empty");
      moduleElement.classList.remove("is-stable");
      moduleElement.classList.add("is-depleted");
      moduleElement.style.setProperty("--recovery-level", "0%");
      moduleElement.style.setProperty("--recovery-level-left", "0%");
      moduleElement.style.setProperty("--recovery-level-right", "0%");
      applyLiquidSurface();
      moduleElement.classList.remove("has-submerged-number");
      if (unit) unit.hidden = true;
      animatePercentage(null);
      renderParticles(null);
      renderTimeline(-1);
      setText(".recovery-status-pill", "尚未记录释放时间");
      setText(".recovery-summary-line", "记录一次时间后，这里会开始显示恢复趋势。");
      setText(".recovery-next-compact", "仅进行时间趋势估算，不代表身体检测结果");
      setText("[data-recovery=recorded]", "尚未记录");
      setText("[data-recovery=next-stage]", "等待开始");
      setText("[data-recovery=next-time]", "记录后开始估算");
      setText(".recovery-encouragement", "保持觉察，比追求完美更重要。");
      return;
    }

    moduleElement.classList.remove("is-empty");
    if (unit) unit.hidden = false;

    const elapsedMilliseconds = Math.max(0, Date.now() - releaseState.timestamp);
    const elapsedHours = elapsedMilliseconds / 3_600_000;
    const progress = clamp(recoveryProgress(elapsedHours), 0, 100);
    const activeIndex = stageIndexFor(progress);
    const nextIndex = Math.min(activeIndex + 1, stages.length - 1);
    const isStable = activeIndex === stages.length - 1;
    const nextTarget = isStable ? 100 : stages[activeIndex].maximum + 1;
    const remainingHours = Math.max(0, hoursForProgress(nextTarget) - elapsedHours);
    const remaining = isStable ? "已进入稳定区间" : formatRemaining(remainingHours);

    moduleElement.classList.toggle("is-stable", isStable);
    moduleElement.classList.toggle("is-depleted", progress < 2);
    moduleElement.classList.toggle("has-submerged-number", progress >= 55);

    const visualLevel = clamp(progress * .94, 0, 94);
    currentVisualLevel = visualLevel;
    const chamberDifference = progress < 2 ? 0 : clamp(.72 - progress * .0045, .24, .72);
    const leftLevel = clamp(visualLevel - chamberDifference * .45, 0, 94);
    const rightLevel = clamp(visualLevel + chamberDifference * .55, 0, 94);

    requestAnimationFrame(() => {
      moduleElement.style.setProperty("--recovery-level", `${visualLevel.toFixed(2)}%`);
      moduleElement.style.setProperty("--recovery-level-left", `${leftLevel.toFixed(2)}%`);
      moduleElement.style.setProperty("--recovery-level-right", `${rightLevel.toFixed(2)}%`);
      applyLiquidSurface();
    });

    animatePercentage(progress);
    renderParticles(progress);
    renderTimeline(activeIndex);
    setText(".recovery-status-pill", `${formatElapsed(elapsedMilliseconds)} · ${stages[activeIndex].label}`);
    setText(".recovery-summary-line", encouragements[activeIndex]);
    setText(
      ".recovery-next-compact",
      isStable ? "恢复进度已保持稳定" : `下一阶段 · ${remaining}`
    );
    setText("[data-recovery=recorded]", formatRecordedAt(releaseState.timestamp));
    setText("[data-recovery=next-stage]", isStable ? "稳定区间" : stages[nextIndex].label);
    setText("[data-recovery=next-time]", remaining);
    setText(".recovery-encouragement", encouragements[activeIndex]);
  }

  function toggleDetails(force) {
    if (!moduleElement) return;
    const shouldExpand = typeof force === "boolean"
      ? force
      : !moduleElement.classList.contains("is-expanded");
    const summary = moduleElement.querySelector(".recovery-summary");
    const label = moduleElement.querySelector(".recovery-expand-label");

    moduleElement.classList.toggle("is-expanded", shouldExpand);
    summary?.setAttribute("aria-expanded", String(shouldExpand));
    if (label) label.textContent = shouldExpand ? "收起" : "展开";
    navigator.vibrate?.(shouldExpand ? 9 : 5);
  }

  function openEditor() {
    if (!editorElement) return;
    const input = editorElement.querySelector("input");
    const note = editorElement.querySelector(".recovery-editor-note");
    const now = Date.now();

    input.max = toDateTimeInput(now);
    input.value = toDateTimeInput(releaseState?.timestamp || now);
    note.textContent = "";
    editorElement.classList.add("is-open");
    editorElement.setAttribute("aria-hidden", "false");
    document.documentElement.dataset.recoveryEditor = "open";
    window.setTimeout(() => input.focus({ preventScroll: true }), 180);
  }

  function closeEditor() {
    if (!editorElement) return;
    editorElement.classList.remove("is-open");
    editorElement.setAttribute("aria-hidden", "true");
    delete document.documentElement.dataset.recoveryEditor;
  }

  function showToast(message) {
    const toast = document.querySelector(".recovery-toast");
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
  }

  function motionSupported() {
    return typeof window.DeviceOrientationEvent !== "undefined";
  }

  function motionNeedsPermission() {
    return typeof window.DeviceOrientationEvent?.requestPermission === "function";
  }

  function attachMotionListener() {
    if (!motionEnabled || motionListening || document.hidden || !motionInViewport) return;
    window.addEventListener("deviceorientation", handleDeviceOrientation, { passive: true });
    motionListening = true;
  }

  function detachMotionListener() {
    if (!motionListening) return;
    window.removeEventListener("deviceorientation", handleDeviceOrientation);
    motionListening = false;
  }

  function beginMotionCalibration({ quiet = false } = {}) {
    motionBaseline = null;
    motionCalibrationSamples = [];
    motionCalibrating = Boolean(motionEnabled);
    motionLastReading = null;
    motionTarget.tilt = 0;
    motionTarget.x = 0;
    motionTarget.y = 0;
    motionTarget.surge = 0;
    moduleElement?.classList.toggle("is-calibrating", motionCalibrating);
    updateMotionControl();
    if (motionCalibrating && !quiet) showToast("保持当前握持姿势，正在校准液面");
  }

  function resetMotionBaseline() {
    if (motionEnabled) beginMotionCalibration({ quiet: true });
    else {
      motionBaseline = null;
      motionCalibrationSamples = [];
      motionCalibrating = false;
      motionLastReading = null;
    }
  }

  function applyLiquidSurface() {
    if (!moduleElement) return;

    const liquidPercent = clamp(currentVisualLevel, 0, 100);
    const airPercent = 100 - liquidPercent;
    const radians = motionCurrent.tilt * Math.PI / 180;
    const slope = Math.tan(radians) * RECOVERY_VESSEL_ASPECT * 100;
    const halfRange = Math.abs(slope) / 2;
    let center = airPercent;

    // Keep both lobes on one continuous surface and preserve the apparent
    // amount of liquid when an extreme angle reaches the vessel boundary.
    if (halfRange > .001 && airPercent < halfRange) {
      center = 2 * Math.sqrt(airPercent * halfRange) - halfRange;
    } else if (halfRange > .001 && liquidPercent < halfRange) {
      center = 100 - 2 * Math.sqrt(liquidPercent * halfRange) + halfRange;
    }

    const left = clamp(center - slope / 2, 0, 100);
    const middle = clamp(center, 0, 100);
    const right = clamp(center + slope / 2, 0, 100);
    moduleElement.style.setProperty("--recovery-surface-left", `${left.toFixed(2)}%`);
    moduleElement.style.setProperty("--recovery-surface-center", `${middle.toFixed(2)}%`);
    moduleElement.style.setProperty("--recovery-surface-right", `${right.toFixed(2)}%`);
  }

  function applyMotionVariables() {
    if (!moduleElement) return;
    moduleElement.style.setProperty("--recovery-liquid-tilt", `${motionCurrent.tilt.toFixed(2)}deg`);
    moduleElement.style.setProperty("--recovery-liquid-tilt-left", `${(motionCurrent.tilt - motionCurrent.surge * .12).toFixed(2)}deg`);
    moduleElement.style.setProperty("--recovery-liquid-tilt-right", `${(motionCurrent.tilt + motionCurrent.surge * .1).toFixed(2)}deg`);
    moduleElement.style.setProperty("--recovery-motion-x", `${motionCurrent.x.toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-motion-y", `${motionCurrent.y.toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-liquid-x", `${(motionCurrent.x * .34).toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-liquid-y", `${(motionCurrent.y * .12 - motionCurrent.surge * 1.8).toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-glow-x", `${(motionCurrent.x * .72).toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-glow-y", `${(motionCurrent.y * .58).toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-highlight-x", `${(-motionCurrent.x * .92).toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-highlight-y", `${(-motionCurrent.y * .74).toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-edge-x", `${(-motionCurrent.x * .42).toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-edge-y", `${(-motionCurrent.y * .28).toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-caustic-x", `${(-motionCurrent.x * .42).toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-caustic-y", `${(-motionCurrent.y * .38).toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-particle-drift-far", `${(-motionCurrent.particleX * .22).toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-particle-drift-mid", `${(-motionCurrent.particleX * .38).toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-particle-drift-near", `${(-motionCurrent.particleX * .56).toFixed(2)}px`);
    moduleElement.style.setProperty("--recovery-motion-energy", motionCurrent.surge.toFixed(3));
    moduleElement.style.setProperty("--recovery-caustic-opacity", (.62 + motionCurrent.surge * .18).toFixed(3));
    applyLiquidSurface();
  }

  function resetMotionVariables(immediate = false) {
    motionTarget.tilt = 0;
    motionTarget.x = 0;
    motionTarget.y = 0;
    motionTarget.surge = 0;
    if (immediate) {
      Object.keys(motionCurrent).forEach((key) => {
        motionCurrent[key] = 0;
        motionVelocity[key] = 0;
      });
      applyMotionVariables();
    }
  }

  function motionTick(now) {
    if (!motionEnabled) {
      motionFrame = 0;
      return;
    }
    if (document.hidden || !motionInViewport) {
      motionFrame = 0;
      return;
    }

    const stableFrame = currentProgress != null && currentProgress >= 91;
    const frameInterval = 1000 / (stableFrame ? 18 : 30);
    if (!motionLastFrame || now - motionLastFrame >= frameInterval) {
      const deltaSeconds = motionLastFrame
        ? clamp((now - motionLastFrame) / 1000, .016, .085)
        : 1 / 30;
      motionLastFrame = now;
      springStep("tilt", motionTarget.tilt, deltaSeconds, stableFrame ? 48 : 74, stableFrame ? 12 : 9.5);
      springStep("x", motionTarget.x, deltaSeconds, stableFrame ? 42 : 66, 10.5);
      springStep("y", motionTarget.y, deltaSeconds, 54, 11);
      springStep("surge", motionTarget.surge, deltaSeconds, 46, 10);
      springStep("particleX", motionTarget.x, deltaSeconds, 30, 8.5);
      motionTarget.surge *= Math.exp(-3.8 * deltaSeconds);
      applyMotionVariables();
    }
    motionFrame = requestAnimationFrame(motionTick);
  }

  function resumeMotionFrame() {
    if (!motionEnabled || motionFrame || document.hidden || !motionInViewport) return;
    motionLastFrame = 0;
    motionFrame = requestAnimationFrame(motionTick);
  }

  function handleDeviceOrientation(event) {
    if (!motionEnabled || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    const reading = normalizedOrientation(event.beta, event.gamma);
    if (!motionBaseline || motionCalibrating) {
      motionCalibrationSamples.push(reading);
      if (motionCalibrationSamples.length < MOTION_CALIBRATION_COUNT) {
        updateMotionControl();
        return;
      }
      motionBaseline = {
        side: median(motionCalibrationSamples.map((sample) => sample.side)),
        front: median(motionCalibrationSamples.map((sample) => sample.front)),
      };
      motionCalibrationSamples = [];
      motionCalibrating = false;
      motionLastReading = reading;
      moduleElement?.classList.remove("is-calibrating");
      updateMotionControl();
      return;
    }

    const deltaSide = deadZone(clamp(reading.side - motionBaseline.side, -34, 34), 1.15);
    const deltaFront = deadZone(clamp(reading.front - motionBaseline.front, -30, 30), 1.35);
    const progress = currentProgress == null ? 50 : currentProgress;
    const mobility = clamp(1.16 - progress * .0065, .5, 1.12);
    const sideVelocity = motionLastReading
      ? Math.abs(reading.side - motionLastReading.side)
      : 0;
    motionLastReading = reading;

    // The liquid surface counter-rotates against the phone while its mass still
    // shifts towards the physically lower side of the glass container.
    motionTarget.tilt = clamp(
      -deltaSide * MOTION_TILT_GAIN,
      -MOTION_TILT_LIMIT,
      MOTION_TILT_LIMIT
    );
    motionTarget.x = clamp(deltaSide * .29 * mobility, -9 * mobility, 9 * mobility);
    motionTarget.y = clamp(deltaFront * .15 * mobility, -4.5 * mobility, 4.5 * mobility);
    motionTarget.surge = Math.max(motionTarget.surge, clamp(sideVelocity / 9, 0, 1));
    resumeMotionFrame();
  }

  function updateMotionControl() {
    const button = moduleElement?.querySelector(".recovery-motion-toggle");
    const status = moduleElement?.querySelector(".recovery-motion-status");
    const calibrateButton = moduleElement?.querySelector(".recovery-calibrate-button");
    if (!button || !status) return;

    const unsupported = !motionSupported();
    const disabledBySystem = reducedMotion.matches;
    button.setAttribute("aria-checked", String(motionEnabled));
    button.classList.toggle("is-on", motionEnabled);
    button.disabled = motionPermissionPending || unsupported || disabledBySystem;
    if (calibrateButton) calibrateButton.disabled = !motionEnabled || motionCalibrating;

    if (disabledBySystem) status.textContent = "系统已开启减少动态效果";
    else if (unsupported) status.textContent = "此设备暂不支持倾斜联动";
    else if (motionPermissionPending) status.textContent = "正在请求动作权限";
    else if (motionCalibrating) status.textContent = `校准中 · 保持手机不动 ${motionCalibrationSamples.length}/${MOTION_CALIBRATION_COUNT}`;
    else if (motionEnabled) status.textContent = "已开启 · 液面将保持反向水平";
    else if (motionPreferred && motionNeedsPermission()) status.textContent = "轻点后重新启用倾斜联动";
    else status.textContent = "关闭 · 基础液体动画仍保留";
  }

  function showMotionHint() {
    const hint = moduleElement?.querySelector(".recovery-motion-hint");
    if (!hint) return;
    let hasSeenHint = false;
    try {
      hasSeenHint = localStorage.getItem(MOTION_HINT_KEY) === "seen";
      if (!hasSeenHint) localStorage.setItem(MOTION_HINT_KEY, "seen");
    } catch {
      // Showing the hint once per session is still useful if storage is unavailable.
    }
    if (hasSeenHint) return;

    window.clearTimeout(motionHintTimer);
    hint.classList.add("is-visible");
    motionHintTimer = window.setTimeout(() => hint.classList.remove("is-visible"), 4200);
  }

  function startMotion() {
    if (motionEnabled || reducedMotion.matches || !motionSupported()) return;
    motionEnabled = true;
    writeMotionPreference(true);
    resetMotionVariables(true);
    attachMotionListener();
    moduleElement?.classList.add("has-motion");
    beginMotionCalibration({ quiet: true });
    updateMotionControl();
    showMotionHint();
    resumeMotionFrame();
  }

  function stopMotion({ remember = true } = {}) {
    motionEnabled = false;
    if (remember) writeMotionPreference(false);
    detachMotionListener();
    if (motionFrame) cancelAnimationFrame(motionFrame);
    motionFrame = 0;
    motionLastFrame = 0;
    moduleElement?.classList.add("is-motion-settling");
    moduleElement?.classList.remove("has-motion", "is-calibrating");
    motionCalibrating = false;
    motionCalibrationSamples = [];
    motionBaseline = null;
    motionLastReading = null;
    resetMotionVariables(true);
    window.setTimeout(() => moduleElement?.classList.remove("is-motion-settling"), 220);
    updateMotionControl();
  }

  function recalibrateMotion() {
    if (!motionEnabled) return;
    beginMotionCalibration();
    navigator.vibrate?.(6);
  }

  async function toggleMotion() {
    if (motionEnabled) {
      stopMotion();
      showToast("倾斜联动已关闭，基础液体动画仍会保留");
      return;
    }
    if (reducedMotion.matches) {
      showToast("系统已开启减少动态效果");
      return;
    }
    if (!motionSupported()) {
      showToast("当前设备暂不支持倾斜联动");
      return;
    }

    motionPermissionPending = true;
    updateMotionControl();
    try {
      const permission = motionNeedsPermission()
        ? await window.DeviceOrientationEvent.requestPermission()
        : "granted";
      if (permission !== "granted") {
        writeMotionPreference(false);
        showToast("未获得动作权限，已继续使用基础液体动画");
        return;
      }
      startMotion();
      navigator.vibrate?.(8);
      showToast("倾斜联动已开启");
    } catch {
      writeMotionPreference(false);
      showToast("动作权限未开启，已继续使用基础液体动画");
    } finally {
      motionPermissionPending = false;
      updateMotionControl();
    }
  }

  function triggerCheckinFeedback(kind) {
    if (!moduleElement || reducedMotion.matches) return;
    window.clearTimeout(feedbackTimer);
    moduleElement.classList.remove("is-releasing", "is-affirming");
    void moduleElement.offsetWidth;
    moduleElement.classList.add(kind === "yes" ? "is-releasing" : "is-affirming");
    feedbackTimer = window.setTimeout(() => {
      moduleElement?.classList.remove("is-releasing", "is-affirming");
    }, kind === "yes" ? 1500 : 900);
  }

  function saveManualTime() {
    const input = editorElement?.querySelector("input");
    const note = editorElement?.querySelector(".recovery-editor-note");
    const timestamp = input ? new Date(input.value).getTime() : NaN;

    if (!Number.isFinite(timestamp)) {
      if (note) note.textContent = "请选择一个有效时间。";
      return;
    }
    if (timestamp > Date.now()) {
      if (note) note.textContent = "记录时间不能晚于现在。";
      return;
    }

    saveReleaseState({
      timestamp,
      source: "manual",
      dateKey: localDateKey(timestamp),
    });
    closeEditor();
    toggleDetails(true);
    navigator.vibrate?.(18);
    showToast("释放时间已更新，恢复趋势已重新计算");
  }

  function useLatestCheckin() {
    const latest = latestReleaseFromCheckins();
    const note = editorElement?.querySelector(".recovery-editor-note");
    if (!latest) {
      if (note) note.textContent = "打卡记录中还没有“冲了”的日期。";
      return;
    }

    saveReleaseState(latest);
    closeEditor();
    toggleDetails(true);
    navigator.vibrate?.(12);
    showToast("已改用最近一次“冲了”的打卡时间");
  }

  function createModule() {
    const section = document.createElement("section");
    section.id = MODULE_ID;
    section.className = "recovery-module";
    section.classList.toggle("is-low-performance", lowPerformanceDevice);
    section.setAttribute("aria-label", "蛋蛋恢复仓");
    section.innerHTML = `
      <div class="recovery-summary" role="button" tabindex="0" aria-expanded="false" aria-controls="recovery-details">
        <div class="recovery-header">
          <div class="recovery-heading">
            <span class="recovery-kicker">恢复趋势</span>
            <h2>蛋蛋恢复仓</h2>
            <p>把看不见的恢复，变成看得见的进度</p>
          </div>
          <span class="recovery-compact-percent"><small>恢复趋势</small><strong><span class="recovery-percent-number">--</span><em>%</em></strong></span>
          <span class="recovery-expand-label">展开</span>
        </div>

        <div class="recovery-visual">
          <div class="recovery-vessel-stage" aria-hidden="true">
            <div class="recovery-liquid-mask">
              <div class="recovery-liquid-chamber recovery-liquid-chamber-left">
                <div class="recovery-liquid-fill">
                  <span class="recovery-liquid-caustics"></span>
                </div>
              </div>
              <div class="recovery-liquid-chamber recovery-liquid-chamber-right">
                <div class="recovery-liquid-fill">
                  <span class="recovery-liquid-caustics"></span>
                </div>
              </div>
              <span class="recovery-edge-refraction"></span>
            </div>
            <div class="recovery-glass-glint"></div>
            <img class="recovery-vessel-shell" src="./assets/recovery-vessel.png" alt="">
            <div class="recovery-percent">
              <span class="recovery-percent-value"><span class="recovery-percent-number">--</span><small>%</small></span>
              <span class="recovery-percent-label">恢复趋势</span>
            </div>
          </div>
          <span class="recovery-status-pill">读取记录中</span>
          <span class="recovery-motion-hint" aria-live="polite">先保持不动，再倾斜手机</span>
        </div>

        <div class="recovery-summary-copy">
          <p class="recovery-summary-line">正在计算恢复趋势。</p>
          <span class="recovery-next-compact">轻点查看详细数据</span>
        </div>
      </div>

      <div class="recovery-details" id="recovery-details">
        <div class="recovery-details-inner">
          <div class="recovery-details-content">
            <div class="recovery-timeline" aria-label="恢复时间轴">
              ${stages.map((stage) => `
                <div class="recovery-stage">
                  <i aria-hidden="true"></i>
                  <span>${stage.label}</span>
                </div>
              `).join("")}
            </div>

            <dl class="recovery-data recovery-data-grid">
              <div class="recovery-data-row">
                <dt>上次记录</dt>
                <dd data-recovery="recorded">尚未记录</dd>
              </div>
              <div class="recovery-data-row">
                <dt>下一阶段</dt>
                <dd data-recovery="next-stage">等待开始</dd>
              </div>
              <div class="recovery-data-row">
                <dt>预计进入</dt>
                <dd data-recovery="next-time">记录后开始估算</dd>
              </div>
            </dl>

            <button class="recovery-motion-setting recovery-motion-toggle" type="button" role="switch" aria-checked="false" aria-label="开启倾斜联动">
              <div>
                <strong>动态效果</strong>
                <span class="recovery-motion-status">检查设备支持情况</span>
              </div>
              <span class="recovery-motion-switch" aria-hidden="true">
                <i aria-hidden="true"></i>
              </span>
            </button>

            <button class="recovery-calibrate-button" type="button" disabled>重新校准当前姿势</button>

            <button class="recovery-edit-button" type="button">重新记录释放时间</button>
            <p class="recovery-encouragement">保持觉察，比追求完美更重要。</p>
            <details class="recovery-disclaimer">
              <summary>趋势估算说明</summary>
              <p>本模块依据距离上次释放的时间进行趋势估算，仅用于可视化参考，不代表真实精液量、精子数量、身体检测结果或医学诊断。</p>
            </details>
          </div>
        </div>
      </div>
    `;
    return section;
  }

  function createEditor() {
    const editor = document.createElement("div");
    editor.id = EDITOR_ID;
    editor.className = "recovery-editor";
    editor.setAttribute("role", "dialog");
    editor.setAttribute("aria-modal", "true");
    editor.setAttribute("aria-hidden", "true");
    editor.setAttribute("aria-labelledby", "recovery-editor-title");
    editor.innerHTML = `
      <div class="recovery-editor-panel">
        <i class="recovery-editor-handle" aria-hidden="true"></i>
        <header>
          <div>
            <small>恢复趋势起点</small>
            <h3 id="recovery-editor-title">重新记录释放时间</h3>
          </div>
          <button class="recovery-editor-close" type="button">关闭</button>
        </header>
        <label>
          日期与时间
          <input type="datetime-local" step="60" aria-describedby="recovery-editor-note">
        </label>
        <p class="recovery-editor-note" id="recovery-editor-note" aria-live="polite"></p>
        <div class="recovery-editor-actions">
          <button class="recovery-editor-latest" type="button">使用最近打卡</button>
          <button class="recovery-editor-save" type="button">保存并重新计算</button>
        </div>
      </div>
    `;
    return editor;
  }

  function mount() {
    if (moduleElement) return;
    const anchor = document.querySelector(".month-summary");
    if (!anchor) return;

    moduleElement = createModule();
    editorElement = createEditor();
    anchor.insertAdjacentElement("afterend", moduleElement);
    document.body.append(editorElement);

    const toast = document.createElement("div");
    toast.className = "recovery-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.append(toast);

    const summary = moduleElement.querySelector(".recovery-summary");
    summary?.addEventListener("click", () => toggleDetails());
    summary?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleDetails();
      }
    });
    moduleElement.querySelector(".recovery-edit-button")?.addEventListener("click", openEditor);
    moduleElement.querySelector(".recovery-motion-toggle")?.addEventListener("click", toggleMotion);
    moduleElement.querySelector(".recovery-calibrate-button")?.addEventListener("click", recalibrateMotion);
    editorElement.querySelector(".recovery-editor-close")?.addEventListener("click", closeEditor);
    editorElement.querySelector(".recovery-editor-save")?.addEventListener("click", saveManualTime);
    editorElement.querySelector(".recovery-editor-latest")?.addEventListener("click", useLatestCheckin);
    editorElement.addEventListener("click", (event) => {
      if (event.target === editorElement) closeEditor();
    });

    if (typeof IntersectionObserver === "function") {
      stageObserver = new IntersectionObserver(([entry]) => {
        const wasInViewport = motionInViewport;
        motionInViewport = Boolean(entry?.isIntersecting);
        moduleElement?.classList.toggle("is-offscreen", !motionInViewport);
        if (motionInViewport) {
          attachMotionListener();
          if (!wasInViewport && motionEnabled) beginMotionCalibration({ quiet: true });
          resumeMotionFrame();
        } else {
          detachMotionListener();
          if (motionFrame) cancelAnimationFrame(motionFrame);
          motionFrame = 0;
        }
      }, { rootMargin: "120px 0px" });
      stageObserver.observe(moduleElement);
    }

    reducedMotion.addEventListener?.("change", () => {
      if (reducedMotion.matches) stopMotion({ remember: false });
      else if (motionPreferred && !motionNeedsPermission()) startMotion();
      updateMotionControl();
    });
    window.addEventListener("orientationchange", resetMotionBaseline, { passive: true });
    window.screen?.orientation?.addEventListener?.("change", resetMotionBaseline);

    syncWithCheckins(true);
    render();
    updateMotionControl();
    if (motionPreferred && !motionNeedsPermission()) startMotion();
  }

  function ensureMounted() {
    if (typeof document === "undefined" || !document?.querySelector) return;
    if (!moduleElement) {
      mount();
      return;
    }

    const anchor = document.querySelector(".month-summary");
    if (anchor && !moduleElement.isConnected) {
      anchor.insertAdjacentElement("afterend", moduleElement);
    }
  }

  document.addEventListener("click", (event) => {
    const action = event.target.closest(".answer, .history-actions button");
    if (action) {
      triggerCheckinFeedback(action.classList.contains("yes") ? "yes" : "no");
      window.setTimeout(() => syncWithCheckins(), 120);
      window.setTimeout(() => syncWithCheckins(), 420);
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && editorElement?.classList.contains("is-open")) {
      closeEditor();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      syncWithCheckins();
      render();
      attachMotionListener();
      if (motionEnabled) beginMotionCalibration({ quiet: true });
      resumeMotionFrame();
    } else {
      detachMotionListener();
      if (motionFrame) cancelAnimationFrame(motionFrame);
      motionFrame = 0;
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === RECORDS_KEY) syncWithCheckins(true);
    if (event.key === RECOVERY_KEY) {
      releaseState = readReleaseState();
      render();
    }
    if (event.key === MOTION_KEY && event.newValue === "off" && motionEnabled) {
      stopMotion({ remember: false });
    }
  });

  mountObserver = new MutationObserver(ensureMounted);
  mountObserver.observe(document.documentElement, { childList: true, subtree: true });
  ensureMounted();
  window.setInterval(() => {
    ensureMounted();
    syncWithCheckins();
    render();
  }, 60_000);
})();
