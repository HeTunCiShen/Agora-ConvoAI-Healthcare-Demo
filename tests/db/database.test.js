const { createDb } = require('../../backend/db/database');

describe('database schema', () => {
  let db;
  beforeEach(() => { db = createDb(':memory:'); });
  afterEach(() => { db.close(); });

  test('creates profiles table', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'").get();
    expect(row.name).toBe('profiles');
  });

  test('creates call_summaries table', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='call_summaries'").get();
    expect(row.name).toBe('call_summaries');
  });

  test('creates care_plans table', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='care_plans'").get();
    expect(row.name).toBe('care_plans');
  });

  test('creates sse_events table', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sse_events'").get();
    expect(row.name).toBe('sse_events');
  });

  test('inserts and retrieves a profile row', () => {
    db.prepare('INSERT INTO profiles (id, role, name, avatar) VALUES (?, ?, ?, ?)').run('p1', 'patient', 'Test', 'T');
    const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get('p1');
    expect(row.name).toBe('Test');
    expect(row.role).toBe('patient');
  });
});
