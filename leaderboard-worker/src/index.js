const DEFAULT_ALLOWED_ORIGINS = [
  "https://sechs6666code.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://terminal.local:5173",
];

const PUBLIC_ID_PATTERN = /^[\p{L}\p{N}_-]{3,16}$/u;
const OWNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,160}$/;
const MAX_STREAK_DAYS = 20_000;
let schemaReady = null;

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
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  headers.append("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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
  const rank = (rows) => (rows.results || []).map((entry, index) => ({ ...entry, rank: index + 1 }));
  return json(
    { ninja: rank(ninja), rush: rank(rush), generatedAt: new Date().toISOString() },
    200,
    { "Cache-Control": "no-store" },
  );
}

async function saveProfile(request, env) {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return json({ error: "请求格式无效" }, 400);

  const ownerToken = typeof payload.ownerToken === "string" ? payload.ownerToken : "";
  const isPublic = payload.isPublic === true;
  if (!OWNER_TOKEN_PATTERN.test(ownerToken)) return json({ error: "本机身份凭证无效" }, 400);

  await ensureSchema(env);
  const ownerHash = await hashToken(ownerToken);
  if (!isPublic) {
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
  if (idOwner && idOwner.ownerHash !== ownerHash) return json({ error: "这个 ID 已被占用，请换一个" }, 409);

  const ninjaDays = normalizeDays(payload.ninjaDays);
  const rushDays = normalizeDays(payload.rushDays);
  const updatedAt = new Date().toISOString();
  try {
    if (owned) {
      await env.DB.prepare(`UPDATE leaderboard_profiles
        SET public_id = ?, public_id_key = ?, is_public = ?, ninja_days = ?, rush_days = ?, updated_at = ?
        WHERE owner_hash = ?`)
        .bind(publicId, publicIdKey, 1, ninjaDays, rushDays, updatedAt, ownerHash).run();
    } else {
      await env.DB.prepare(`INSERT INTO leaderboard_profiles
        (public_id, public_id_key, owner_hash, is_public, ninja_days, rush_days, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(publicId, publicIdKey, ownerHash, 1, ninjaDays, rushDays, updatedAt).run();
    }
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) return json({ error: "这个 ID 已被占用，请换一个" }, 409);
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

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "GET" && path === "/health") return json({ ok: true });
  if (request.method === "GET" && path === "/v1/leaderboard") return leaderboard(env);
  if (request.method === "POST" && path === "/v1/profile") return saveProfile(request, env);
  if (request.method === "DELETE" && path === "/v1/profile") return deleteProfile(request, env);
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const origin = corsOrigin(request, env);
    if (origin === null) return json({ error: "Origin not allowed" }, 403);
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), origin);
    try {
      return withCors(await route(request, env), origin);
    } catch (error) {
      console.error("leaderboard worker error", error);
      return withCors(json({ error: "排行榜服务暂时不可用" }, 503), origin);
    }
  },
};
