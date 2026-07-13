(() => {
  const MODULE_ID = "recovery-vault";
  const EDITOR_ID = "recovery-editor";
  const RECORDS_KEY = "did-you-v1";
  const RECOVERY_KEY = "chonglema-recovery-v1";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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
  let toastTimer = 0;
  let mountObserver;

  const localDateKey = (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const clamp = (value, minimum, maximum) =>
    Math.min(maximum, Math.max(minimum, value));

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
    const number = moduleElement?.querySelector(".recovery-percent-number");
    if (!number) return;

    if (to == null) {
      number.textContent = "--";
      currentProgress = null;
      return;
    }

    const target = Math.round(to);
    if (reducedMotion.matches) {
      number.textContent = String(target);
      currentProgress = target;
      return;
    }

    const from = currentProgress == null ? 0 : currentProgress;
    if (currentProgress == null) {
      number.textContent = "0";
      currentProgress = 0;
    }
    if (from === target) return;
    const started = performance.now();
    const duration = 480;

    const tick = (now) => {
      const ratio = clamp((now - started) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - ratio, 3);
      number.textContent = String(Math.round(from + (target - from) * eased));
      if (ratio < 1) requestAnimationFrame(tick);
      else currentProgress = target;
    };

    requestAnimationFrame(tick);
  }

  function renderParticles(progress) {
    const fill = moduleElement?.querySelector(".recovery-liquid-fill");
    if (!fill) return;

    const count = progress == null || progress < 6
      ? 0
      : clamp(Math.round(progress / 14), 1, particlePositions.length);
    const speed = clamp(10.2 - (progress || 0) * .038, 6.3, 10.2);

    fill.querySelectorAll(".recovery-particle").forEach((particle) => particle.remove());
    particlePositions.slice(0, count).forEach(([left, bottom, delay], index) => {
      const particle = document.createElement("img");
      particle.className = "recovery-particle";
      particle.src = "./assets/recovery-particle.png";
      particle.alt = "";
      particle.setAttribute("aria-hidden", "true");
      particle.style.left = `${left}%`;
      particle.style.bottom = `${Math.min(bottom, 86)}%`;
      particle.style.setProperty("--particle-speed", `${speed + index * .34}s`);
      particle.style.setProperty("--particle-delay", `${delay}s`);
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
      moduleElement.classList.add("is-empty");
      moduleElement.style.setProperty("--recovery-level", "0%");
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

    requestAnimationFrame(() => {
      moduleElement.style.setProperty("--recovery-level", `${progress.toFixed(2)}%`);
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
    section.setAttribute("aria-label", "蛋蛋恢复仓");
    section.innerHTML = `
      <button class="recovery-summary" type="button" aria-expanded="false" aria-controls="recovery-details">
        <span class="recovery-header">
          <span class="recovery-heading">
            <span class="recovery-kicker">恢复趋势</span>
            <h2>蛋蛋恢复仓</h2>
            <p>把看不见的恢复，变成看得见的进度</p>
          </span>
          <span class="recovery-expand-label">展开</span>
        </span>

        <span class="recovery-visual">
          <span class="recovery-vessel-stage" aria-hidden="true">
            <span class="recovery-liquid-mask">
              <span class="recovery-liquid-fill"></span>
            </span>
            <img class="recovery-vessel-shell" src="./assets/recovery-vessel.png" alt="">
            <span class="recovery-percent">
              <span class="recovery-percent-value"><span class="recovery-percent-number">--</span><small>%</small></span>
              <span class="recovery-percent-label">恢复进度</span>
            </span>
          </span>
          <span class="recovery-status-pill">读取记录中</span>
        </span>

        <span class="recovery-summary-copy">
          <p class="recovery-summary-line">正在计算恢复趋势。</p>
          <span class="recovery-next-compact">轻点查看详细数据</span>
        </span>
      </button>

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

            <dl class="recovery-data">
              <div class="recovery-data-row">
                <dt>上次记录时间</dt>
                <dd data-recovery="recorded">尚未记录</dd>
              </div>
              <div class="recovery-data-row">
                <dt>下一个恢复阶段</dt>
                <dd data-recovery="next-stage">等待开始</dd>
              </div>
              <div class="recovery-data-row">
                <dt>预计进入时间</dt>
                <dd data-recovery="next-time">记录后开始估算</dd>
              </div>
            </dl>

            <button class="recovery-edit-button" type="button">重新记录释放时间</button>
            <p class="recovery-encouragement">保持觉察，比追求完美更重要。</p>
            <p class="recovery-disclaimer">本模块依据距离上次释放的时间进行趋势估算，仅用于可视化参考，不代表真实精液量、精子数量、身体检测结果或医学诊断。</p>
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

    moduleElement.querySelector(".recovery-summary")?.addEventListener("click", () => toggleDetails());
    moduleElement.querySelector(".recovery-edit-button")?.addEventListener("click", openEditor);
    editorElement.querySelector(".recovery-editor-close")?.addEventListener("click", closeEditor);
    editorElement.querySelector(".recovery-editor-save")?.addEventListener("click", saveManualTime);
    editorElement.querySelector(".recovery-editor-latest")?.addEventListener("click", useLatestCheckin);
    editorElement.addEventListener("click", (event) => {
      if (event.target === editorElement) closeEditor();
    });

    syncWithCheckins(true);
    render();
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
    if (event.target.closest(".answer, .history-actions")) {
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
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === RECORDS_KEY) syncWithCheckins(true);
    if (event.key === RECOVERY_KEY) {
      releaseState = readReleaseState();
      render();
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
