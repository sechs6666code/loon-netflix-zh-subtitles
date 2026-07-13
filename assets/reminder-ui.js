(() => {
  const STORAGE_KEY = "did-you-email-reminder-v1";
  const GUIDE_URL = "https://github.com/sechs6666code/chonglema/blob/main/reminder-backend/README.md";

  const readSettings = () => {
    try {
      return {
        email: "",
        time: "21:30",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
        endpoint: "",
        enabled: true,
        ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"),
      };
    } catch {
      return {
        email: "",
        time: "21:30",
        timezone: "Asia/Shanghai",
        endpoint: "",
        enabled: true,
      };
    }
  };

  const saveSettings = (settings) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  };

  const addMenuEntry = (menu) => {
    if (menu.querySelector("[data-reminder-menu]")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.reminderMenu = "true";
    button.className = "reminder-menu-button";
    button.textContent = "邮件提醒";

    if (readSettings().enabled && readSettings().endpoint) {
      const badge = document.createElement("span");
      badge.textContent = "已开";
      button.appendChild(badge);
    }

    button.addEventListener("click", () => {
      openReminderSheet();
      requestAnimationFrame(() => document.querySelector(".more")?.click());
    });

    menu.insertBefore(button, menu.firstChild);
  };

  const postToBackend = async (endpoint, payload) => {
    await fetch(endpoint, {
      method: "POST",
      mode: "no-cors",
      cache: "no-store",
      body: JSON.stringify(payload),
    });
  };

  const openReminderSheet = () => {
    document.querySelector(".reminder-sheet")?.remove();
    const settings = readSettings();
    const sheet = document.createElement("div");
    sheet.className = "reminder-sheet";
    sheet.innerHTML = `
      <section class="reminder-panel" role="dialog" aria-modal="true" aria-labelledby="reminder-title">
        <header class="reminder-header">
          <div>
            <span>每日一次</span>
            <h2 id="reminder-title">邮件提醒</h2>
          </div>
          <button type="button" class="reminder-close">关闭</button>
        </header>

        <p class="reminder-intro">到了设定时间，即使网站已经关闭，也会收到一封克制的打卡提醒。</p>

        <form class="reminder-form">
          <label class="reminder-field">
            <span>收件邮箱</span>
            <input name="email" type="email" autocomplete="email" inputmode="email" required placeholder="name@example.com">
          </label>

          <div class="reminder-row">
            <label class="reminder-field">
              <span>提醒时间</span>
              <input name="time" type="time" required>
            </label>
            <label class="reminder-field">
              <span>所在时区</span>
              <input name="timezone" type="text" readonly>
            </label>
          </div>

          <label class="reminder-toggle">
            <span>
              <b>启用每日提醒</b>
              <small>关闭后保留设置，但不再发信</small>
            </span>
            <input name="enabled" type="checkbox">
            <i aria-hidden="true"></i>
          </label>

          <details class="reminder-backend" ${settings.endpoint ? "" : "open"}>
            <summary>首次连接邮件服务</summary>
            <p>先按照设置指南部署一次免费的邮件后台，然后把地址与安全 PIN 填在这里。</p>
            <label class="reminder-field">
              <span>Apps Script 后台地址</span>
              <input name="endpoint" type="url" inputmode="url" required placeholder="https://script.google.com/macros/s/.../exec">
            </label>
            <label class="reminder-field">
              <span>安全 PIN</span>
              <input name="pin" type="password" minlength="10" autocomplete="off" required placeholder="部署后台时设置的 PIN">
            </label>
            <a href="${GUIDE_URL}" target="_blank" rel="noreferrer">打开一次性设置指南</a>
          </details>

          <p class="reminder-status" role="status" aria-live="polite"></p>

          <div class="reminder-actions">
            <button type="button" class="reminder-test">发送测试邮件</button>
            <button type="submit" class="reminder-save">保存提醒</button>
          </div>
        </form>
      </section>
    `;

    const form = sheet.querySelector(".reminder-form");
    const email = form.elements.email;
    const time = form.elements.time;
    const timezone = form.elements.timezone;
    const endpoint = form.elements.endpoint;
    const pin = form.elements.pin;
    const enabled = form.elements.enabled;
    const status = sheet.querySelector(".reminder-status");
    const saveButton = sheet.querySelector(".reminder-save");
    const testButton = sheet.querySelector(".reminder-test");

    email.value = settings.email;
    time.value = settings.time;
    timezone.value = settings.timezone;
    endpoint.value = settings.endpoint;
    enabled.checked = settings.enabled;

    const close = () => {
      sheet.classList.remove("show");
      document.body.classList.remove("reminder-open");
      window.setTimeout(() => sheet.remove(), 220);
    };

    const setBusy = (busy) => {
      saveButton.disabled = busy;
      testButton.disabled = busy;
      saveButton.textContent = busy ? "正在连接…" : "保存提醒";
    };

    const collect = () => ({
      email: email.value.trim(),
      time: time.value,
      timezone: timezone.value.trim(),
      endpoint: endpoint.value.trim(),
      enabled: enabled.checked,
    });

    const validate = () => {
      if (!form.reportValidity()) return false;
      if (!endpoint.value.startsWith("https://script.google.com/")) {
        status.textContent = "请填写 Apps Script 部署后的网页应用地址。";
        status.dataset.kind = "error";
        return false;
      }
      if (pin.value.length < 10) {
        status.textContent = "安全 PIN 至少需要 10 位。";
        status.dataset.kind = "error";
        return false;
      }
      return true;
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!validate()) return;
      const next = collect();
      setBusy(true);
      status.textContent = "正在提交设置…";
      status.dataset.kind = "";
      try {
        await postToBackend(next.endpoint, {
          action: "configure",
          pin: pin.value,
          email: next.email,
          time: next.time,
          timezone: next.timezone,
          enabled: next.enabled,
        });
        saveSettings(next);
        status.textContent = next.enabled
          ? "设置已提交，请查看确认邮件。"
          : "关闭请求已提交，请查看确认邮件。";
        status.dataset.kind = "success";
      } catch {
        status.textContent = "暂时无法连接邮件后台，请检查地址或网络。";
        status.dataset.kind = "error";
      } finally {
        setBusy(false);
      }
    });

    testButton.addEventListener("click", async () => {
      if (!validate()) return;
      setBusy(true);
      status.textContent = "正在发送测试邮件…";
      status.dataset.kind = "";
      try {
        await postToBackend(endpoint.value.trim(), {
          action: "test",
          pin: pin.value,
          email: email.value.trim(),
          time: time.value,
          timezone: timezone.value.trim(),
        });
        status.textContent = "发送请求已提交，请在一分钟内查看邮箱。";
        status.dataset.kind = "success";
      } catch {
        status.textContent = "发送失败，请检查后台地址与网络。";
        status.dataset.kind = "error";
      } finally {
        setBusy(false);
      }
    });

    sheet.querySelector(".reminder-close").addEventListener("click", close);
    sheet.addEventListener("click", (event) => {
      if (event.target === sheet) close();
    });
    const onKey = (event) => {
      if (event.key === "Escape") {
        close();
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);

    document.body.appendChild(sheet);
    document.body.classList.add("reminder-open");
    requestAnimationFrame(() => {
      sheet.classList.add("show");
      email.focus();
    });
  };

  const scanMenus = () => {
    document.querySelectorAll(".menu").forEach(addMenuEntry);
  };

  new MutationObserver(scanMenus).observe(document.body, {
    childList: true,
    subtree: true,
  });
  scanMenus();
})();
