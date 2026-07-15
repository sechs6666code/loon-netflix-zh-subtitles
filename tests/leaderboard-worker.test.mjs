import assert from "node:assert/strict";
import worker, {
  hashToken,
  normalizeDays,
  normalizePublicId,
} from "../leaderboard-worker/src/index.js";

assert.equal(normalizePublicId("  忍者-01 "), "忍者-01");
assert.equal(normalizeDays(-4), 0);
assert.equal(normalizeDays(7.9), 7);
assert.equal(normalizeDays(999999), 20000);
assert.equal((await hashToken("a".repeat(32))).length, 64);

const env = { ALLOWED_ORIGINS: "https://sechs6666code.github.io" };
const health = await worker.fetch(new Request("https://api.example.test/health", {
  headers: { Origin: "https://sechs6666code.github.io" },
}), env);
assert.equal(health.status, 200);
assert.equal(health.headers.get("Access-Control-Allow-Origin"), "https://sechs6666code.github.io");
assert.deepEqual(await health.json(), { ok: true });

const blocked = await worker.fetch(new Request("https://api.example.test/health", {
  headers: { Origin: "https://attacker.example" },
}), env);
assert.equal(blocked.status, 403);

class MemoryStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.includes("WHERE owner_hash = ?")) {
      const row = this.database.rows.find((entry) => entry.ownerHash === this.values[0]);
      return row ? { id: row.id } : null;
    }
    if (this.sql.includes("WHERE public_id_key = ?")) {
      const row = this.database.rows.find((entry) => entry.publicIdKey === this.values[0]);
      return row ? { ownerHash: row.ownerHash } : null;
    }
    throw new Error(`Unsupported first statement: ${this.sql}`);
  }

  async all() {
    const scoreKey = this.sql.includes("ninja_days AS days") ? "ninjaDays" : "rushDays";
    const results = this.database.rows
      .filter((entry) => entry.isPublic && entry[scoreKey] > 0)
      .sort((left, right) => right[scoreKey] - left[scoreKey] || left.updatedAt.localeCompare(right.updatedAt))
      .slice(0, 100)
      .map((entry) => ({ publicId: entry.publicId, days: entry[scoreKey], updatedAt: entry.updatedAt }));
    return { results };
  }

  async run() {
    if (this.sql.startsWith("DELETE")) {
      this.database.rows = this.database.rows.filter((entry) => entry.ownerHash !== this.values[0]);
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE")) {
      const [publicId, publicIdKey, isPublic, ninjaDays, rushDays, updatedAt, ownerHash] = this.values;
      const row = this.database.rows.find((entry) => entry.ownerHash === ownerHash);
      Object.assign(row, { publicId, publicIdKey, isPublic, ninjaDays, rushDays, updatedAt });
      return { success: true };
    }
    if (this.sql.startsWith("INSERT")) {
      const [publicId, publicIdKey, ownerHash, isPublic, ninjaDays, rushDays, updatedAt] = this.values;
      if (this.database.rows.some((entry) => entry.publicIdKey === publicIdKey || entry.ownerHash === ownerHash)) {
        throw new Error("UNIQUE constraint failed");
      }
      this.database.rows.push({
        id: this.database.rows.length + 1,
        publicId,
        publicIdKey,
        ownerHash,
        isPublic,
        ninjaDays,
        rushDays,
        updatedAt,
      });
      return { success: true };
    }
    return { success: true };
  }
}

class MemoryDatabase {
  rows = [];

  prepare(sql) {
    return new MemoryStatement(this, sql);
  }

  async batch(statements) {
    return statements.map(() => ({ success: true }));
  }
}

const database = new MemoryDatabase();
const apiEnv = { ...env, DB: database };
const ownerToken = "owner_token_12345678901234567890";
const secondOwnerToken = "second_owner_123456789012345678";
const apiRequest = (path, method = "GET", body) => worker.fetch(new Request(`https://api.example.test${path}`, {
  method,
  headers: { Origin: "https://sechs6666code.github.io", "Content-Type": "application/json" },
  body: body ? JSON.stringify(body) : undefined,
}), apiEnv);

const saved = await apiRequest("/v1/profile", "POST", {
  publicId: "忍者007",
  ownerToken,
  isPublic: true,
  ninjaDays: 8,
  rushDays: 0,
});
assert.equal(saved.status, 200);

const firstBoard = await apiRequest("/v1/leaderboard");
const firstBoardPayload = await firstBoard.json();
assert.deepEqual(firstBoardPayload.ninja.map(({ publicId, days, rank }) => ({ publicId, days, rank })), [
  { publicId: "忍者007", days: 8, rank: 1 },
]);
assert.deepEqual(firstBoardPayload.rush, [], "zero-day entries should stay off a leaderboard");

const conflict = await apiRequest("/v1/profile", "POST", {
  publicId: "忍者007",
  ownerToken: secondOwnerToken,
  isPublic: true,
  ninjaDays: 9,
  rushDays: 0,
});
assert.equal(conflict.status, 409, "a public ID should belong to only one browser identity");

const removed = await apiRequest("/v1/profile", "DELETE", { ownerToken });
assert.equal(removed.status, 200);
const emptyBoard = await apiRequest("/v1/leaderboard");
assert.deepEqual((await emptyBoard.json()).ninja, [], "private users should leave no shared profile behind");

console.log("leaderboard worker tests passed");
