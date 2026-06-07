// tests/slots.test.js
const Database = require('better-sqlite3');
const {
  parseNaive, normalizeNaive, isValidSlot, enumerateSlots,
  getBookedSlots, getAvailableSlots, findConflict,
} = require('../backend/lib/slots');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE appointments (
    id TEXT PRIMARY KEY, patient_id TEXT, doctor_id TEXT,
    date_time TEXT, status TEXT, reason TEXT, created_at TEXT, updated_at TEXT
  );`);
  return db;
}
function addAppt(db, doctor_id, date_time, status) {
  db.prepare(`INSERT INTO appointments (id, patient_id, doctor_id, date_time, status, reason, created_at, updated_at)
    VALUES (?, 'p', ?, ?, ?, '', '', '')`).run(date_time + '|' + status, doctor_id, date_time, status);
}

describe('parseNaive / normalizeNaive', () => {
  test('parses naive wall-clock parts', () => {
    expect(parseNaive('2026-06-16T14:30:00')).toMatchObject({ date: '2026-06-16', hour: 14, minute: 30, time: '14:30' });
  });
  test('parses and strips trailing Z to naive', () => {
    expect(normalizeNaive('2026-06-16T14:30:00.000Z')).toBe('2026-06-16T14:30:00');
  });
  test('returns null for garbage', () => {
    expect(parseNaive('nonsense')).toBeNull();
    expect(normalizeNaive(42)).toBeNull();
  });
});

describe('isValidSlot', () => {
  test('accepts on-the-hour and half-hour within hours', () => {
    expect(isValidSlot('2026-06-16T08:00:00')).toBe(true);
    expect(isValidSlot('2026-06-16T15:30:00')).toBe(true);
  });
  test('rejects out-of-hours and unaligned', () => {
    expect(isValidSlot('2026-06-16T07:30:00')).toBe(false); // before 8
    expect(isValidSlot('2026-06-16T16:00:00')).toBe(false); // 16:00 is past last slot
    expect(isValidSlot('2026-06-16T14:15:00')).toBe(false); // not :00/:30
  });
});

describe('enumerateSlots', () => {
  test('lists 08:00 .. 15:30 every 30 min', () => {
    const slots = enumerateSlots();
    expect(slots[0]).toBe('08:00');
    expect(slots[slots.length - 1]).toBe('15:30');
    expect(slots).toHaveLength(16);
  });
});

describe('booked / available / conflict', () => {
  test('requested and confirmed occupy; declined frees', () => {
    const db = makeDb();
    addAppt(db, 'doctor-1', '2026-06-16T09:00:00', 'requested');
    addAppt(db, 'doctor-1', '2026-06-16T10:00:00', 'confirmed');
    addAppt(db, 'doctor-1', '2026-06-16T11:00:00', 'declined');
    const booked = getBookedSlots(db, 'doctor-1', '2026-06-16').sort();
    expect(booked).toEqual(['09:00', '10:00']);
    const avail = getAvailableSlots(db, 'doctor-1', '2026-06-16');
    expect(avail).not.toContain('09:00');
    expect(avail).not.toContain('10:00');
    expect(avail).toContain('11:00');
    expect(avail).toContain('08:00');
  });
  test('findConflict matches same doctor+slot only', () => {
    const db = makeDb();
    addAppt(db, 'doctor-1', '2026-06-16T09:00:00', 'requested');
    expect(findConflict(db, 'doctor-1', '2026-06-16T09:00:00.000Z')).toBeTruthy();
    expect(findConflict(db, 'doctor-1', '2026-06-16T09:30:00')).toBeNull();
    expect(findConflict(db, 'doctor-2', '2026-06-16T09:00:00')).toBeNull();
  });
});
