import assert from "node:assert/strict";
import {
  calculateCurrentStreak,
  calculateLongestStreak,
  calculateLongestStreaks,
  calculateStreaks,
  createRecoveryCode,
  localDateKey,
  milestoneState,
  normalizePublicId,
  parseRecoveryCode,
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
assert.equal(calculateLongestStreak(records, "no"), 2);
assert.equal(calculateLongestStreak(records, "yes"), 2);
assert.deepEqual(calculateLongestStreaks(records), { ninjaDays: 2, rushDays: 2 });
assert.equal(calculateLongestStreak({
  "2026-07-01": "yes",
  "2026-07-03": "yes",
}, "yes"), 1, "missing calendar days should break a historical streak");
assert.equal(
  calculateCurrentStreak({ "2026-07-14": "yes", "2026-07-13": "yes" }, "yes", now),
  2,
  "when today is not recorded, the current streak should end at yesterday",
);
assert.equal(normalizePublicId("  忍者_07  "), "忍者_07");
assert.equal(validatePublicId("忍者_07").valid, true);
assert.equal(validatePublicId("ab").valid, false);
assert.equal(validatePublicId("包含 空格").valid, false);

const profile = {
  publicId: "忍者_07",
  isPublic: true,
  ownerToken: "owner_token_12345678901234567890",
};
const recoveryCode = createRecoveryCode(profile, records);
assert.match(recoveryCode, /^CLM1\./);
const recovered = parseRecoveryCode(recoveryCode);
assert.equal(recovered.valid, true);
assert.deepEqual(recovered.profile, profile);
assert.deepEqual(recovered.records, records);
const tamperedSuffix = recoveryCode.endsWith("X") ? "Y" : "X";
assert.equal(parseRecoveryCode(`${recoveryCode.slice(0, -1)}${tamperedSuffix}`).valid, false, "tampered recovery codes should fail validation");

assert.equal(milestoneState(2, "ninja").earned.length, 0);
assert.equal(milestoneState(7, "ninja").currentLabel, "一周忍者");
assert.equal(milestoneState(30, "rush").currentLabel, "月度连冲");
assert.equal(milestoneState(365, "ninja").next, null);

console.log("leaderboard core tests passed");
