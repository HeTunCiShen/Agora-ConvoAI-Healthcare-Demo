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
});
