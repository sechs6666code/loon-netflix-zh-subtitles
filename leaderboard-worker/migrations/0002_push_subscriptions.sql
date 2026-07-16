CREATE TABLE IF NOT EXISTS push_subscriptions (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_unique
  ON push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS push_subscriptions_enabled_idx
  ON push_subscriptions (enabled, reminder_time);
