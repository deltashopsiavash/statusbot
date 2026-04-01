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
      created_at INTEGER NOT NULL
    );
  `);

  return db;
}

module.exports = { initDb };
