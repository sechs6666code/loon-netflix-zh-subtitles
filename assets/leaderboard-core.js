export const RECORDS_KEY = "did-you-v1";
export const PROFILE_KEY = "chonglema-leaderboard-profile-v1";
export const RANK_SNAPSHOT_KEY = "chonglema-leaderboard-rank-snapshot-v1";

export const MILESTONES = [
  { days: 3, ninja: "初次稳住", rush: "连续起步" },
  { days: 7, ninja: "一周忍者", rush: "七日连冲" },
  { days: 30, ninja: "月度定力", rush: "月度连冲" },
  { days: 100, ninja: "百日宗师", rush: "百日纪录" },
  { days: 365, ninja: "年度传奇", rush: "年度纪录" },
];

export function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function readRecords(storage = localStorage) {
  try {
    const value = JSON.parse(storage.getItem(RECORDS_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function calculateCurrentStreak(records, value, now = new Date()) {
  let count = 0;
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);

  if (!records[localDateKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  while (records[localDateKey(cursor)] === value) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

export function calculateStreaks(records, now = new Date()) {
  return {
    ninjaDays: calculateCurrentStreak(records, "no", now),
    rushDays: calculateCurrentStreak(records, "yes", now),
  };
}

export function normalizePublicId(value) {
  return String(value || "").trim().normalize("NFC");
}

export function validatePublicId(value) {
  const publicId = normalizePublicId(value);
  if (!/^[\p{L}\p{N}_-]{3,16}$/u.test(publicId)) {
    return { valid: false, publicId, error: "ID 需为 3—16 位中文、字母、数字、下划线或短横线" };
  }
  return { valid: true, publicId, error: "" };
}

export function createOwnerToken(cryptoObject = crypto) {
  if (typeof cryptoObject.randomUUID === "function") {
    return cryptoObject.randomUUID().replaceAll("-", "");
  }
  const bytes = cryptoObject.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("");
}

export function readProfile(storage = localStorage, cryptoObject = crypto) {
  let value = {};
  try {
    value = JSON.parse(storage.getItem(PROFILE_KEY) || "{}");
  } catch {
    value = {};
  }

  return {
    publicId: normalizePublicId(value?.publicId),
    isPublic: value?.isPublic === true,
    ownerToken: typeof value?.ownerToken === "string" && value.ownerToken.length >= 24
      ? value.ownerToken
      : createOwnerToken(cryptoObject),
  };
}

function recoveryChecksum(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, "0").slice(-7);
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function createRecoveryCode(profile, records = {}) {
  const safeProfile = readProfile({
    getItem: () => JSON.stringify(profile || {}),
  });
  const safeRecords = records && typeof records === "object" && !Array.isArray(records) ? records : {};
  const payload = encodeBase64Url(JSON.stringify({
    version: 1,
    profile: safeProfile,
    records: safeRecords,
    createdAt: new Date().toISOString(),
  }));
  const checksum = recoveryChecksum(payload);
  return `CLM1.${payload.match(/.{1,24}/g).join(".")}.${checksum}`;
}

export function parseRecoveryCode(value) {
  try {
    const normalized = String(value || "").trim().replace(/\s+/g, "");
    const parts = normalized.split(".");
    if (parts.shift()?.toUpperCase() !== "CLM1" || parts.length < 2) {
      throw new Error("恢复码格式不正确");
    }
    const checksum = parts.pop()?.toUpperCase();
    const payload = parts.join("");
    if (!payload || checksum !== recoveryChecksum(payload)) {
      throw new Error("恢复码校验失败，请检查是否复制完整");
    }
    const decoded = JSON.parse(decodeBase64Url(payload));
    if (decoded?.version !== 1 || !decoded?.profile) throw new Error("暂不支持这个版本的恢复码");
    const profile = readProfile({ getItem: () => JSON.stringify(decoded.profile) });
    const validation = validatePublicId(profile.publicId);
    if (!validation.valid || profile.ownerToken !== decoded.profile.ownerToken) {
      throw new Error("恢复码中的身份信息无效");
    }
    const records = decoded.records && typeof decoded.records === "object" && !Array.isArray(decoded.records)
      ? decoded.records
      : {};
    return {
      valid: true,
      profile: { ...profile, publicId: validation.publicId },
      records,
      createdAt: typeof decoded.createdAt === "string" ? decoded.createdAt : "",
      error: "",
    };
  } catch (error) {
    return {
      valid: false,
      profile: null,
      records: {},
      createdAt: "",
      error: error instanceof Error ? error.message : "恢复码无效",
    };
  }
}

export function milestoneState(days, type = "ninja") {
  const normalizedDays = Math.max(0, Math.floor(Number(days) || 0));
  const earned = MILESTONES.filter((milestone) => normalizedDays >= milestone.days);
  const next = MILESTONES.find((milestone) => normalizedDays < milestone.days) || null;
  const previousDays = earned.at(-1)?.days || 0;
  const progress = next
    ? Math.max(0, Math.min(100, ((normalizedDays - previousDays) / (next.days - previousDays)) * 100))
    : 100;
  return {
    days: normalizedDays,
    earned,
    next,
    progress,
    currentLabel: earned.at(-1)?.[type] || "尚未解锁",
  };
}
