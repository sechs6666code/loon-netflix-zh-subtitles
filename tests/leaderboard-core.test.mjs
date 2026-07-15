import assert from "node:assert/strict";
import {
  calculateCurrentStreak,
  calculateStreaks,
  localDateKey,
  normalizePublicId,
  validatePublicId,
} from "../assets/leaderboard-core.js";

const now = new Date("2026-07-15T12:00:00");
const records = {
  "2026-07-15": "no",
  "2026-07-14": "no",
  "2026-07-13": "yes",
  "2026-07-12": "yes",
};

assert.equal(localDateKey(now), "2026-07-15");
assert.equal(calculateCurrentStreak(records, "no", now), 2);
assert.equal(calculateCurrentStreak(records, "yes", now), 0);
assert.deepEqual(calculateStreaks(records, now), { ninjaDays: 2, rushDays: 0 });
assert.equal(
  calculateCurrentStreak({ "2026-07-14": "yes", "2026-07-13": "yes" }, "yes", now),
  2,
  "when today is not recorded, the current streak should end at yesterday",
);
assert.equal(normalizePublicId("  忍者_07  "), "忍者_07");
assert.equal(validatePublicId("忍者_07").valid, true);
assert.equal(validatePublicId("ab").valid, false);
assert.equal(validatePublicId("包含 空格").valid, false);

console.log("leaderboard core tests passed");
