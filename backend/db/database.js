// backend/db/database.js
const Database = require('better-sqlite3');
const path = require('path');

function createDb(dbPath) {
  const resolvedPath = dbPath || path.join(__dirname, 'healthcare.db');
  const db = new Database(resolvedPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar TEXT,
      age INTEGER,
      specialty TEXT,
      hospital TEXT,
      condition TEXT,
      medications TEXT,
      next_appointment TEXT,
      assigned_doctor TEXT,
      phone_number TEXT,
      extra_details TEXT
    );

    CREATE TABLE IF NOT EXISTS call_summaries (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      call_type TEXT NOT NULL,
      call_channel TEXT DEFAULT 'web',
      chief_complaint TEXT,
      symptoms TEXT,
      vitals_mentioned TEXT,
      medications_discussed TEXT,
      ai_recommendation TEXT,
      urgency TEXT DEFAULT 'low',
      transcript_excerpt TEXT,
      suggested_action TEXT,
      media_attachment_ids TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_attachments (
      id TEXT PRIMARY KEY,
      call_summary_id TEXT,
      patient_id TEXT,
      media_type TEXT,
      storage_path TEXT,
      llm_analysis TEXT,
      captured_at TEXT
    );

    CREATE TABLE IF NOT EXISTS care_plans (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      plan_text TEXT,
      status TEXT DEFAULT 'pending-review',
      doctor_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sse_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  return db;
}

module.exports = { createDb };
