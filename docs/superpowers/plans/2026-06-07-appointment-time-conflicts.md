# Appointment Time Slots & Conflict Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 30-minute appointment slots (08:00–16:00), per-doctor conflict detection, and timezone-naive "floating wall-clock" times across the manual form, the live AI call, and post-call transcript extraction; make seed data relative to the seed-run date.

**Architecture:** A new pure-ish module `backend/lib/slots.js` owns all slot math and DB availability queries. The healthcare controller uses it to validate `createAppointment`, expose `GET /availability`, and filter `/summarize` output. Times are stored timezone-naive (`YYYY-MM-DDTHH:MM:00`, no `Z`); the frontend displays the wall clock directly and the manual form becomes a date picker + availability-driven slot dropdown. The agent prompt carries the operator's local time and each doctor's booked slots so it can steer bookings; post-call validation is authoritative.

**Tech Stack:** Node.js + Express, better-sqlite3, Jest + Supertest, vanilla JS frontend, Agora SDK. Spec: `docs/superpowers/specs/2026-06-07-appointment-time-conflicts-design.md`.

---

## File Structure

- **Create** `backend/lib/slots.js` — slot constants + helpers: `parseNaive`, `normalizeNaive`, `isValidSlot`, `enumerateSlots`, `getBookedSlots`, `getAvailableSlots`, `findConflict`.
- **Create** `tests/slots.test.js` — unit tests for the module.
- **Modify** `backend/controllers/healthcareController.js` — import slots; validate `createAppointment` (422/409); add `getAvailability`; validate `/summarize` appointment_requests.
- **Modify** `backend/routes/healthcare_routes.js` — wire `GET /availability`.
- **Modify** `backend/db/seed.js` — relative-date helpers; naive appointment slots; recent summary dates.
- **Modify** `tests/healthcare.test.js` — wire availability route; add 422/409 + availability tests.
- **Modify** `tests/summarize.test.js` — add out-of-hours / conflict drop tests.
- **Modify** `frontend/utils/config.js` — `UTILS.formatApptTime`, `API.healthcare.getAvailability`.
- **Modify** `frontend/patient.js` — date+slot form, naive display, prompt (time + rules + doctor availability), resilient appointment creation.
- **Modify** `frontend/doctor.js` — prompt time wording (AI call + SIP), naive appointment display.

Backend tasks are strict TDD (failing test → implement → pass). The frontend has no Jest harness in this repo; those tasks are verified in the browser via the Claude Preview tool (start server, drive the page, assert DOM/computed state) — treat the browser checks as the test gate.

---

## Task 1: Slot model module

**Files:**
- Create: `backend/lib/slots.js`
- Test: `tests/slots.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/slots.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/slots.test.js`
Expected: FAIL — `Cannot find module '../backend/lib/slots'`.

- [ ] **Step 3: Write the module**

Create `backend/lib/slots.js`:

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/slots.test.js`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/slots.js tests/slots.test.js
git commit -m "Add slot model: validation, enumeration, availability, conflict"
```

---

## Task 2: Validate createAppointment (out-of-hours 422, conflict 409)

**Files:**
- Modify: `backend/controllers/healthcareController.js` (top require; `createAppointment` ~362-382)
- Test: `tests/healthcare.test.js` (POST describe ~157-198)

- [ ] **Step 1: Write the failing tests**

In `tests/healthcare.test.js`, add inside the existing `describe('POST /api/healthcare/appointments', …)` block (after the "creates an appointment" test):

```javascript
  test('stores date_time timezone-naive (no Z)', async () => {
    const res = await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-1', doctor_id: 'doctor-4',
      date_time: '2026-04-22T09:00:00.000Z', reason: 'x'
    });
    expect(res.status).toBe(201);
    expect(res.body.date_time).toBe('2026-04-22T09:00:00');
  });

  test('returns 422 for out-of-hours time', async () => {
    const res = await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-1', doctor_id: 'doctor-1',
      date_time: '2026-04-22T17:00:00', reason: 'late'
    });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('out_of_hours');
  });

  test('returns 422 for unaligned (non :00/:30) time', async () => {
    const res = await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-1', doctor_id: 'doctor-1',
      date_time: '2026-04-22T10:15:00', reason: 'odd'
    });
    expect(res.status).toBe(422);
  });

  test('returns 409 + available list when slot already taken', async () => {
    await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-1', doctor_id: 'doctor-1',
      date_time: '2026-04-25T13:00:00', reason: 'first'
    });
    const res = await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-2', doctor_id: 'doctor-1',
      date_time: '2026-04-25T13:00:00', reason: 'second'
    });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('conflict');
    expect(Array.isArray(res.body.available)).toBe(true);
    expect(res.body.available).not.toContain('13:00');
    expect(res.body.available).toContain('13:30');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/healthcare.test.js -t "out-of-hours"`
Expected: FAIL — currently returns 201 (no validation), and date_time still has `Z`.

- [ ] **Step 3: Implement validation**

In `backend/controllers/healthcareController.js`, add the require near the top (after line 3 `const axios = require('axios');`):

```javascript
const { normalizeNaive, isValidSlot, findConflict, getAvailableSlots, getBookedSlots, enumerateSlots, parseNaive } = require('../lib/slots');
```

Replace the `createAppointment` function (currently ~362-382) with:

```javascript
  function createAppointment(req, res) {
    const { patient_id, doctor_id, reason } = req.body;
    const date_time = normalizeNaive(req.body.date_time);

    if (!patient_id || !doctor_id || !date_time) {
      return res.status(400).json({ error: 'patient_id, doctor_id, and date_time are required' });
    }
    if (!isValidSlot(date_time)) {
      return res.status(422).json({
        error: 'Appointments must be a 30-minute slot between 8:00 AM and 4:00 PM',
        reason: 'out_of_hours'
      });
    }
    const clash = findConflict(db, doctor_id, date_time);
    if (clash) {
      const day = parseNaive(date_time).date;
      return res.status(409).json({
        error: 'That time slot is already booked',
        reason: 'conflict',
        available: getAvailableSlots(db, doctor_id, day)
      });
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO appointments (id, patient_id, doctor_id, date_time, status, reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'requested', ?, ?, ?)
    `).run(id, patient_id, doctor_id, date_time, reason || '', now, now);

    const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    sse.broadcast('new_appointment', { appointment });
    res.status(201).json(appointment);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/healthcare.test.js`
Expected: PASS (new 422/409/naive tests pass; pre-existing appointment tests still pass — their times 10:00/14:00 are valid slots on past dates with no conflict).

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/healthcareController.js tests/healthcare.test.js
git commit -m "Validate appointment slots: out-of-hours 422, conflict 409, naive storage"
```

---

## Task 3: GET /availability endpoint

**Files:**
- Modify: `backend/controllers/healthcareController.js` (add `getAvailability`; add to return object ~539)
- Modify: `backend/routes/healthcare_routes.js` (add route)
- Test: `tests/healthcare.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/healthcare.test.js`, first add the route to `makeApp()` (after the existing `app.post('/api/healthcare/appointments', …)` line):

```javascript
  app.get('/api/healthcare/availability', ctrl.getAvailability);
```

Then add a new describe block at the end of the file (before the final newline):

```javascript
describe('GET /api/healthcare/availability', () => {
  test('returns available and booked slots for a doctor+date', async () => {
    const app = makeApp();
    await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-1', doctor_id: 'doctor-1',
      date_time: '2026-04-27T09:00:00', reason: 'x'
    });
    const res = await request(app).get('/api/healthcare/availability?doctor_id=doctor-1&date=2026-04-27');
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-04-27');
    expect(res.body.booked).toContain('09:00');
    expect(res.body.available).not.toContain('09:00');
    expect(res.body.available).toContain('08:00');
  });

  test('returns 400 without doctor_id or date', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/healthcare/availability?doctor_id=doctor-1');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/healthcare.test.js -t "availability"`
Expected: FAIL — `ctrl.getAvailability is not a function`.

- [ ] **Step 3: Implement endpoint**

In `backend/controllers/healthcareController.js`, add this function just before `function sseStream(req, res)` (~535):

```javascript
  function getAvailability(req, res) {
    const { doctor_id, date } = req.query;
    if (!doctor_id || !date) {
      return res.status(400).json({ error: 'doctor_id and date are required' });
    }
    res.json({
      date,
      available: getAvailableSlots(db, doctor_id, date),
      booked: getBookedSlots(db, doctor_id, date)
    });
  }
```

Add `getAvailability` to the returned object (line ~539):

```javascript
  return { getProfile, listProfiles, listSummaries, createSummary, generateSummary, getProfileSummary, listAppointments, createAppointment, updateAppointment, getAvailability, getCarePlan, updateCarePlan, sseStream };
```

In `backend/routes/healthcare_routes.js`, add after the `router.get('/appointments', …)` line (~25):

```javascript
router.get('/availability', controller.getAvailability);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/healthcare.test.js -t "availability"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/healthcareController.js backend/routes/healthcare_routes.js tests/healthcare.test.js
git commit -m "Add GET /availability endpoint for doctor day slots"
```

---

## Task 4: Validate /summarize appointment_requests (drop out-of-hours & conflicts)

**Files:**
- Modify: `backend/controllers/healthcareController.js` (`generateSummary`, after `filterSpuriousAppointmentRequests` ~521-525)
- Test: `tests/summarize.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/summarize.test.js`, add a new describe block at the end of the file. It mocks the LLM to return appointment_requests and asserts validation drops invalid ones. (`axios` is already mocked at the top of this file.)

```javascript
describe('POST /api/healthcare/summarize — appointment slot validation', () => {
  const careTeam = [{ id: 'doctor-1', name: 'Dr. James Williams', specialty: 'Cardiologist' }];

  function mockLLM(appointment_requests) {
    axios.post.mockResolvedValueOnce({
      data: { choices: [{ message: { content: JSON.stringify({
        chief_complaint: 'booking', symptoms: [], vitals_mentioned: {}, medications_discussed: [],
        ai_recommendation: 'ok', urgency: 'low', transcript_excerpt: 'x', suggested_action: 'y',
        related_doctor_id: 'doctor-1', consultation_kind: 'appointment_booking', appointment_requests
      }) } }] }
    });
  }

  test('drops an out-of-hours request', async () => {
    const app = makeApp();
    mockLLM([{ doctor_name: 'Dr. James Williams', date_time: '2026-07-01T18:00:00', reason: 'late' }]);
    const res = await request(app).post('/api/healthcare/summarize').send({
      transcript: [{ role: 'user', content: 'book 6pm' }], call_type: 'patient',
      care_team: careTeam, existing_appointments: []
    });
    expect(res.status).toBe(200);
    expect(res.body.appointment_requests).toHaveLength(0);
  });

  test('keeps a valid request and normalizes its date_time', async () => {
    const app = makeApp();
    mockLLM([{ doctor_name: 'Dr. James Williams', date_time: '2026-07-01T14:00:00.000Z', reason: 'review' }]);
    const res = await request(app).post('/api/healthcare/summarize').send({
      transcript: [{ role: 'user', content: 'book 2pm' }], call_type: 'patient',
      care_team: careTeam, existing_appointments: []
    });
    expect(res.body.appointment_requests).toHaveLength(1);
    expect(res.body.appointment_requests[0].date_time).toBe('2026-07-01T14:00:00');
  });

  test('drops a request that conflicts with an existing appointment', async () => {
    const app = makeApp();
    // Seed an existing appointment via the API first
    await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-1', doctor_id: 'doctor-1', date_time: '2026-07-02T10:00:00', reason: 'existing'
    });
    mockLLM([{ doctor_name: 'Dr. James Williams', date_time: '2026-07-02T10:00:00', reason: 'dup slot' }]);
    const res = await request(app).post('/api/healthcare/summarize').send({
      transcript: [{ role: 'user', content: 'book 10am' }], call_type: 'patient',
      care_team: careTeam, existing_appointments: []
    });
    expect(res.body.appointment_requests).toHaveLength(0);
  });

  test('keeps only one when two requests target the same slot', async () => {
    const app = makeApp();
    mockLLM([
      { doctor_name: 'Dr. James Williams', date_time: '2026-07-03T11:00:00', reason: 'a' },
      { doctor_name: 'Dr. James Williams', date_time: '2026-07-03T11:00:00', reason: 'b' }
    ]);
    const res = await request(app).post('/api/healthcare/summarize').send({
      transcript: [{ role: 'user', content: 'book 11am twice' }], call_type: 'patient',
      care_team: careTeam, existing_appointments: []
    });
    expect(res.body.appointment_requests).toHaveLength(1);
  });
});
```

Make sure `makeApp()` in this file also mounts the appointments POST route. If it does not, add to `makeApp()`:

```javascript
  app.post('/api/healthcare/appointments', ctrl.createAppointment);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/summarize.test.js -t "appointment slot validation"`
Expected: FAIL — out-of-hours/conflict requests are currently returned unfiltered, and date_time keeps its `Z`.

- [ ] **Step 3: Implement the validation pass**

In `backend/controllers/healthcareController.js`, inside `generateSummary`, replace the block that computes `appointment_requests` (currently ~521-525):

```javascript
      const appointment_requests = filterSpuriousAppointmentRequests(
        summary.appointment_requests,
        req.body.existing_appointments,
        req.body.care_team
      );
```

with:

```javascript
      const deduped = filterSpuriousAppointmentRequests(
        summary.appointment_requests,
        req.body.existing_appointments,
        req.body.care_team
      );
      // Authoritative slot validation: drop out-of-hours, DB conflicts, and
      // duplicate slots within this batch. Normalize survivors to naive time.
      const appointment_requests = [];
      const acceptedKeys = new Set();
      for (const reqAppt of deduped) {
        const norm = normalizeNaive(reqAppt.date_time);
        if (!norm || !isValidSlot(norm)) continue;
        const docId = resolveDoctorIdFromAppointmentName(reqAppt.doctor_name, req.body.care_team);
        if (docId) {
          if (findConflict(db, docId, norm)) continue;
          const key = `${docId}|${parseNaive(norm).key}`;
          if (acceptedKeys.has(key)) continue;
          acceptedKeys.add(key);
        }
        appointment_requests.push({ ...reqAppt, date_time: norm });
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/summarize.test.js`
Expected: PASS (new validation tests pass; existing summarize tests unaffected — their requests use valid times or empty arrays).

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/healthcareController.js tests/summarize.test.js
git commit -m "Validate post-call appointment requests against hours and conflicts"
```

---

## Task 5: Relative, slot-valid seed data

**Files:**
- Modify: `backend/db/seed.js` (add helpers above the MOCK arrays; update `created_at` of summaries and `date_time` of appointments)
- Test: `tests/healthcare.test.js` (run full suite — the seeded count/ids assertions must still hold)

- [ ] **Step 1: Write the failing test**

In `tests/healthcare.test.js`, add to the `describe('GET /api/healthcare/availability', …)` block a check that seeded appointments are naive and slot-valid:

```javascript
  test('seeded appointments are naive wall-clock and on valid slots', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/healthcare/appointments');
    const { isValidSlot } = require('../backend/lib/slots');
    for (const a of res.body) {
      expect(a.date_time).not.toMatch(/Z$/);          // naive, no UTC suffix
      expect(isValidSlot(a.date_time)).toBe(true);     // 08:00–15:30, :00/:30
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/healthcare.test.js -t "seeded appointments are naive"`
Expected: FAIL — current seed `date_time`s end in `Z` (e.g. `2026-05-28T10:00:00.000Z`).

- [ ] **Step 3: Add helpers and update seed data**

In `backend/db/seed.js`, add these helpers immediately after the file's opening (before `const PROFILES` / the first const array — they must be defined before `MOCK_CALL_SUMMARIES` and `MOCK_APPOINTMENTS` use them):

```javascript
// --- Relative naive wall-clock date helpers (no timezone) -------------------
// Seed dates are computed relative to the seed-run date so a delete + re-seed
// always produces current-looking demo data (no manual re-dating).
const _pad2 = (n) => String(n).padStart(2, '0');
function naiveAt(d, hh, mm) {
  return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}T${_pad2(hh)}:${_pad2(mm)}:00`;
}
/** A naive timestamp n days before today at hh:mm (for historical records). */
function daysAgo(n, hh, mm) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return naiveAt(d, hh, mm);
}
/** A valid future slot offsetDays ahead (skipping weekends) at hh:mm. */
function nextBusinessSlot(offsetDays, hh, mm) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return naiveAt(d, hh, mm);
}
```

Update each `created_at` in `MOCK_CALL_SUMMARIES` to a recent past value (replace the literal ISO strings):

- `seed-call-p1-1`: `created_at: daysAgo(14, 19, 30),`
- `seed-call-p1-2`: `created_at: daysAgo(11, 9, 5),`
- `seed-call-p2-1`: `created_at: daysAgo(9, 11, 20),`
- `seed-call-p2-2`: `created_at: daysAgo(6, 20, 45),`

Update `MOCK_APPOINTMENTS` to valid future slots, naive, non-conflicting (replace each `date_time`, `created_at`, `updated_at`):

- `seed-appt-p1-1` (doctor-1, confirmed): `date_time: nextBusinessSlot(3, 10, 0), created_at: daysAgo(20, 8, 0), updated_at: daysAgo(20, 8, 0),`
- `seed-appt-p1-2` (doctor-3, requested): `date_time: nextBusinessSlot(5, 14, 30), created_at: daysAgo(12, 11, 0), updated_at: daysAgo(12, 11, 0),`
- `seed-appt-p2-1` (doctor-2, confirmed): `date_time: nextBusinessSlot(4, 11, 0), created_at: daysAgo(18, 9, 30), updated_at: daysAgo(18, 9, 30),`
- `seed-appt-p2-2` (doctor-2, requested): `date_time: nextBusinessSlot(6, 9, 30), created_at: daysAgo(10, 16, 20), updated_at: daysAgo(10, 16, 20),`

(`seed-appt-p2-1` and `seed-appt-p2-2` are both doctor-2 but on different days — no conflict.)

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — including the new naive/valid-slot seed test and the existing "returns seeded demo appointments … toHaveLength(4)" + id assertions (ids unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/db/seed.js tests/healthcare.test.js
git commit -m "Seed relative naive dates on valid slots (recurring demo)"
```

---

## Task 6: Frontend shared helpers (config.js)

**Files:**
- Modify: `frontend/utils/config.js` (`API.healthcare` ~102; `UTILS` ~142)

- [ ] **Step 1: Add the availability API method**

In `frontend/utils/config.js`, inside `API.healthcare` (after the `listAppointments` entry ~103), add:

```javascript
      getAvailability: ({ doctor_id, date }) =>
        API.request(`/healthcare/availability?doctor_id=${encodeURIComponent(doctor_id)}&date=${encodeURIComponent(date)}`),
```

- [ ] **Step 2: Add the naive time formatter**

In `frontend/utils/config.js`, inside `UTILS` (after `formatTime` ~167), add:

```javascript
    /**
     * Format a naive wall-clock appointment time WITHOUT timezone conversion.
     * Input: "YYYY-MM-DDTHH:MM[:SS][Z]" → "Jun 16, 2026 · 2:00 PM".
     * Reads the wall-clock digits directly so every viewer sees the same label.
     */
    formatApptTime: (dt) => {
        if (typeof dt !== 'string') return '';
        const m = dt.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
        if (!m) return dt;
        const [, y, mo, d, hh, mm] = m;
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        let h = Number(hh);
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12; if (h === 0) h = 12;
        return `${months[Number(mo) - 1]} ${Number(d)}, ${y} · ${h}:${mm} ${ampm}`;
    },
```

- [ ] **Step 3: Verify it loads (browser smoke)**

Start the preview server (create `.claude/launch.json` `{ "version":"0.0.1","configurations":[{"name":"healthai","runtimeExecutable":"npm","runtimeArgs":["start"],"port":3000}] }` and a temp `.env` with `AGORA_APP_ID=test`/`AGORA_APP_CERTIFICATE=test`). Navigate to `/patient`, then eval:

```javascript
[typeof API.healthcare.getAvailability, UTILS.formatApptTime('2026-06-16T14:00:00')]
```

Expected: `["function", "Jun 16, 2026 · 2:00 PM"]`.

- [ ] **Step 4: Commit**

```bash
git add frontend/utils/config.js
git commit -m "Add getAvailability API + naive formatApptTime helper"
```

---

## Task 7: Patient page — date+slot form, naive display, prompt

**Files:**
- Modify: `frontend/patient.js` (`renderAppointmentsTab` ~490; `showAppointmentForm` ~513-560; `buildProfileContext` ~747; `startCall` prompt ~676-686; summarize creation ~844)

- [ ] **Step 1: Replace appointment display formatting**

In `frontend/patient.js`:

- Line ~490 (in `renderAppointmentsTab`): replace
  `const dt = new Date(a.date_time).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });`
  with
  `const dt = UTILS.formatApptTime(a.date_time);`

- Line ~747 (in `buildProfileContext`): replace
  `` `${new Date(a.date_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} with ${a.doctor_name || a.doctor_id} (${a.status})` ``
  with
  `` `${UTILS.formatApptTime(a.date_time)} with ${a.doctor_name || a.doctor_id} (${a.status})` ``

- [ ] **Step 2: Rewrite the manual form to date + slot dropdown**

Replace the body of `showAppointmentForm(doctorId)` (the `form.innerHTML` template and the submit handler, ~525-555) so the form has a date input and a slot `<select>` populated from availability. Full replacement for the function body after `if (existingForm) return;`:

```javascript
    const form = document.createElement('div');
    form.className = 'appt-form';
    const todayStr = (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
    form.innerHTML = `
      <label>Preferred date</label>
      <input type="date" id="appt-date" min="${todayStr}" value="${todayStr}" />
      <label>Available time slot</label>
      <select id="appt-slot"><option value="">Select a date first…</option></select>
      <div id="appt-slot-note" style="font-size:11px;color:#9ca3af;margin:4px 0 8px;">8:00 AM–4:00 PM, 30-minute slots.</div>
      <label>Reason</label>
      <textarea id="appt-reason" rows="2" placeholder="e.g. Follow-up on medication"></textarea>
      <div class="form-actions">
        <button class="btn-request-appt" id="appt-submit">Request Appointment</button>
        <button class="btn" id="appt-cancel" style="padding:5px 12px;font-size:11px;">Cancel</button>
      </div>
    `;
    container.prepend(form);

    const dateInput = form.querySelector('#appt-date');
    const slotSelect = form.querySelector('#appt-slot');
    const note = form.querySelector('#appt-slot-note');

    const to12h = (hhmm) => {
      const [h, m] = hhmm.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hr = (h % 12) || 12;
      return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
    };

    async function loadSlots() {
      slotSelect.innerHTML = '<option value="">Loading…</option>';
      try {
        const { available } = await API.healthcare.getAvailability({ doctor_id: doctorId, date: dateInput.value });
        if (!available || available.length === 0) {
          slotSelect.innerHTML = '<option value="">No slots available this day</option>';
          note.textContent = 'No open slots — try another date.';
          return;
        }
        slotSelect.innerHTML = available.map(s => `<option value="${s}">${to12h(s)}</option>`).join('');
        note.textContent = '8:00 AM–4:00 PM, 30-minute slots.';
      } catch (e) {
        slotSelect.innerHTML = '<option value="">Failed to load slots</option>';
        console.error('[appt] availability load failed', e);
      }
    }
    dateInput.addEventListener('change', loadSlots);
    loadSlots();

    form.querySelector('#appt-submit').addEventListener('click', async () => {
      const date = dateInput.value;
      const slot = slotSelect.value;
      const reason = form.querySelector('#appt-reason').value;
      if (!date || !slot) return;
      try {
        await API.healthcare.createAppointment({
          patient_id: selectedProfile.id,
          doctor_id: doctorId,
          date_time: `${date}T${slot}:00`,
          reason
        });
        await renderAppointmentsTab(doctorId);
        await loadDoctorCards();
      } catch (e) {
        // 409/422 (slot just taken or invalid) — refresh availability and tell the user.
        console.error('Failed to create appointment', e);
        note.textContent = 'That slot is no longer available — pick another.';
        await loadSlots();
      }
    });
    form.querySelector('#appt-cancel').addEventListener('click', () => form.remove());
```

(Keep the rest of `showAppointmentForm` — the tab-switching at the top and the `return` guard — unchanged.)

- [ ] **Step 3: Update the call prompt (time wording + booking rules + doctor availability)**

In `startCall`, replace the current-time line (~677-678):

```javascript
      const now = new Date();
      profileContext += `\n\nCurrent date and time: ${now.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })} (Australian time)`;
```

with:

```javascript
      const now = new Date();
      profileContext += `\n\nCurrent date and time (the user's local time): ${now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Treat every appointment time as this same local clock — do not convert timezones.`;
```

Then replace the "Inject available doctors" block (~680-686) with one that also states the booking rules and each doctor's booked slots:

```javascript
      // Inject available doctors + booking rules + each doctor's booked slots so
      // the agent can steer the patient to open times. Authoritative validation
      // happens post-call.
      if (allDoctors.length > 0) {
        profileContext += '\n\nAvailable doctors for appointment booking:\n' + allDoctors.map(d =>
          `- ${d.name} (${d.specialty || 'General'}, ${d.hospital || 'N/A'})`
        ).join('\n');
        profileContext += '\n\nAppointment booking rules: appointments are 30-minute slots from 8:00 AM to 4:00 PM (the last slot starts at 3:30 PM). Only offer times on the hour or half-hour. If the patient asks for a time that is outside 8:00 AM–4:00 PM or already booked (see "Doctor booked slots" below), tell them it is not available and offer that day\'s open times. The request is sent to the doctor after the call ends.';
        profileContext += await buildDoctorBookedBlock();
        profileContext += '\nConfirm the doctor, date/time, and reason verbally. Do not output any tags or special formatting — just speak naturally.';
      }
```

Add this helper near `buildProfileContext` (e.g. right after it, ~756):

```javascript
  // Compact list of each doctor's booked slots for the next ~7 days so the agent
  // can avoid them. Naive wall-clock; no timezone conversion.
  async function buildDoctorBookedBlock() {
    const horizonDays = 7;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const horizon = new Date(today); horizon.setDate(horizon.getDate() + horizonDays);
    const inWindow = (dt) => {
      const m = String(dt).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return false;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return d >= today && d <= horizon;
    };
    const blocks = [];
    for (const d of allDoctors) {
      try {
        const appts = await API.healthcare.listAppointments({ doctor_id: d.id });
        const booked = appts
          .filter(a => a.status !== 'declined' && inWindow(a.date_time))
          .map(a => UTILS.formatApptTime(a.date_time));
        if (booked.length) blocks.push(`- ${d.name}: ${booked.join('; ')}`);
      } catch (_) { /* ignore — best effort */ }
    }
    return blocks.length
      ? '\nDoctor booked slots (next 7 days, already taken — do NOT offer these):\n' + blocks.join('\n')
      : '\nDoctor booked slots (next 7 days): none on file.';
  }
```

- [ ] **Step 4: Make post-call appointment creation resilient to server rejection**

In the summarize `.then` appointment-creation loop (~844), the server may now reject with 409/422. Wrap the existing `await API.healthcare.createAppointment(...)` call so a rejection is logged and skipped rather than aborting the loop. The call is already inside a `try/catch` (line ~833-854) — confirm the `catch` simply logs and continues (it does: `console.error('[stopCall] failed to create appointment:', e);`). No code change needed beyond verifying; add a clarifying comment above the createAppointment call:

```javascript
                // Server is authoritative: it rejects out-of-hours / conflicting
                // slots (422/409). Those throw and are caught below — skip & move on.
```

- [ ] **Step 5: Browser verification**

Start the preview server. Drive `/patient`: select a patient → a doctor → Appointments tab → Request Appointment. Verify via eval/screenshot:
- date input defaults to today; changing date repopulates the slot `<select>` from `/availability` (only free slots; taken slots absent).
- submitting a slot creates the appointment and it renders via `formatApptTime` (e.g. "Jun 16, 2026 · 2:00 PM"), same wall clock regardless of browser timezone.
- Booked slot for that doctor/day no longer appears in the dropdown after creation.

Confirm no console errors (`preview_console_logs` level error).

- [ ] **Step 6: Commit**

```bash
git add frontend/patient.js
git commit -m "Patient: date+slot booking form, naive time display, slot-aware prompt"
```

---

## Task 8: Doctor page — prompt time wording + naive display

**Files:**
- Modify: `frontend/doctor.js` (AI-call prompt time ~490-491; SIP prompt time ~490-491 in `startPostOpCall`; appointment display ~798)

- [ ] **Step 1: Replace appointment display formatting**

In `frontend/doctor.js` line ~798, replace
`const dt = new Date(a.date_time).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });`
with
`const dt = UTILS.formatApptTime(a.date_time);`

- [ ] **Step 2: Replace both current-time prompt lines**

`frontend/doctor.js` has the same `(Australian time)` line in two places — the doctor's own AI call (~490-491) and the SIP `startPostOpCall` (~490-491). Replace BOTH occurrences of:

```javascript
    profileContext += `\n\nCurrent date and time: ${now.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })} (Australian time)`;
```

with:

```javascript
    profileContext += `\n\nCurrent date and time (the user's local time): ${now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Treat every appointment time as this same local clock — do not convert timezones.`;
```

(Use `replace_all` since the two lines are identical. The SIP path already uses the doctor page's `new Date()`, satisfying "SIP uses the doctor's time".)

- [ ] **Step 3: Browser verification**

Start the preview server. Drive `/doctor`: select a doctor → a patient → Appointments tab. Verify appointment times render via `formatApptTime` (wall clock, no tz shift). Confirm no console errors. (The prompt strings are only sent to the agent on a real call — verify by eval that `doctor.js` loaded without error and the Appointments tab shows the new format.)

- [ ] **Step 4: Commit**

```bash
git add frontend/doctor.js
git commit -m "Doctor: naive appointment display + local-time prompt wording (incl. SIP)"
```

---

## Task 9: Full verification & deploy

**Files:** none (verification only)

- [ ] **Step 1: Run the whole backend suite**

Run: `npm test`
Expected: PASS — all suites (slots, healthcare incl. 422/409/availability/naive-seed, summarize incl. validation) green.

- [ ] **Step 2: End-to-end browser pass**

With the preview server running, verify on `/patient`:
- Out-of-hours can't be chosen (dropdown only offers 08:00–15:30).
- Two requests for the same doctor+slot: second attempt shows "no longer available" and the dropdown drops it.
- Appointment list shows naive wall-clock consistently.

And on `/doctor`: Appointments tab shows the same wall clock; confirm/decline still works.

- [ ] **Step 3: Clean up temp preview files**

```bash
rm -f .env && rm -rf .claude
```

- [ ] **Step 4: Push (auto-deploys to Railway)**

```bash
git push origin HEAD:main
```

Note: per repo convention, pushing to `main` auto-deploys to Railway. On the persistent Railway DB, appointments use `INSERT OR REPLACE` so seeded rows refresh; if you want the new relative dates to take effect immediately, delete `healthcare.db` on Railway and let it re-seed.

---

## Self-Review notes

- **Spec coverage:** slots 08:00–16:00/30-min (Task 1), requested+confirmed occupy (Task 1), manual date+slot form (Task 7), createAppointment 422/409 (Task 2), availability endpoint (Task 3), post-call validation drops out-of-hours/conflict/dupes (Task 4), operator-local-time prompt + SIP doctor time (Tasks 7, 8), per-doctor booked slots injected (Task 7), naive storage + display everywhere (Tasks 2, 6, 7, 8), relative seed dates on valid slots (Task 5), tests for slots/controller/summarize (Tasks 1–5). All spec sections map to a task.
- **Naming consistency:** `parseNaive/normalizeNaive/isValidSlot/enumerateSlots/getBookedSlots/getAvailableSlots/findConflict` used identically across module, controller, and tests. `UTILS.formatApptTime` and `API.healthcare.getAvailability` referenced consistently in both frontend files.
- **No placeholders:** every step ships complete code or an exact command.
