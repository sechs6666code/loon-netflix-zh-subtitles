import { buildPushHTTPRequest } from "@pushforge/builder";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://sechs6666code.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://terminal.local:5173",
];

const PUBLIC_ID_PATTERN = /^[\p{L}\p{N}_-]{3,16}$/u;
const OWNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,160}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]{8,256}$/;
const PUSH_ENDPOINT_HOSTS = [/(^|\.)googleapis\.com$/i, /(^|\.)mozilla\.com$/i, /(^|\.)push\.apple\.com$/i];
const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_AUDIENCE = "chonglema-push-reminders";
const GITHUB_REPOSITORY = "sechs6666code/chonglema";
const GITHUB_WORKFLOW_REF = `${GITHUB_REPOSITORY}/.github/workflows/push-reminders.yml@refs/heads/main`;
const MAX_STREAK_DAYS = 20_000;
const MAX_SUBSCRIPTIONS_PER_TICK = 1_000;
let schemaReady = null;
let jwksCache = null;

export function normalizePublicId(value) {
  return typeof value === "string" ? value.trim().normalize("NFC") : "";
}

export function normalizeDays(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_STREAK_DAYS, Math.floor(value)));
}

export async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function allowedOrigins(env) {
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_ORIGINS);
}

function corsOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return "";
  return allowedOrigins(env).has(origin) ? origin : null;
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  headers.append("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(payload, status = 200, headers = {}) {
  return Response.json(payload, { status, headers });
}

function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS leaderboard_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        public_id TEXT NOT NULL,
        public_id_key TEXT NOT NULL,
        owner_hash TEXT NOT NULL,
        is_public INTEGER DEFAULT 0 NOT NULL,
        ninja_days INTEGER DEFAULT 0 NOT NULL,
        rush_days INTEGER DEFAULT 0 NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_profiles_public_id_key_unique ON leaderboard_profiles (public_id_key)"),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_profiles_owner_hash_unique ON leaderboard_profiles (owner_hash)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS leaderboard_profiles_ninja_idx ON leaderboard_profiles (is_public, ninja_days)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS leaderboard_profiles_rush_idx ON leaderboard_profiles (is_public, rush_days)"),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY NOT NULL,
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        reminder_time TEXT NOT NULL,
        timezone TEXT NOT NULL,
        enabled INTEGER DEFAULT 1 NOT NULL,
        last_sent_local_date TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_unique ON push_subscriptions (endpoint)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS push_subscriptions_enabled_idx ON push_subscriptions (enabled, reminder_time)"),
    ]).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function leaderboard(env) {
  await ensureSchema(env);
  const [ninja, rush] = await Promise.all([
    env.DB.prepare(`SELECT public_id AS publicId, ninja_days AS days, updated_at AS updatedAt
      FROM leaderboard_profiles WHERE is_public = 1 AND ninja_days > 0
      ORDER BY ninja_days DESC, updated_at ASC, public_id COLLATE NOCASE ASC LIMIT 100`).all(),
    env.DB.prepare(`SELECT public_id AS publicId, rush_days AS days, updated_at AS updatedAt
      FROM leaderboard_profiles WHERE is_public = 1 AND rush_days > 0
      ORDER BY rush_days DESC, updated_at ASC, public_id COLLATE NOCASE ASC LIMIT 100`).all(),
  ]);
  const ranked = (rows) => (rows.results || []).map((entry, index) => ({ ...entry, rank: index + 1 }));
  return json(
    { ninja: ranked(ninja), rush: ranked(rush), generatedAt: new Date().toISOString() },
    200,
    { "Cache-Control": "no-store" },
  );
}

async function saveProfile(request, env) {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return json({ error: "请求格式无效" }, 400);

  const ownerToken = typeof payload.ownerToken === "string" ? payload.ownerToken : "";
  if (!OWNER_TOKEN_PATTERN.test(ownerToken)) return json({ error: "本机身份凭证无效" }, 400);

  await ensureSchema(env);
  const ownerHash = await hashToken(ownerToken);
  if (payload.isPublic !== true) {
    await env.DB.prepare("DELETE FROM leaderboard_profiles WHERE owner_hash = ?").bind(ownerHash).run();
    return json({ profile: { isPublic: false } });
  }

  const publicId = normalizePublicId(payload.publicId);
  const publicIdKey = publicId.toLocaleLowerCase("zh-CN");
  if (!PUBLIC_ID_PATTERN.test(publicId)) {
    return json({ error: "ID 需为 3—16 位中文、字母、数字、下划线或短横线" }, 400);
  }

  const owned = await env.DB.prepare("SELECT id FROM leaderboard_profiles WHERE owner_hash = ? LIMIT 1")
    .bind(ownerHash).first();
  const idOwner = await env.DB.prepare("SELECT owner_hash AS ownerHash FROM leaderboard_profiles WHERE public_id_key = ? LIMIT 1")
    .bind(publicIdKey).first();
  if (idOwner && idOwner.ownerHash !== ownerHash) {
    return json({ error: "这个 ID 已被占用，请换一个" }, 409);
  }

  const ninjaDays = normalizeDays(payload.ninjaDays);
  const rushDays = normalizeDays(payload.rushDays);
  const updatedAt = new Date().toISOString();
  try {
    if (owned) {
      await env.DB.prepare(`UPDATE leaderboard_profiles
        SET public_id = ?, public_id_key = ?, is_public = 1, ninja_days = ?, rush_days = ?, updated_at = ?
        WHERE owner_hash = ?`)
        .bind(publicId, publicIdKey, ninjaDays, rushDays, updatedAt, ownerHash).run();
    } else {
      await env.DB.prepare(`INSERT INTO leaderboard_profiles
        (public_id, public_id_key, owner_hash, is_public, ninja_days, rush_days, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?)`)
        .bind(publicId, publicIdKey, ownerHash, ninjaDays, rushDays, updatedAt).run();
    }
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) {
      return json({ error: "这个 ID 已被占用，请换一个" }, 409);
    }
    throw error;
  }

  return json({ profile: { publicId, isPublic: true, ninjaDays, rushDays, updatedAt } });
}

async function deleteProfile(request, env) {
  const payload = await request.json().catch(() => null);
  const ownerToken = typeof payload?.ownerToken === "string" ? payload.ownerToken : "";
  if (!OWNER_TOKEN_PATTERN.test(ownerToken)) return json({ error: "本机身份凭证无效" }, 400);
  await ensureSchema(env);
  const ownerHash = await hashToken(ownerToken);
  await env.DB.prepare("DELETE FROM leaderboard_profiles WHERE owner_hash = ?").bind(ownerHash).run();
  return json({ deleted: true });
}

function normalizeTimezone(value) {
  const timezone = typeof value === "string" ? value.trim() : "";
  if (!timezone || timezone.length > 80) return "";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return "";
  }
}

function normalizeSubscription(value) {
  if (!value || typeof value !== "object") return null;
  const endpoint = typeof value.endpoint === "string" ? value.endpoint.trim() : "";
  const p256dh = typeof value.keys?.p256dh === "string" ? value.keys.p256dh.trim().replace(/=+$/, "") : "";
  const auth = typeof value.keys?.auth === "string" ? value.keys.auth.trim().replace(/=+$/, "") : "";
  if (!endpoint || endpoint.length > 2_048 || !BASE64_URL_PATTERN.test(p256dh) || !BASE64_URL_PATTERN.test(auth)) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    if (!PUSH_ENDPOINT_HOSTS.some((pattern) => pattern.test(url.hostname))) return null;
  } catch {
    return null;
  }
  return { endpoint, keys: { p256dh, auth } };
}

async function pushConfig(env) {
  const publicKey = String(env.VAPID_PUBLIC_KEY || "").trim();
  if (!publicKey) return json({ error: "提醒服务尚未配置" }, 503);
  return json(
    { publicKey, privacy: "仅保存匿名推送地址、提醒时间和时区；不上传打卡记录。" },
    200,
    { "Cache-Control": "public, max-age=3600" },
  );
}

async function savePushSubscription(request, env) {
  const payload = await request.json().catch(() => null);
  const subscription = normalizeSubscription(payload?.subscription);
  const reminderTime = typeof payload?.reminderTime === "string" ? payload.reminderTime : "";
  const timezone = normalizeTimezone(payload?.timezone);
  if (!subscription) return json({ error: "推送订阅无效，请重新授权" }, 400);
  if (!TIME_PATTERN.test(reminderTime)) return json({ error: "请选择有效的提醒时间" }, 400);
  if (!timezone) return json({ error: "无法识别当前时区" }, 400);

  await ensureSchema(env);
  const id = await hashToken(subscription.endpoint);
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO push_subscriptions
    (id, endpoint, p256dh, auth, reminder_time, timezone, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      endpoint = excluded.endpoint,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      reminder_time = excluded.reminder_time,
      timezone = excluded.timezone,
      enabled = 1,
      updated_at = excluded.updated_at`)
    .bind(id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, reminderTime, timezone, updatedAt)
    .run();
  return json({ saved: true, reminderTime, timezone });
}

async function deletePushSubscription(request, env) {
  const payload = await request.json().catch(() => null);
  const endpoint = typeof payload?.endpoint === "string" ? payload.endpoint.trim() : "";
  if (!endpoint || endpoint.length > 2_048) return json({ error: "推送订阅无效" }, 400);
  await ensureSchema(env);
  const id = await hashToken(endpoint);
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(id).run();
  return json({ deleted: true });
}

async function sendWebPush(subscription, env, payload) {
  if (!env.VAPID_PRIVATE_KEY) throw new Error("VAPID private key is missing");
  const request = await buildPushHTTPRequest({
    privateJWK: env.VAPID_PRIVATE_KEY,
    subscription,
    message: {
      payload,
      adminContact: "https://sechs6666code.github.io/chonglema/",
      options: { ttl: 3_600, urgency: "normal", topic: "chonglema-daily" },
    },
  });
  return fetch(request.endpoint, { method: "POST", headers: request.headers, body: request.body });
}

async function testPushSubscription(request, env) {
  const payload = await request.json().catch(() => null);
  const subscription = normalizeSubscription(payload?.subscription);
  if (!subscription) return json({ error: "推送订阅无效，请重新授权" }, 400);
  const response = await sendWebPush(subscription, env, {
    title: "提醒已开启",
    body: "今天，冲了吗？明天也会按你设置的时间来。",
    tag: "chonglema-test",
    url: "./?source=push-test",
  });
  if (response.ok) return json({ sent: true });
  if (response.status === 404 || response.status === 410) {
    const id = await hashToken(subscription.endpoint);
    await ensureSchema(env);
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(id).run();
    return json({ error: "订阅已失效，请关闭后重新开启提醒" }, 410);
  }
  return json({ error: "测试通知暂时发送失败，请稍后再试" }, 502);
}

export function zonedClock(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function isReminderDue(reminderTime, clock, lastSentLocalDate) {
  if (!TIME_PATTERN.test(reminderTime) || !clock?.date || !Number.isFinite(clock.minutes)) return false;
  if (lastSentLocalDate === clock.date) return false;
  const [hours, minutes] = reminderTime.split(":").map(Number);
  const delay = clock.minutes - (hours * 60 + minutes);
  return delay >= 0 && delay < 60;
}

export async function runDueReminders(env, now = new Date()) {
  await ensureSchema(env);
  const rows = await env.DB.prepare(`SELECT id, endpoint, p256dh, auth,
      reminder_time AS reminderTime, timezone, last_sent_local_date AS lastSentLocalDate
    FROM push_subscriptions WHERE enabled = 1
    ORDER BY reminder_time ASC LIMIT ?`).bind(MAX_SUBSCRIPTIONS_PER_TICK).all();
  let due = 0;
  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const row of rows.results || []) {
    let clock;
    try {
      clock = zonedClock(now, row.timezone);
    } catch {
      failed += 1;
      continue;
    }
    if (!isReminderDue(row.reminderTime, clock, row.lastSentLocalDate)) continue;
    due += 1;
    try {
      const response = await sendWebPush({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      }, env, {
        title: "今天，冲了吗？",
        body: "花几秒记一下，保持自己的节奏。",
        tag: "chonglema-daily",
        url: "./?source=push",
      });
      if (response.ok) {
        await env.DB.prepare(`UPDATE push_subscriptions
          SET last_sent_local_date = ?, updated_at = ? WHERE id = ?`)
          .bind(clock.date, now.toISOString(), row.id).run();
        sent += 1;
      } else if (response.status === 404 || response.status === 410) {
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(row.id).run();
        removed += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      console.error("push delivery failed", row.id, error);
      failed += 1;
    }
  }
  return { scanned: (rows.results || []).length, due, sent, removed, failed, generatedAt: now.toISOString() };
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJwtJson(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function githubJwks(force = false) {
  const now = Date.now();
  if (!force && jwksCache?.expiresAt > now) return jwksCache.keys;
  const response = await fetch(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`);
  if (!response.ok) throw new Error("Unable to load GitHub OIDC keys");
  const payload = await response.json();
  if (!Array.isArray(payload.keys)) throw new Error("Invalid GitHub OIDC keys");
  jwksCache = { keys: payload.keys, expiresAt: now + 3_600_000 };
  return payload.keys;
}

export async function verifyGithubOidc(request) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || token.length > 12_000) return false;
  const segments = token.split(".");
  if (segments.length !== 3) return false;
  try {
    const header = decodeJwtJson(segments[0]);
    const claims = decodeJwtJson(segments[1]);
    if (header.alg !== "RS256" || !header.kid) return false;
    let keys = await githubJwks();
    let jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk) {
      keys = await githubJwks(true);
      jwk = keys.find((key) => key.kid === header.kid);
    }
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(segments[2]),
      new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
    );
    if (!verified) return false;
    const now = Math.floor(Date.now() / 1_000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    return claims.iss === GITHUB_OIDC_ISSUER
      && audiences.includes(GITHUB_OIDC_AUDIENCE)
      && Number(claims.exp) > now
      && Number(claims.nbf || 0) <= now + 30
      && Number(claims.iat || 0) >= now - 600
      && claims.repository === GITHUB_REPOSITORY
      && claims.ref === "refs/heads/main"
      && claims.workflow_ref === GITHUB_WORKFLOW_REF
      && ["schedule", "workflow_dispatch"].includes(claims.event_name);
  } catch {
    return false;
  }
}

async function runPushTick(request, env) {
  if (!(await verifyGithubOidc(request))) return json({ error: "Unauthorized" }, 401);
  return json(await runDueReminders(env));
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "GET" && path === "/") {
    return json({ service: "chonglema-leaderboard", push: true, ok: true });
  }
  if (request.method === "GET" && path === "/health") return json({ ok: true, push: Boolean(env.VAPID_PUBLIC_KEY) });
  if (request.method === "GET" && path === "/v1/leaderboard") return leaderboard(env);
  if (request.method === "POST" && path === "/v1/profile") return saveProfile(request, env);
  if (request.method === "DELETE" && path === "/v1/profile") return deleteProfile(request, env);
  if (request.method === "GET" && path === "/v1/push/config") return pushConfig(env);
  if (request.method === "POST" && path === "/v1/push/subscription") return savePushSubscription(request, env);
  if (request.method === "DELETE" && path === "/v1/push/subscription") return deletePushSubscription(request, env);
  if (request.method === "POST" && path === "/v1/push/test") return testPushSubscription(request, env);
  if (request.method === "POST" && path === "/v1/push/tick") return runPushTick(request, env);
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    void ctx;
    const origin = corsOrigin(request, env);
    if (origin === null) return json({ error: "Origin not allowed" }, 403);
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), origin);
    }
    try {
      return withCors(await route(request, env), origin);
    } catch (error) {
      console.error("chonglema service error", error);
      return withCors(json({ error: "服务暂时不可用" }, 503), origin);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDueReminders(env, new Date(event.scheduledTime || Date.now())));
  },
};
