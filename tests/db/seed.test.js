const { createDb } = require('../../backend/db/database');
const { seed } = require('../../backend/db/seed');

describe('seed data', () => {
  let db;
  beforeEach(() => { db = createDb(':memory:'); seed(db); });
  afterEach(() => { db.close(); });

  test('seeds 2 patients', () => {
    const rows = db.prepare("SELECT * FROM profiles WHERE role='patient'").all();
    expect(rows).toHaveLength(2);
  });

  test('seeds 4 doctors', () => {
    const rows = db.prepare("SELECT * FROM profiles WHERE role='doctor'").all();
    expect(rows).toHaveLength(4);
  });

  test('patient-1 is Sarah Chen', () => {
    const row = db.prepare("SELECT * FROM profiles WHERE id='patient-1'").get();
    expect(row.name).toBe('Sarah Chen');
    expect(row.age).toBe(34);
  });

  test('patient-2 has a pending-review care plan', () => {
    const row = db.prepare("SELECT * FROM care_plans WHERE patient_id='patient-2'").get();
    expect(row).toBeTruthy();
    expect(row.status).toBe('pending-review');
  });

  test('seed is idempotent — running twice keeps 6 profiles', () => {
    seed(db);
    const rows = db.prepare('SELECT * FROM profiles').all();
    expect(rows).toHaveLength(6);
  });

  test('seeds 4 demo call summaries (2 per patient)', () => {
    const rows = db.prepare('SELECT * FROM call_summaries ORDER BY patient_id, created_at').all();
    expect(rows).toHaveLength(4);
    const p1 = rows.filter((r) => r.patient_id === 'patient-1');
    const p2 = rows.filter((r) => r.patient_id === 'patient-2');
    expect(p1).toHaveLength(2);
    expect(p2).toHaveLength(2);
  });

  test('seeds 4 demo appointments (2 per patient)', () => {
    const rows = db.prepare('SELECT * FROM appointments ORDER BY patient_id, date_time').all();
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.patient_id === 'patient-1')).toHaveLength(2);
    expect(rows.filter((r) => r.patient_id === 'patient-2')).toHaveLength(2);
  });

  test('seed is idempotent — mock calls and appointments do not duplicate', () => {
    seed(db);
    expect(db.prepare('SELECT COUNT(*) AS c FROM call_summaries').get().c).toBe(4);
    expect(db.prepare('SELECT COUNT(*) AS c FROM appointments').get().c).toBe(4);
  });
});
