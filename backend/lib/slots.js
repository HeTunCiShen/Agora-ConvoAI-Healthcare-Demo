// backend/lib/slots.js
// Floating wall-clock appointment slots. Times are timezone-naive strings
// "YYYY-MM-DDTHH:MM:00" (no Z, no offset). A slot is identified by
// doctor_id + naive date_time. No timezone conversion is ever performed.

const BUSINESS_START_HOUR = 8;   // 08:00 is the first bookable slot
const BUSINESS_END_HOUR = 16;    // 16:00 = first instant AFTER the last slot
const SLOT_MINUTES = 30;
const OCCUPYING_STATUSES = ['requested', 'confirmed']; // 'declined' frees a slot

const pad = (n) => String(n).padStart(2, '0');

/** Parse naive (or Z/offset-suffixed) date_time into wall-clock parts, or null. */
function parseNaive(dt) {
  if (typeof dt !== 'string') return null;
  const m = dt.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const hour = Number(hh);
  const minute = Number(mm);
  const date = `${y}-${mo}-${d}`;
  return { date, hour, minute, time: `${pad(hour)}:${pad(minute)}`, key: `${date}T${pad(hour)}:${pad(minute)}` };
}

/** Canonical naive string "YYYY-MM-DDTHH:MM:00" (strips any Z/offset), or null. */
function normalizeNaive(dt) {
  const p = parseNaive(dt);
  if (!p) return null;
  return `${p.date}T${pad(p.hour)}:${pad(p.minute)}:00`;
}

/** True if dt is a bookable slot: minute 0/30 and 08:00 <= start < 16:00. */
function isValidSlot(dt) {
  const p = parseNaive(dt);
  if (!p) return false;
  if (p.minute !== 0 && p.minute !== 30) return false;
  const startMin = p.hour * 60 + p.minute;
  return startMin >= BUSINESS_START_HOUR * 60 && startMin < BUSINESS_END_HOUR * 60;
}

/** Slot start times for any day: ["08:00", ..., "15:30"]. */
function enumerateSlots() {
  const out = [];
  for (let h = BUSINESS_START_HOUR; h < BUSINESS_END_HOUR; h++) {
    for (let m = 0; m < 60; m += SLOT_MINUTES) out.push(`${pad(h)}:${pad(m)}`);
  }
  return out;
}

/** "HH:MM" times occupied for a doctor on a date (requested/confirmed only). */
function getBookedSlots(db, doctorId, date) {
  const rows = db.prepare(
    `SELECT date_time FROM appointments WHERE doctor_id = ? AND status IN ('requested','confirmed')`
  ).all(doctorId);
  const times = [];
  for (const r of rows) {
    const p = parseNaive(r.date_time);
    if (p && p.date === date) times.push(p.time);
  }
  return times;
}

/** Free slot start times ("HH:MM") for a doctor on a date. */
function getAvailableSlots(db, doctorId, date) {
  const booked = new Set(getBookedSlots(db, doctorId, date));
  return enumerateSlots().filter((t) => !booked.has(t));
}

/** Existing occupying appointment row at the same doctor+slot, or null. */
function findConflict(db, doctorId, dt) {
  const want = parseNaive(dt);
  if (!want) return null;
  const rows = db.prepare(
    `SELECT * FROM appointments WHERE doctor_id = ? AND status IN ('requested','confirmed')`
  ).all(doctorId);
  for (const r of rows) {
    const p = parseNaive(r.date_time);
    if (p && p.key === want.key) return r;
  }
  return null;
}

module.exports = {
  BUSINESS_START_HOUR, BUSINESS_END_HOUR, SLOT_MINUTES, OCCUPYING_STATUSES,
  parseNaive, normalizeNaive, isValidSlot, enumerateSlots,
  getBookedSlots, getAvailableSlots, findConflict,
};
