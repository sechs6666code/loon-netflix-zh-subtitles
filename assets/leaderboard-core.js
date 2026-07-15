export const RECORDS_KEY = "did-you-v1";
export const PROFILE_KEY = "chonglema-leaderboard-profile-v1";

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
