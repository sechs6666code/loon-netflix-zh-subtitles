CREATE TABLE IF NOT EXISTS leaderboard_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  public_id TEXT NOT NULL,
  public_id_key TEXT NOT NULL,
  owner_hash TEXT NOT NULL,
  is_public INTEGER DEFAULT 0 NOT NULL,
  ninja_days INTEGER DEFAULT 0 NOT NULL,
  rush_days INTEGER DEFAULT 0 NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_profiles_public_id_key_unique
  ON leaderboard_profiles (public_id_key);
CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_profiles_owner_hash_unique
  ON leaderboard_profiles (owner_hash);
CREATE INDEX IF NOT EXISTS leaderboard_profiles_ninja_idx
  ON leaderboard_profiles (is_public, ninja_days);
CREATE INDEX IF NOT EXISTS leaderboard_profiles_rush_idx
  ON leaderboard_profiles (is_public, rush_days);
