(() => {
  const STORAGE_KEY = "chonglema-push-reminder-v1";
  const API_BASE = String(window.CHONGLEMA_LEADERBOARD_API || "").trim().replace(/\/+$/, "");
  const DEFAULT_TIME = "21:30";

  function timezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }

  const state = {
    entry: null,
    overlay: null,
    registration: null,
    subscription: null,
    installPrompt: null,
    busy: false,
    message: "",
    tone: "",
    open: false,
    local: readLocalState(),
    opener: null,
    previousOverflow: "",
  };

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  function readLocalState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return {
        enabled: stored?.enabled === true,
        reminderTime: /^\d{2}:\d{2}$/.test(stored?.reminderTime) ? stored.reminderTime : DEFAULT_TIME,
        timezone: typeof stored?.timezone === "string" ? stored.timezone : timezone(),
      };
    } catch {
      return { enabled: false, reminderTime: DEFAULT_TIME, timezone: timezone() };
    }
  }

  function writeLocalState(next) {
    state.local = { ...state.local, ...next, timezone: timezone() };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state.local, updatedAt: new Date().toISOString() }));
    } catch {
      // The current session still works when local storage is blocked.
    }
  }

  async function requestJson(path, options = {}) {
    if (!API_BASE) throw new Error("提醒服务尚未连接");
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "提醒服务暂时不可用");
    return payload;
  }

  function applicationServerKey(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
  }

  async function ensureRegistration() {
    if (!pushSupported()) throw new Error("当前浏览器不支持网页推送");
    if (!state.registration) {
      state.registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    }
    await navigator.serviceWorker.ready;
    return state.registration;
  }

  async function refreshSubscription() {
    if (!pushSupported()) return null;
    try {
      const registration = await ensureRegistration();
      state.subscription = await registration.pushManager.getSubscription();
      if (!state.subscription && state.local.enabled) writeLocalState({ enabled: false });
      return state.subscription;
    } catch {
      state.subscription = null;
      return null;
    }
  }

  function createEntry() {
    const button = document.createElement("button");
    button.className = "pwa-reminder-entry";
    button.type = "button";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", "pwa-reminder-dialog");
    button.innerHTML = `
      <span class="pwa-reminder-status-dot" aria-hidden="true"></span>
      <span class="pwa-reminder-copy">
        <small>每日提醒</small>
        <strong data-pwa-entry-title>固定时间，轻轻提醒</strong>
        <em data-pwa-entry-status>点击设置提醒</em>
      </span>
      <span class="pwa-reminder-time" data-pwa-entry-time>未开启</span>
      <span class="pwa-reminder-cta">设置</span>`;
    button.addEventListener("click", () => openDialog(button));
    return button;
  }

  function createDialog() {
    const overlay = document.createElement("div");
    overlay.id = "pwa-reminder-dialog";
    overlay.className = "pwa-reminder-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <section class="pwa-reminder-panel" role="dialog" aria-modal="true" aria-labelledby="pwa-reminder-title">
        <i class="pwa-reminder-handle" aria-hidden="true"></i>
        <header class="pwa-reminder-header">
          <div><small>PWA · WEB PUSH</small><h2 id="pwa-reminder-title">安装与每日提醒</h2></div>
          <button class="pwa-reminder-close" type="button" aria-label="关闭提醒设置">关闭</button>
        </header>
        <div class="pwa-reminder-body">
          <section class="pwa-install-card" data-pwa-install-card>
            <div><small>安装到手机</small><strong data-pwa-install-title>获得更稳定的提醒</strong><p data-pwa-install-copy></p></div>
            <button type="button" data-pwa-install-button hidden>安装应用</button>
          </section>
          <section class="pwa-schedule-card">
            <div class="pwa-schedule-heading"><div><small>提醒时间</small><strong>每天固定一次</strong></div><span data-pwa-permission>尚未授权</span></div>
            <label class="pwa-time-field" for="pwa-reminder-time"><span>每天</span><input id="pwa-reminder-time" type="time" step="300"></label>
            <p class="pwa-reminder-message" data-pwa-message aria-live="polite"></p>
            <div class="pwa-reminder-actions">
              <button class="pwa-reminder-primary" type="button" data-pwa-enable>开启每日提醒</button>
              <button class="pwa-reminder-secondary" type="button" data-pwa-test hidden>发送测试通知</button>
              <button class="pwa-reminder-disable" type="button" data-pwa-disable hidden>关闭提醒</button>
            </div>
          </section>
          <section class="pwa-privacy-note"><strong>隐私保持不变</strong><p>只同步匿名推送地址、提醒时间和时区；不会上传打卡日历，也不会判断您今天是否已经记录。</p></section>
          <p class="pwa-offline-note">安装后可离线打开并查看本机已有记录；排行榜和提醒设置需要联网。</p>
        </div>
      </section>`;

    overlay.querySelector(".pwa-reminder-close")?.addEventListener("click", closeDialog);
    overlay.querySelector("[data-pwa-enable]")?.addEventListener("click", enableReminder);
    overlay.querySelector("[data-pwa-test]")?.addEventListener("click", sendTestNotification);
    overlay.querySelector("[data-pwa-disable]")?.addEventListener("click", disableReminder);
    overlay.querySelector("[data-pwa-install-button]")?.addEventListener("click", installApp);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeDialog();
    });
    return overlay;
  }

  function setMessage(message, tone = "") {
    state.message = message;
    state.tone = tone;
    render();
  }

  function renderInstall() {
    const card = state.overlay?.querySelector("[data-pwa-install-card]");
    const title = state.overlay?.querySelector("[data-pwa-install-title]");
    const copy = state.overlay?.querySelector("[data-pwa-install-copy]");
    const button = state.overlay?.querySelector("[data-pwa-install-button]");
    if (!card || !title || !copy || !button) return;

    if (isStandalone()) {
      card.dataset.state = "installed";
      title.textContent = "已作为应用打开";
      copy.textContent = "现在可以在桌面直接进入，推送也会更稳定。";
      button.hidden = true;
    } else if (state.installPrompt) {
      card.dataset.state = "available";
      title.textContent = "安装后使用更顺手";
      copy.textContent = "无需应用商店，不会清除现有记录。";
      button.hidden = false;
      button.textContent = "安装应用";
    } else if (isIos) {
      card.dataset.state = "manual";
      title.textContent = "先添加到主屏幕";
      copy.textContent = "在 Safari 点分享，再选“添加到主屏幕”；从桌面打开后即可开启推送。";
      button.hidden = true;
    } else {
      card.dataset.state = "manual";
      title.textContent = "可安装为独立应用";
      copy.textContent = "若未出现安装按钮，请在浏览器菜单中选择“安装应用”或“添加到主屏幕”。";
      button.hidden = true;
    }
  }

  function render() {
    const enabled = Boolean(state.local.enabled && state.subscription);
    if (state.entry) {
      state.entry.classList.toggle("is-enabled", enabled);
      const title = state.entry.querySelector("[data-pwa-entry-title]");
      const status = state.entry.querySelector("[data-pwa-entry-status]");
      const time = state.entry.querySelector("[data-pwa-entry-time]");
      if (title) title.textContent = enabled ? "每日提醒已开启" : "固定时间，轻轻提醒";
      if (status) status.textContent = enabled ? `按 ${state.local.timezone || timezone()} 时区发送` : "点击设置提醒";
      if (time) time.textContent = enabled ? state.local.reminderTime : "未开启";
    }
    if (!state.overlay) return;
    renderInstall();
    const input = state.overlay.querySelector("#pwa-reminder-time");
    if (input && document.activeElement !== input) input.value = state.local.reminderTime;
    const permission = state.overlay.querySelector("[data-pwa-permission]");
    if (permission) {
      const value = pushSupported() ? Notification.permission : "unsupported";
      permission.textContent = value === "granted" ? "通知已授权" : value === "denied" ? "通知已拒绝" : value === "unsupported" ? "浏览器不支持" : "尚未授权";
      permission.dataset.state = value;
    }
    const message = state.overlay.querySelector("[data-pwa-message]");
    if (message) {
      message.textContent = state.message;
      message.dataset.tone = state.tone;
    }
    const enable = state.overlay.querySelector("[data-pwa-enable]");
    const test = state.overlay.querySelector("[data-pwa-test]");
    const disable = state.overlay.querySelector("[data-pwa-disable]");
    const blockedOnIos = isIos && !isStandalone();
    if (enable) {
      enable.disabled = state.busy || !pushSupported() || blockedOnIos;
      enable.textContent = state.busy ? "正在处理…" : enabled ? "保存提醒时间" : "开启每日提醒";
    }
    if (test) {
      test.hidden = !enabled;
      test.disabled = state.busy;
    }
    if (disable) {
      disable.hidden = !enabled;
      disable.disabled = state.busy;
    }
    if (!state.message && blockedOnIos) {
      const hint = state.overlay.querySelector("[data-pwa-message]");
      if (hint) hint.textContent = "iPhone 需要先添加到主屏幕，再从桌面打开此应用。";
    }
  }

  async function enableReminder() {
    if (state.busy) return;
    if (isIos && !isStandalone()) {
      setMessage("请先按上方步骤添加到主屏幕。", "warning");
      return;
    }
    const input = state.overlay.querySelector("#pwa-reminder-time");
    const reminderTime = input?.value || DEFAULT_TIME;
    state.busy = true;
    setMessage("", "");
    try {
      const registration = await ensureRegistration();
      const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
      if (permission !== "granted") throw new Error("通知权限未开启，请在系统设置中允许通知");
      const config = await requestJson("/v1/push/config", { method: "GET", cache: "no-store" });
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(config.publicKey),
        });
      }
      await requestJson("/v1/push/subscription", {
        method: "POST",
        body: JSON.stringify({ subscription: subscription.toJSON(), reminderTime, timezone: timezone() }),
      });
      state.subscription = subscription;
      writeLocalState({ enabled: true, reminderTime });
      setMessage("已保存。定时任务每 5 分钟检查一次，提醒可能有几分钟浮动。", "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提醒开启失败，请稍后再试", "error");
    } finally {
      state.busy = false;
      render();
    }
  }

  async function sendTestNotification() {
    if (state.busy || !state.subscription) return;
    state.busy = true;
    setMessage("正在发送测试通知…", "");
    try {
      await requestJson("/v1/push/test", {
        method: "POST",
        body: JSON.stringify({ subscription: state.subscription.toJSON() }),
      });
      setMessage("测试通知已发出；若暂未出现，请检查系统通知设置。", "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "测试通知发送失败", "error");
    } finally {
      state.busy = false;
      render();
    }
  }

  async function disableReminder() {
    if (state.busy || !state.subscription) return;
    state.busy = true;
    setMessage("", "");
    const endpoint = state.subscription.endpoint;
    try {
      await requestJson("/v1/push/subscription", {
        method: "DELETE",
        body: JSON.stringify({ endpoint }),
      });
      await state.subscription.unsubscribe();
      state.subscription = null;
      writeLocalState({ enabled: false });
      setMessage("每日提醒已关闭。", "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "关闭失败，请稍后再试", "error");
    } finally {
      state.busy = false;
      render();
    }
  }

  async function installApp() {
    if (!state.installPrompt) return;
    const prompt = state.installPrompt;
    state.installPrompt = null;
    await prompt.prompt();
    await prompt.userChoice.catch(() => null);
    render();
  }

  async function openDialog(opener) {
    state.opener = opener;
    state.open = true;
    state.overlay.hidden = false;
    state.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    await refreshSubscription();
    render();
    requestAnimationFrame(() => {
      state.overlay.classList.add("is-open");
      state.overlay.querySelector(".pwa-reminder-close")?.focus();
    });
  }

  function closeDialog() {
    if (!state.open) return;
    state.open = false;
    state.overlay.classList.remove("is-open");
    document.body.style.overflow = state.previousOverflow;
    window.setTimeout(() => {
      state.overlay.hidden = true;
      state.opener?.focus();
    }, 220);
  }

  function ensureMounted() {
    const leaderboard = document.querySelector(".leaderboard-inline-entry");
    const stats = document.querySelector(".stats");
    let changed = false;
    if (!state.entry) {
      state.entry = createEntry();
      changed = true;
    }
    if (!state.overlay) {
      state.overlay = createDialog();
      document.body.append(state.overlay);
      changed = true;
    }
    if (leaderboard && (!state.entry.isConnected || state.entry.nextElementSibling !== leaderboard)) {
      leaderboard.before(state.entry);
      changed = true;
    } else if (!leaderboard && stats && !state.entry.isConnected) {
      stats.before(state.entry);
      changed = true;
    }
    if (changed) render();
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    render();
  });
  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    setMessage("已安装到设备。", "success");
  });
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      state.local = readLocalState();
      refreshSubscription().then(render);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open) closeDialog();
  });

  const observer = new MutationObserver(ensureMounted);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  ensureMounted();
  refreshSubscription().then(render);
})();
