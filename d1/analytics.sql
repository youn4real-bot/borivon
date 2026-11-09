-- First-party analytics (founder 2026-11-09). Same DDL as lib/track/server.ts (which also runs it
-- on first use, idempotent). Applied to borivon-db on 2026-11-09 with:
--   npx wrangler d1 execute borivon-db --remote --file d1/analytics.sql -y
CREATE TABLE IF NOT EXISTS track_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '',
    src TEXT NOT NULL DEFAULT '',
    utm TEXT NOT NULL DEFAULT '',
    ref TEXT NOT NULL DEFAULT '',
    visitor TEXT NOT NULL DEFAULT '',
    sid TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    org TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT '',
    os TEXT NOT NULL DEFAULT '',
    browser TEXT NOT NULL DEFAULT '',
    lang TEXT NOT NULL DEFAULT '',
    screen TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    value TEXT NOT NULL DEFAULT '',
    lead_id TEXT NOT NULL DEFAULT ''
  );
CREATE INDEX IF NOT EXISTS track_events_at ON track_events(at);
CREATE INDEX IF NOT EXISTS track_events_type_at ON track_events(type, at);
CREATE INDEX IF NOT EXISTS track_events_src_at ON track_events(src, at);
CREATE INDEX IF NOT EXISTS track_events_lead ON track_events(lead_id);
CREATE TABLE IF NOT EXISTS track_links (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL DEFAULT '/fahrplan',
    created_at TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0
  );
