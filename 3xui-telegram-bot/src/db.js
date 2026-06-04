const Database = require('better-sqlite3');
const path = require('path');

function initDb(dbPath) {
  const resolved = dbPath ? dbPath : path.join(__dirname, '..', 'data', 'bot.sqlite');
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS panels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      base_url TEXT NOT NULL,
      web_base_path TEXT DEFAULT '',
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      owner_tg_id TEXT DEFAULT '',
      traffic_limit_bytes INTEGER DEFAULT 0,
      quota_baseline_sold_bytes INTEGER DEFAULT 0,
      quota_baseline_set_at INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_id TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      created_by TEXT
    );
  `);

  const panelColumns = db.prepare('PRAGMA table_info(panels)').all().map((row) => row.name);
  if (!panelColumns.includes('owner_tg_id')) {
    db.exec("ALTER TABLE panels ADD COLUMN owner_tg_id TEXT DEFAULT ''");
  }
  if (!panelColumns.includes('traffic_limit_bytes')) {
    db.exec("ALTER TABLE panels ADD COLUMN traffic_limit_bytes INTEGER DEFAULT 0");
  }
  if (!panelColumns.includes('quota_baseline_sold_bytes')) {
    db.exec("ALTER TABLE panels ADD COLUMN quota_baseline_sold_bytes INTEGER DEFAULT 0");
  }
  if (!panelColumns.includes('quota_baseline_set_at')) {
    db.exec("ALTER TABLE panels ADD COLUMN quota_baseline_set_at INTEGER DEFAULT 0");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS panel_client_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      panel_id INTEGER NOT NULL,
      client_key TEXT NOT NULL,
      client_email TEXT DEFAULT '',
      inbound_id TEXT DEFAULT '',
      inbound_name TEXT DEFAULT '',
      max_used_bytes INTEGER NOT NULL DEFAULT 0,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(panel_id, client_key)
    );
  `);

  return db;
}

module.exports = { initDb };
