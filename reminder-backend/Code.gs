const CONFIG = {
  // 部署前改成至少 12 位、只有自己知道的随机字符串。
  PIN: "CHANGE_THIS_TO_A_LONG_RANDOM_PIN",
  // 在 Resend 后台创建“Sending access”权限的 API Key，并粘贴到这里。
  RESEND_API_KEY: "re_CHANGE_THIS_TO_YOUR_RESEND_API_KEY",
  // 未验证自有域名时，只能使用 onboarding@resend.dev 发给 Resend 账号邮箱。
  FROM_EMAIL: "个人习惯记录 <onboarding@resend.dev>",
  SITE_URL: "https://sechs6666code.github.io/chonglema/",
};

const KEYS = {
  email: "REMINDER_EMAIL",
  time: "REMINDER_TIME",
  timezone: "REMINDER_TIMEZONE",
  enabled: "REMINDER_ENABLED",
  lastSent: "REMINDER_LAST_SENT",
};

function setupReminderBackend() {
  if (!CONFIG.PIN || CONFIG.PIN.indexOf("CHANGE_THIS") === 0 || CONFIG.PIN.length < 12) {
    throw new Error("请先把 CONFIG.PIN 改成至少 12 位的随机字符串。");
  }
  if (!CONFIG.RESEND_API_KEY || CONFIG.RESEND_API_KEY.indexOf("re_CHANGE_THIS") === 0) {
    throw new Error("请先填写 Resend API Key。");
  }

  ScriptApp.getProjectTriggers()
    .filter(function (trigger) {
      return trigger.getHandlerFunction() === "reminderTick";
    })
    .forEach(function (trigger) {
      ScriptApp.deleteTrigger(trigger);
    });

  ScriptApp.newTrigger("reminderTick")
    .timeBased()
    .everyMinutes(5)
    .create();

  return "设置完成。现在请把脚本部署为网页应用。";
}

function doGet() {
  return jsonOutput({
    ok: true,
    service: "personal-habit-email-reminder",
  });
}

function doPost(event) {
  try {
    const payload = JSON.parse((event.postData && event.postData.contents) || "{}");
    if (!safeEqual(payload.pin, CONFIG.PIN)) {
      throw new Error("安全 PIN 不正确。");
    }

    if (payload.action === "configure") {
      return configureReminder(payload);
    }

    if (payload.action === "test") {
      return sendTestEmail(payload);
    }

    throw new Error("不支持的操作。");
  } catch (error) {
    return jsonOutput({ ok: false, error: String(error.message || error) });
  }
}

function configureReminder(payload) {
  const email = validateEmail(payload.email);
  const time = validateTime(payload.time);
  const timezone = validateTimezone(payload.timezone);
  const enabled = payload.enabled !== false;
  const properties = PropertiesService.getScriptProperties();

  properties.setProperties({
    [KEYS.email]: email,
    [KEYS.time]: time,
    [KEYS.timezone]: timezone,
    [KEYS.enabled]: enabled ? "true" : "false",
  });

  const now = new Date();
  const localDate = Utilities.formatDate(now, timezone, "yyyy-MM-dd");
  const localTime = Utilities.formatDate(now, timezone, "HH:mm");
  if (localTime >= time) {
    properties.setProperty(KEYS.lastSent, localDate);
  } else {
    properties.deleteProperty(KEYS.lastSent);
  }

  sendEmailThroughResend({
    to: email,
    subject: enabled ? "每日提醒已开启" : "每日提醒已关闭",
    text: enabled
      ? "每日提醒已开启，提醒时间为 " + time + "（" + timezone + "）。"
      : "每日提醒已经关闭。",
    html: settingsEmailHtml(enabled, time, timezone),
    idempotencyKey: "reminder-settings-" + new Date().getTime(),
  });

  return jsonOutput({ ok: true, enabled: enabled });
}

function sendTestEmail(payload) {
  const email = validateEmail(payload.email);
  const time = validateTime(payload.time);
  const timezone = validateTimezone(payload.timezone);

  sendEmailThroughResend({
    to: email,
    subject: "测试邮件｜每日提醒",
    text: "测试成功。之后会在每天 " + time + "（" + timezone + "）发送提醒。",
    html: reminderEmailHtml("测试成功", "邮件提醒已经连接。", time, timezone),
    idempotencyKey: "reminder-test-" + new Date().getTime(),
  });

  return jsonOutput({ ok: true });
}

function reminderTick() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(KEYS.enabled) !== "true") return;

  const email = properties.getProperty(KEYS.email);
  const time = properties.getProperty(KEYS.time);
  const timezone = properties.getProperty(KEYS.timezone);
  if (!email || !time || !timezone) return;

  const now = new Date();
  const localDate = Utilities.formatDate(now, timezone, "yyyy-MM-dd");
  const localTime = Utilities.formatDate(now, timezone, "HH:mm");
  if (localTime < time || properties.getProperty(KEYS.lastSent) === localDate) return;

  sendEmailThroughResend({
    to: email,
    subject: "今天记一下",
    text: "花十秒钟记录今天。记录改变，而不是审判自己。\n\n" + CONFIG.SITE_URL,
    html: reminderEmailHtml(
      "今天记一下",
      "花十秒钟记录今天。记录改变，而不是审判自己。",
      time,
      timezone
    ),
    idempotencyKey: "daily-reminder-" + localDate,
  });

  properties.setProperty(KEYS.lastSent, localDate);
}

function reminderEmailHtml(title, message, time, timezone) {
  return [
    '<div style="margin:0;padding:32px 16px;background:#f3f1ea;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#1d211e">',
    '<div style="max-width:520px;margin:auto;padding:30px;border:1px solid #ffffff;border-radius:24px;background:#fffdf8;box-shadow:0 16px 45px rgba(48,65,56,.1)">',
    '<p style="margin:0 0 8px;color:#778079;font-size:13px">每日提醒 · ' + escapeHtml(time) + '</p>',
    '<h1 style="margin:0;font-size:30px;letter-spacing:-1px">' + escapeHtml(title) + '</h1>',
    '<p style="margin:15px 0 24px;color:#626963;font-size:15px;line-height:1.7">' + escapeHtml(message) + '</p>',
    '<a href="' + escapeHtml(CONFIG.SITE_URL) + '" style="display:inline-block;padding:13px 20px;border-radius:14px;background:#42d39b;color:#113c2c;font-size:14px;font-weight:700;text-decoration:none">打开记录</a>',
    '<p style="margin:24px 0 0;color:#9aa19c;font-size:11px">时区：' + escapeHtml(timezone) + '</p>',
    "</div></div>",
  ].join("");
}

function settingsEmailHtml(enabled, time, timezone) {
  const title = enabled ? "每日提醒已开启" : "每日提醒已关闭";
  const message = enabled
    ? "之后会在每天 " + time + " 左右发送一封提醒邮件。"
    : "设置已经保留，需要时可以再次开启。";
  return reminderEmailHtml(title, message, time, timezone);
}

function sendEmailThroughResend(message) {
  const response = UrlFetchApp.fetch("https://api.resend.com/emails", {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + CONFIG.RESEND_API_KEY,
      "Idempotency-Key": message.idempotencyKey,
    },
    payload: JSON.stringify({
      from: CONFIG.FROM_EMAIL,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error("Resend 发信失败（" + status + "）：" + body);
  }

  return JSON.parse(body || "{}");
}

function validateEmail(value) {
  const email = String(value || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("邮箱格式不正确。");
  }
  return email;
}

function validateTime(value) {
  const time = String(value || "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("提醒时间格式不正确。");
  }
  return time;
}

function validateTimezone(value) {
  const timezone = String(value || "Asia/Shanghai").trim();
  try {
    Utilities.formatDate(new Date(), timezone, "yyyy-MM-dd HH:mm");
  } catch (error) {
    throw new Error("时区设置不正确。");
  }
  return timezone;
}

function safeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
