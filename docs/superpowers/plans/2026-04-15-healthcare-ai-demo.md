# Healthcare AI Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a healthcare AI voice demo on top of the Agora ConvoAI Web Template with patient/doctor pages, real-time SSE summary feed, and SQLite persistence.

**Architecture:** Express backend extended with SQLite (better-sqlite3) and SSE for real-time doctor feed. Two frontend pages (/patient, /doctor) in vanilla JS following the existing IIFE pattern. Agora agent start extended to accept `promptType` + `profileContext` for personalised conversations.

**Tech Stack:** Node.js/Express, better-sqlite3, SSE (native), Agora RTC/RTM SDK, vanilla JS, Jest + Supertest for backend tests.

---

## File Map

**New backend files:**
- `backend/db/database.js` — SQLite connection + schema init
- `backend/db/seed.js` — demo profile + care plan seeder
- `backend/sse.js` — SSE client manager
- `backend/controllers/healthcareController.js` — profiles, summaries, care plans, SSE handler
- `backend/routes/healthcare_routes.js` — /api/healthcare/* routes

**Modified backend files:**
- `backend/server.js` — add /events, /api/healthcare, /patient, /doctor routes; guard app.listen
- `backend/controllers/agoraController.js` — add buildSystemPrompt, accept promptType + profileContext
- `.env.example` — add PROMPT_PATIENT, PROMPT_POST_OP_CARE, PROMPT_DOCTOR_ASSISTANT

**New frontend files:**
- `frontend/shared/theme.css` — teal/mint CSS variable overrides
- `frontend/shared/profile-modal.js` — shared expandable profile modal
- `frontend/patient.html` — patient page shell
- `frontend/patient.js` — patient page IIFE logic
- `frontend/doctor.html` — doctor page shell
- `frontend/doctor.js` — doctor page IIFE logic

**Modified frontend files:**
- `frontend/utils/config.js` — add API.healthcare methods
- `frontend/index.html` — update to landing page

**New test files:**
- `tests/setup.js` — set NODE_ENV=test
- `tests/db/database.test.js`
- `tests/db/seed.test.js`
- `tests/sse.test.js`
- `tests/healthcare.test.js`
- `tests/agoraController.test.js`
- `tests/server.test.js`
- `jest.config.js`

---

### Task 1: Install dependencies and configure test framework

**Files:**
- Modify: `package.json`
- Create: `jest.config.js`
- Create: `tests/setup.js`

- [ ] **Step 1: Install runtime and dev dependencies**

```bash
cd /Users/liangzheng/Desktop/ClaudeCodeDemo/Agora_ConvoAI_Web_Template
npm install better-sqlite3
npm install --save-dev jest supertest
```

Expected: both complete without error. `better-sqlite3` is a native module — requires Xcode CLI tools on macOS (`xcode-select --install` if it fails).

- [ ] **Step 2: Create jest.config.js**

```js
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup.js']
};
```

- [ ] **Step 3: Create tests/setup.js**

```js
// tests/setup.js
process.env.NODE_ENV = 'test';
```

- [ ] **Step 4: Update package.json test script**

In `package.json`, change:
```json
"test": "echo 'No tests specified'"
```
to:
```json
"test": "jest"
```

- [ ] **Step 5: Verify jest runs**

```bash
npm test
```

Expected output:
```
No tests found, exiting with code 1
```
(No tests exist yet — that's expected. The important thing is jest is found and configured.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json jest.config.js tests/setup.js
git commit -m "chore: add better-sqlite3, jest, supertest; configure test framework"
```

---

### Task 2: Database schema

**Files:**
- Create: `backend/db/database.js`
- Create: `tests/db/database.test.js`

- [ ] **Step 1: Create tests/db/ directory and write failing test**

```bash
mkdir -p tests/db
```

```js
// tests/db/database.test.js
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
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test -- tests/db/database.test.js
```

Expected: `Cannot find module '../../backend/db/database'`

- [ ] **Step 3: Create backend/db/database.js**

```bash
mkdir -p backend/db
```

```js
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
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npm test -- tests/db/database.test.js
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/db/database.js tests/db/database.test.js
git commit -m "feat: add SQLite database schema (createDb)"
```

---

### Task 3: Seed data

**Files:**
- Create: `backend/db/seed.js`
- Create: `tests/db/seed.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/db/seed.test.js
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

  test('seeds 2 doctors', () => {
    const rows = db.prepare("SELECT * FROM profiles WHERE role='doctor'").all();
    expect(rows).toHaveLength(2);
  });

  test('patient-1 is Sarah Chen assigned to doctor-1', () => {
    const row = db.prepare("SELECT * FROM profiles WHERE id='patient-1'").get();
    expect(row.name).toBe('Sarah Chen');
    expect(row.age).toBe(34);
    expect(row.assigned_doctor).toBe('doctor-1');
  });

  test('patient-2 has a pending-review care plan', () => {
    const row = db.prepare("SELECT * FROM care_plans WHERE patient_id='patient-2'").get();
    expect(row).toBeTruthy();
    expect(row.status).toBe('pending-review');
  });

  test('seed is idempotent — running twice keeps 4 profiles', () => {
    seed(db);
    const rows = db.prepare('SELECT * FROM profiles').all();
    expect(rows).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npm test -- tests/db/seed.test.js
```

Expected: `Cannot find module '../../backend/db/seed'`

- [ ] **Step 3: Create backend/db/seed.js**

```js
// backend/db/seed.js
const { randomUUID } = require('crypto');

const PROFILES = [
  {
    id: 'patient-1', role: 'patient', name: 'Sarah Chen', avatar: 'SC', age: 34,
    specialty: null, hospital: null,
    condition: 'Hypertension, mild anxiety',
    medications: JSON.stringify(['Lisinopril 10mg', 'Propranolol 20mg']),
    next_appointment: 'Apr 18 — Dr. James Williams',
    assigned_doctor: 'doctor-1',
    phone_number: '+61 400 000 001',
    extra_details: JSON.stringify({
      medical_history: 'Hypertension diagnosed 2021. Anxiety disorder diagnosed 2022.',
      allergies: 'Penicillin',
      blood_type: 'A+',
      emergency_contact: 'Michael Chen (husband) — +61 400 111 222'
    })
  },
  {
    id: 'patient-2', role: 'patient', name: 'Marcus Johnson', avatar: 'MJ', age: 52,
    specialty: null, hospital: null,
    condition: 'Post-knee-surgery recovery',
    medications: JSON.stringify(['Tramadol 50mg', 'Aspirin 100mg']),
    next_appointment: 'Apr 20 — Dr. Priya Patel',
    assigned_doctor: 'doctor-2',
    phone_number: '+61 400 000 002',
    extra_details: JSON.stringify({
      medical_history: 'Right knee replacement Apr 10 2026. Type 2 diabetes (controlled).',
      allergies: 'None known',
      blood_type: 'O+',
      emergency_contact: 'Linda Johnson (wife) — +61 400 333 444'
    })
  },
  {
    id: 'doctor-1', role: 'doctor', name: 'Dr. James Williams', avatar: 'JW', age: null,
    specialty: 'Cardiologist', hospital: 'Sydney General Hospital',
    condition: null, medications: null, next_appointment: null, assigned_doctor: null,
    phone_number: null,
    extra_details: JSON.stringify({
      experience: '12 years',
      languages: ['English', 'Mandarin'],
      qualifications: 'MBBS (Sydney), FRACP (Cardiology)',
      bio: 'Specialises in cardiovascular disease prevention and hypertension management.',
      patients: ['Sarah Chen']
    })
  },
  {
    id: 'doctor-2', role: 'doctor', name: 'Dr. Priya Patel', avatar: 'PP', age: null,
    specialty: 'Orthopaedic Surgeon', hospital: 'Sydney General Hospital',
    condition: null, medications: null, next_appointment: null, assigned_doctor: null,
    phone_number: null,
    extra_details: JSON.stringify({
      experience: '9 years',
      languages: ['English', 'Hindi'],
      qualifications: 'MBBS (Melbourne), FRACS (Orthopaedics)',
      bio: 'Specialises in joint replacement surgery and post-operative rehabilitation.',
      patients: ['Marcus Johnson']
    })
  }
];

const SAMPLE_CARE_PLAN = {
  id: 'plan-1',
  patient_id: 'patient-2',
  plan_text: JSON.stringify([
    { days: 'Day 1–3', instructions: 'Rest, elevate leg, ice pack 20 min every 2 hours. Tramadol 50mg every 6 hours as needed.' },
    { days: 'Day 4–7', instructions: 'Gentle range-of-motion exercises. Walking 10–15 min twice daily. Aspirin 100mg daily.' },
    { days: 'Day 8–14', instructions: 'Increase walking to 30 min. Physiotherapy begins. Reduce Tramadol as pain permits.' },
    { days: 'Day 14+', instructions: 'Follow-up appointment. Assess wound healing. Continue physiotherapy.' }
  ]),
  status: 'pending-review',
  doctor_notes: '',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

function seed(db) {
  const insertProfile = db.prepare(`
    INSERT OR IGNORE INTO profiles
    (id, role, name, avatar, age, specialty, hospital, condition, medications,
     next_appointment, assigned_doctor, phone_number, extra_details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPlan = db.prepare(`
    INSERT OR IGNORE INTO care_plans
    (id, patient_id, plan_text, status, doctor_notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const p of PROFILES) {
      insertProfile.run(
        p.id, p.role, p.name, p.avatar, p.age, p.specialty, p.hospital,
        p.condition, p.medications, p.next_appointment, p.assigned_doctor,
        p.phone_number, p.extra_details
      );
    }
    insertPlan.run(
      SAMPLE_CARE_PLAN.id, SAMPLE_CARE_PLAN.patient_id, SAMPLE_CARE_PLAN.plan_text,
      SAMPLE_CARE_PLAN.status, SAMPLE_CARE_PLAN.doctor_notes,
      SAMPLE_CARE_PLAN.created_at, SAMPLE_CARE_PLAN.updated_at
    );
  })();
}

// Direct execution: node backend/db/seed.js
if (require.main === module) {
  const path = require('path');
  const { createDb } = require('./database');
  const db = createDb(path.join(__dirname, 'healthcare.db'));
  seed(db);
  console.log('Demo data seeded.');
  db.close();
}

module.exports = { seed };
```

- [ ] **Step 4: Run — verify passes**

```bash
npm test -- tests/db/seed.test.js
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/db/seed.js tests/db/seed.test.js
git commit -m "feat: add demo seed data (4 profiles, 1 care plan)"
```

---

### Task 4: SSE manager

**Files:**
- Create: `backend/sse.js`
- Create: `tests/sse.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/sse.test.js
const sse = require('../backend/sse');

function makeMockRes() {
  const written = [];
  let closeHandler = null;
  return {
    setHeader: () => {},
    flushHeaders: () => {},
    write: (data) => { written.push(data); },
    on: (event, fn) => { if (event === 'close') closeHandler = fn; },
    _written: written,
    _close: () => { if (closeHandler) closeHandler(); }
  };
}

describe('SSE manager', () => {
  test('sets SSE headers when client connects', () => {
    const res = { ...makeMockRes(), _headers: {} };
    const headers = {};
    res.setHeader = (k, v) => { headers[k] = v; };
    sse.addClient(res);
    expect(headers['Content-Type']).toBe('text/event-stream');
    expect(headers['Cache-Control']).toBe('no-cache');
    res._close();
  });

  test('broadcast sends formatted data to connected clients', () => {
    const res = makeMockRes();
    sse.addClient(res);
    sse.broadcast('new_summary', { id: 'sum-1' });
    expect(res._written[0]).toContain('new_summary');
    expect(res._written[0]).toContain('sum-1');
    expect(res._written[0]).toMatch(/^data: .+\n\n$/);
    res._close();
  });

  test('removes client on connection close', () => {
    const res = makeMockRes();
    const before = sse.getClientCount();
    sse.addClient(res);
    expect(sse.getClientCount()).toBe(before + 1);
    res._close();
    expect(sse.getClientCount()).toBe(before);
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npm test -- tests/sse.test.js
```

Expected: `Cannot find module '../backend/sse'`

- [ ] **Step 3: Create backend/sse.js**

```js
// backend/sse.js
const clients = new Set();

function addClient(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

function broadcast(eventType, payload) {
  const data = JSON.stringify({ type: eventType, ...payload });
  for (const client of clients) {
    client.write(`data: ${data}\n\n`);
  }
}

function getClientCount() {
  return clients.size;
}

module.exports = { addClient, broadcast, getClientCount };
```

- [ ] **Step 4: Run — verify passes**

```bash
npm test -- tests/sse.test.js
```

Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/sse.js tests/sse.test.js
git commit -m "feat: add SSE client manager"
```

---

### Task 5: Healthcare controller — profiles

**Files:**
- Create: `backend/controllers/healthcareController.js`
- Create: `backend/routes/healthcare_routes.js`
- Create: `tests/healthcare.test.js`

- [ ] **Step 1: Write failing tests for profile endpoints**

```js
// tests/healthcare.test.js
const request = require('supertest');
const express = require('express');
const { createDb } = require('../backend/db/database');
const { seed } = require('../backend/db/seed');
const { makeHealthcareController } = require('../backend/controllers/healthcareController');
const sse = require('../backend/sse');

function makeApp() {
  const db = createDb(':memory:');
  seed(db);
  const ctrl = makeHealthcareController(db, sse);
  const app = express();
  app.use(express.json());
  app.get('/api/healthcare/profiles/:id', ctrl.getProfile);
  app.get('/api/healthcare/profiles', ctrl.listProfiles);
  app.get('/api/healthcare/summaries', ctrl.listSummaries);
  app.post('/api/healthcare/summaries', ctrl.createSummary);
  app.get('/api/healthcare/care-plans/:patientId', ctrl.getCarePlan);
  app.put('/api/healthcare/care-plans/:id', ctrl.updateCarePlan);
  return app;
}

describe('GET /api/healthcare/profiles/:id', () => {
  const app = makeApp();

  test('returns patient-1 with parsed JSON fields', async () => {
    const res = await request(app).get('/api/healthcare/profiles/patient-1');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Sarah Chen');
    expect(Array.isArray(res.body.medications)).toBe(true);
    expect(typeof res.body.extra_details).toBe('object');
  });

  test('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/healthcare/profiles/unknown');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/healthcare/profiles', () => {
  const app = makeApp();

  test('returns all 4 profiles when no role filter', async () => {
    const res = await request(app).get('/api/healthcare/profiles');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
  });

  test('filters by role=patient returns 2', async () => {
    const res = await request(app).get('/api/healthcare/profiles?role=patient');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every(p => p.role === 'patient')).toBe(true);
  });

  test('filters by role=doctor returns 2', async () => {
    const res = await request(app).get('/api/healthcare/profiles?role=doctor');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npm test -- tests/healthcare.test.js
```

Expected: `Cannot find module '../backend/controllers/healthcareController'`

- [ ] **Step 3: Create backend/controllers/healthcareController.js (profiles only)**

```js
// backend/controllers/healthcareController.js
const { randomUUID } = require('crypto');

function parseJsonFields(row, fields) {
  fields.forEach(f => {
    if (row[f]) {
      try { row[f] = JSON.parse(row[f]); } catch (_) {}
    }
  });
  return row;
}

function makeHealthcareController(db, sse) {
  function getProfile(req, res) {
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    parseJsonFields(profile, ['medications', 'extra_details']);
    res.json(profile);
  }

  function listProfiles(req, res) {
    const { role } = req.query;
    const rows = role
      ? db.prepare('SELECT * FROM profiles WHERE role = ?').all(role)
      : db.prepare('SELECT * FROM profiles').all();
    rows.forEach(r => parseJsonFields(r, ['medications', 'extra_details']));
    res.json(rows);
  }

  function listSummaries(req, res) {
    const rows = db.prepare('SELECT * FROM call_summaries ORDER BY created_at DESC').all();
    rows.forEach(r => parseJsonFields(r, ['symptoms', 'vitals_mentioned', 'medications_discussed']));
    res.json(rows);
  }

  function createSummary(req, res) {
    const {
      patient_id, call_type, chief_complaint, symptoms, vitals_mentioned,
      medications_discussed, ai_recommendation, urgency, transcript_excerpt, suggested_action
    } = req.body;

    if (!patient_id || !call_type) {
      return res.status(400).json({ error: 'patient_id and call_type are required' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO call_summaries
      (id, patient_id, call_type, chief_complaint, symptoms, vitals_mentioned,
       medications_discussed, ai_recommendation, urgency, transcript_excerpt, suggested_action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, patient_id, call_type, chief_complaint || '',
      JSON.stringify(symptoms || []),
      JSON.stringify(vitals_mentioned || {}),
      JSON.stringify(medications_discussed || []),
      ai_recommendation || '', urgency || 'low',
      transcript_excerpt || '', suggested_action || '', now
    );

    const summary = db.prepare('SELECT * FROM call_summaries WHERE id = ?').get(id);
    parseJsonFields(summary, ['symptoms', 'vitals_mentioned', 'medications_discussed']);

    const patient = db.prepare('SELECT name FROM profiles WHERE id = ?').get(patient_id);
    sse.broadcast('new_summary', { summary: { ...summary, patient_name: patient?.name || 'Unknown' } });

    res.status(201).json(summary);
  }

  function getCarePlan(req, res) {
    const plan = db.prepare('SELECT * FROM care_plans WHERE patient_id = ?').get(req.params.patientId);
    if (!plan) return res.status(404).json({ error: 'Care plan not found' });
    parseJsonFields(plan, ['plan_text']);
    res.json(plan);
  }

  function updateCarePlan(req, res) {
    const { id } = req.params;
    const { status, doctor_notes } = req.body;
    const plan = db.prepare('SELECT * FROM care_plans WHERE id = ?').get(id);
    if (!plan) return res.status(404).json({ error: 'Care plan not found' });

    db.prepare('UPDATE care_plans SET status = ?, doctor_notes = ?, updated_at = ? WHERE id = ?')
      .run(status || plan.status, doctor_notes !== undefined ? doctor_notes : plan.doctor_notes, new Date().toISOString(), id);

    const updated = db.prepare('SELECT * FROM care_plans WHERE id = ?').get(id);
    parseJsonFields(updated, ['plan_text']);
    sse.broadcast('plan_updated', { plan: updated });
    res.json(updated);
  }

  function sseStream(req, res) {
    sse.addClient(res);
  }

  return { getProfile, listProfiles, listSummaries, createSummary, getCarePlan, updateCarePlan, sseStream };
}

module.exports = { makeHealthcareController };
```

- [ ] **Step 4: Run profile tests — verify passes**

```bash
npm test -- tests/healthcare.test.js
```

Expected: `5 passed` (profile tests only so far)

- [ ] **Step 5: Create backend/routes/healthcare_routes.js**

```js
// backend/routes/healthcare_routes.js
const express = require('express');
const path = require('path');
const { makeHealthcareController } = require('../controllers/healthcareController');
const { createDb } = require('../db/database');
const { seed } = require('../db/seed');
const sse = require('../sse');

const dbPath = process.env.NODE_ENV === 'test'
  ? ':memory:'
  : path.join(__dirname, '../db/healthcare.db');

const db = createDb(dbPath);
seed(db);

const controller = makeHealthcareController(db, sse);
const router = express.Router();

router.get('/profiles/:id', controller.getProfile);
router.get('/profiles', controller.listProfiles);
router.get('/summaries', controller.listSummaries);
router.post('/summaries', controller.createSummary);
router.get('/care-plans/:patientId', controller.getCarePlan);
router.put('/care-plans/:id', controller.updateCarePlan);

module.exports = { router, controller };
```

- [ ] **Step 6: Commit**

```bash
git add backend/controllers/healthcareController.js backend/routes/healthcare_routes.js tests/healthcare.test.js
git commit -m "feat: add healthcare controller (profiles) and routes"
```

---

### Task 6: Healthcare controller — summaries and care plans tests

**Files:**
- Modify: `tests/healthcare.test.js` (append new describes)

- [ ] **Step 1: Append summary + care plan tests to tests/healthcare.test.js**

Add after the existing `describe` blocks:

```js
describe('POST /api/healthcare/summaries', () => {
  const app = makeApp();

  test('creates a summary and returns 201', async () => {
    const res = await request(app).post('/api/healthcare/summaries').send({
      patient_id: 'patient-1',
      call_type: 'pre-session',
      chief_complaint: 'Headache',
      symptoms: ['headache', 'nausea'],
      vitals_mentioned: { bp: '128/82' },
      medications_discussed: [],
      ai_recommendation: 'Monitor BP',
      urgency: 'low',
      transcript_excerpt: 'Patient reported headache for 3 days.',
      suggested_action: 'Review at next appointment'
    });
    expect(res.status).toBe(201);
    expect(res.body.patient_id).toBe('patient-1');
    expect(res.body.call_type).toBe('pre-session');
    expect(Array.isArray(res.body.symptoms)).toBe(true);
  });

  test('returns 400 when patient_id missing', async () => {
    const res = await request(app).post('/api/healthcare/summaries').send({ call_type: 'pre-session' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when call_type missing', async () => {
    const res = await request(app).post('/api/healthcare/summaries').send({ patient_id: 'patient-1' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/healthcare/summaries', () => {
  const app = makeApp();

  test('returns empty array when no summaries', async () => {
    const res = await request(app).get('/api/healthcare/summaries');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/healthcare/care-plans/:patientId', () => {
  const app = makeApp();

  test('returns care plan for patient-2', async () => {
    const res = await request(app).get('/api/healthcare/care-plans/patient-2');
    expect(res.status).toBe(200);
    expect(res.body.patient_id).toBe('patient-2');
    expect(Array.isArray(res.body.plan_text)).toBe(true);
  });

  test('returns 404 for patient with no care plan', async () => {
    const res = await request(app).get('/api/healthcare/care-plans/patient-1');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/healthcare/care-plans/:id', () => {
  const app = makeApp();

  test('approves care plan and updates status', async () => {
    const res = await request(app)
      .put('/api/healthcare/care-plans/plan-1')
      .send({ status: 'approved', doctor_notes: 'Looks good.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.doctor_notes).toBe('Looks good.');
  });

  test('returns 404 for unknown plan id', async () => {
    const res = await request(app).put('/api/healthcare/care-plans/bad-id').send({ status: 'approved' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run — verify all healthcare tests pass**

```bash
npm test -- tests/healthcare.test.js
```

Expected: `13 passed`

- [ ] **Step 3: Commit**

```bash
git add tests/healthcare.test.js
git commit -m "test: add summary and care plan tests (all passing)"
```

---

### Task 7: Extend agoraController with promptType + profileContext

**Files:**
- Modify: `backend/controllers/agoraController.js`
- Create: `tests/agoraController.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/agoraController.test.js
const { buildSystemPrompt } = require('../backend/controllers/agoraController');

describe('buildSystemPrompt', () => {
  const origEnv = process.env;
  beforeEach(() => { process.env = { ...origEnv }; });
  afterAll(() => { process.env = origEnv; });

  test('returns PROMPT_PATIENT for type patient', () => {
    process.env.PROMPT_PATIENT = 'Patient prompt';
    expect(buildSystemPrompt('patient', '')).toBe('Patient prompt');
  });

  test('returns PROMPT_POST_OP_CARE for type post-op', () => {
    process.env.PROMPT_POST_OP_CARE = 'Post-op prompt';
    expect(buildSystemPrompt('post-op', '')).toBe('Post-op prompt');
  });

  test('returns PROMPT_DOCTOR_ASSISTANT for type doctor', () => {
    process.env.PROMPT_DOCTOR_ASSISTANT = 'Doctor prompt';
    expect(buildSystemPrompt('doctor', '')).toBe('Doctor prompt');
  });

  test('prepends profileContext before template', () => {
    process.env.PROMPT_PATIENT = 'Base prompt';
    const result = buildSystemPrompt('patient', 'Patient: Sarah Chen');
    expect(result).toBe('Patient: Sarah Chen\n\nBase prompt');
  });

  test('falls back to LLM_SYSTEM_PROMPT if PROMPT_PATIENT not set', () => {
    delete process.env.PROMPT_PATIENT;
    process.env.LLM_SYSTEM_PROMPT = 'Legacy prompt';
    expect(buildSystemPrompt('patient', '')).toBe('Legacy prompt');
  });

  test('unknown type falls back to patient template', () => {
    process.env.PROMPT_PATIENT = 'Patient prompt';
    expect(buildSystemPrompt('unknown', '')).toBe('Patient prompt');
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npm test -- tests/agoraController.test.js
```

Expected: `buildSystemPrompt is not a function`

- [ ] **Step 3: Add buildSystemPrompt to agoraController.js and export it**

In `backend/controllers/agoraController.js`, add this function before the `module.exports`:

```js
function buildSystemPrompt(promptType, profileContext) {
  const templates = {
    patient: process.env.PROMPT_PATIENT || process.env.LLM_SYSTEM_PROMPT || 'You are a helpful medical AI assistant.',
    'post-op': process.env.PROMPT_POST_OP_CARE || 'You are an AI following up with a patient after their procedure.',
    doctor: process.env.PROMPT_DOCTOR_ASSISTANT || 'You are an AI clinical assistant for a doctor.'
  };
  const template = templates[promptType] || templates.patient;
  return profileContext ? `${profileContext}\n\n${template}` : template;
}
```

Update `module.exports` at the bottom:
```js
module.exports = {
  getChannelInfo,
  startConversation,
  stopConversation,
  buildSystemPrompt
};
```

- [ ] **Step 4: Update startConversation to use buildSystemPrompt**

In `startConversation`, find this line:
```js
const { channel, agentName, remoteUid: userUid, voiceId } = req.body;
```
Replace with:
```js
const { channel, agentName, remoteUid: userUid, voiceId, promptType, profileContext, greetingMessage } = req.body;
```

Find:
```js
const defaultSystemPrompt = process.env.LLM_SYSTEM_PROMPT || "You are a friendly AI companion";
```
Replace with:
```js
const defaultSystemPrompt = buildSystemPrompt(promptType || 'patient', profileContext || '');
```

Find:
```js
greeting_message: "Hello there! I'm your AI assistant. How can I help you today?",
```
Replace with:
```js
greeting_message: greetingMessage || "Hello! I'm your AI medical assistant. How can I help you today?",
```

- [ ] **Step 5: Run — verify passes**

```bash
npm test -- tests/agoraController.test.js
```

Expected: `6 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/controllers/agoraController.js tests/agoraController.test.js
git commit -m "feat: extend agoraController with buildSystemPrompt, promptType, profileContext"
```

---

### Task 8: Update server.js

**Files:**
- Modify: `backend/server.js`
- Create: `tests/server.test.js`
- Create: `frontend/patient.html` (stub — just enough for route test)
- Create: `frontend/doctor.html` (stub)

- [ ] **Step 1: Create stub HTML files so route tests can pass**

```html
<!-- frontend/patient.html -->
<!doctype html><html><head><title>Patient</title></head><body>patient</body></html>
```

```html
<!-- frontend/doctor.html -->
<!doctype html><html><head><title>Doctor</title></head><body>doctor</body></html>
```

- [ ] **Step 2: Write failing server tests**

```js
// tests/server.test.js
const request = require('supertest');
const app = require('../backend/server');

describe('server routes', () => {
  test('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
  });

  test('GET /patient returns HTML', async () => {
    const res = await request(app).get('/patient');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  test('GET /doctor returns HTML', async () => {
    const res = await request(app).get('/doctor');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  test('GET /api/healthcare/profiles?role=patient returns patients', async () => {
    const res = await request(app).get('/api/healthcare/profiles?role=patient');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('GET /api/healthcare/summaries returns array', async () => {
    const res = await request(app).get('/api/healthcare/summaries');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

- [ ] **Step 3: Run — verify fail**

```bash
npm test -- tests/server.test.js
```

Expected: tests fail (routes don't exist yet)

- [ ] **Step 4: Update backend/server.js**

Replace the entire contents of `backend/server.js` with:

```js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const agoraRoutes = require('./routes/agora_routes');
const { router: healthcareRouter } = require('./routes/healthcare_routes');
const { addClient } = require('./sse');
const basicAuth = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// IP Whitelist middleware (optional)
const allowedIPs = process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',') : [];
if (allowedIPs.length > 0) {
  app.use((req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    if (!allowedIPs.includes(clientIP)) {
      return res.status(403).json({ error: 'Access denied from this IP address' });
    }
    next();
  });
}

// Health check (no auth)
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// SSE endpoint — must be BEFORE basicAuth so EventSource can connect without auth headers
app.get('/events', (req, res) => addClient(res));

// Static files
app.use(express.static(path.join(__dirname, '../frontend'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
    else if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
  }
}));
app.use('/src', express.static(path.join(__dirname, '../src')));
app.use('/lib', express.static(path.join(__dirname, '../node_modules'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
  }
}));

// Auth on all /api routes
app.use('/api', basicAuth);
app.use('/api/agora', agoraRoutes);
app.use('/api/healthcare', healthcareRouter);

// Helper: serve an HTML file with injected auth credentials
function serveHtml(filePath, res) {
  let html = fs.readFileSync(filePath, 'utf8');
  const authScript = `<script>
    window.APP_AUTH_USERNAME = ${JSON.stringify(process.env.AUTH_USERNAME || '')};
    window.APP_AUTH_PASSWORD = ${JSON.stringify(process.env.AUTH_PASSWORD || '')};
  </script>`;
  html = html.replace('</head>', `${authScript}</head>`);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}

app.get('/patient', (req, res) => {
  serveHtml(path.join(__dirname, '../frontend/patient.html'), res);
});

app.get('/doctor', (req, res) => {
  serveHtml(path.join(__dirname, '../frontend/doctor.html'), res);
});

app.get('/', basicAuth, (req, res) => {
  serveHtml(path.join(__dirname, '../frontend/index.html'), res);
});

// Only start listening when run directly (not during tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Patient page: http://localhost:${PORT}/patient`);
    console.log(`Doctor page:  http://localhost:${PORT}/doctor`);
  });
}

module.exports = app;
```

- [ ] **Step 5: Run — verify passes**

```bash
npm test -- tests/server.test.js
```

Expected: `5 passed`

- [ ] **Step 6: Run all tests to make sure nothing broke**

```bash
npm test
```

Expected: all previous tests still pass

- [ ] **Step 7: Add healthcare.db to .gitignore**

Open `.gitignore` (create if it doesn't exist) and add:
```
backend/db/healthcare.db
```

- [ ] **Step 8: Commit**

```bash
git add backend/server.js frontend/patient.html frontend/doctor.html tests/server.test.js .gitignore
git commit -m "feat: update server.js with /patient, /doctor, /events, /api/healthcare routes"
```

---

### Task 9: Update .env.example and frontend/utils/config.js

**Files:**
- Modify: `.env.example`
- Modify: `frontend/utils/config.js`

- [ ] **Step 1: Add prompt variables to .env.example**

Open `.env.example` and append:

```
# Healthcare AI Demo — System Prompts
PROMPT_PATIENT="You are an AI medical assistant for a clinic. You are speaking with {name}, age {age}. Current conditions: {condition}. Current medications: {medications}. Next appointment: {next_appointment} with {assigned_doctor}.\n\nGreet the patient warmly by name and ask what brings them in. Identify their intent: (1) pre-session — gather symptoms before upcoming appointment, (2) condition check — assess current health concern and recommend urgency, (3) post-session — answer questions about medications dosage or recovery. Adapt to the identified intent. Be empathetic and professional. Do not diagnose definitively.\n\nAt the END of the call output a JSON summary enclosed in <summary></summary> tags: {\"call_type\":\"pre-session|condition-check|post-session\",\"chief_complaint\":\"\",\"symptoms\":[],\"vitals_mentioned\":{},\"medications_discussed\":[],\"ai_recommendation\":\"\",\"urgency\":\"low|medium|high\",\"transcript_excerpt\":\"\",\"suggested_action\":\"\"}"

PROMPT_POST_OP_CARE="You are an AI following up with a patient after their recent procedure. Care plan: {care_plan}. Check how they are feeling, pain levels (1-10), whether they are following the care plan, medication adherence, and any unexpected symptoms. Be warm, encouraging, and reassuring. Flag anything concerning for the doctor to review."

PROMPT_DOCTOR_ASSISTANT="You are an AI clinical assistant. You are speaking with {name}, {specialty} at {hospital}. Answer medical questions concisely and accurately — drug interactions, treatment protocols, dosage guidelines, differential diagnoses. Be direct and professional. Cite your reasoning."
```

- [ ] **Step 2: Add healthcare API methods to frontend/utils/config.js**

In `frontend/utils/config.js`, add a `healthcare` key to the `API` object, after the `agora` block:

```js
    healthcare: {
      getProfile: (id) =>
        API.request(`/healthcare/profiles/${id}`),
      listProfiles: (role) =>
        API.request(`/healthcare/profiles${role ? '?role=' + role : ''}`),
      listSummaries: () =>
        API.request('/healthcare/summaries'),
      createSummary: (data) =>
        API.request('/healthcare/summaries', { method: 'POST', body: JSON.stringify(data) }),
      getCarePlan: (patientId) =>
        API.request(`/healthcare/care-plans/${patientId}`),
      updateCarePlan: (id, data) =>
        API.request(`/healthcare/care-plans/${id}`, { method: 'PUT', body: JSON.stringify(data) })
    }
```

- [ ] **Step 3: Commit**

```bash
git add .env.example frontend/utils/config.js
git commit -m "feat: add healthcare API methods to config.js and prompt vars to .env.example"
```

---

### Task 10: Healthcare theme CSS

**Files:**
- Create: `frontend/shared/theme.css`

- [ ] **Step 1: Create frontend/shared/ directory and theme.css**

```bash
mkdir -p frontend/shared
```

```css
/* frontend/shared/theme.css — teal/mint healthcare theme */
:root {
  --bg: #f0fdfb;
  --card: #ffffff;
  --accent: #0d9488;
  --accent-dark: #0f766e;
  --accent-light: #e0faf5;
  --accent-border: #99f6e4;
  --muted: #6b7280;
  --text: #1f2937;
  --danger: #ef4444;
  --warning: #f59e0b;
  --success: #10b981;
  --shadow: 0 4px 16px rgba(13, 148, 136, 0.08);
  --radius: 12px;
}

body {
  background: var(--bg);
  color: var(--text);
}

/* Override primary button accent */
.btn.primary, .btn-primary {
  background: var(--accent);
  border-color: transparent;
  color: #fff;
}
.btn.primary:hover:not(:disabled), .btn-primary:hover:not(:disabled) {
  background: var(--accent-dark);
}

/* Page layout */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: var(--accent);
  color: white;
}
.page-header .logo {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
.switch-user-btn {
  background: rgba(255,255,255,0.2);
  border: 1px solid rgba(255,255,255,0.4);
  color: white;
  padding: 6px 14px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: background 0.2s;
}
.switch-user-btn:hover { background: rgba(255,255,255,0.3); }

/* Profile selection screen */
.profile-selection {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}
.selection-container {
  text-align: center;
  padding: 40px;
}
.selection-container h1 {
  color: var(--accent);
  font-size: 32px;
  font-weight: 700;
  margin-bottom: 8px;
}
.selection-container .subtitle {
  color: var(--muted);
  font-size: 16px;
  margin-bottom: 32px;
}
.profile-cards {
  display: flex;
  gap: 20px;
  justify-content: center;
  flex-wrap: wrap;
}
.profile-select-card {
  background: white;
  border: 2px solid var(--accent-border);
  border-radius: 16px;
  padding: 28px 32px;
  cursor: pointer;
  width: 200px;
  transition: all 0.2s;
  box-shadow: var(--shadow);
  text-align: center;
}
.profile-select-card:hover {
  border-color: var(--accent);
  transform: translateY(-3px);
  box-shadow: 0 8px 24px rgba(13,148,136,0.15);
}
.profile-select-card .avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--accent-light);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 700;
  margin: 0 auto 12px;
}
.profile-select-card .card-name {
  font-weight: 600;
  font-size: 15px;
  color: var(--text);
  margin-bottom: 4px;
}
.profile-select-card .card-detail {
  color: var(--muted);
  font-size: 12px;
}

/* Compact profile card */
.profile-card {
  background: white;
  border: 1px solid var(--accent-border);
  border-radius: var(--radius);
  padding: 16px 20px;
  margin: 16px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: var(--shadow);
}
.profile-card .avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--accent-light);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  flex-shrink: 0;
}
.profile-card .profile-info { flex: 1; }
.profile-card .profile-name {
  font-weight: 600;
  font-size: 15px;
  color: var(--accent);
  cursor: pointer;
  text-decoration: none;
}
.profile-card .profile-name:hover { text-decoration: underline; }
.profile-card .profile-meta {
  font-size: 12px;
  color: var(--muted);
  margin-top: 3px;
}

/* Page content area */
.page-content {
  max-width: 600px;
  margin: 0 auto;
  padding: 8px 0;
}

/* Urgency badges */
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.badge-low { background: #d1fae5; color: #065f46; }
.badge-medium { background: #fef3c7; color: #92400e; }
.badge-high { background: #fee2e2; color: #991b1b; }
.badge-pre-session { background: #e0e7ff; color: #3730a3; }
.badge-condition-check { background: #fce7f3; color: #9d174d; }
.badge-post-session { background: #e0faf5; color: #065f46; }
.badge-post-op { background: #fef3c7; color: #92400e; }

/* Summary feed card */
.summary-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: var(--radius);
  padding: 16px 18px;
  margin-bottom: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.05);
}
.summary-card:hover { border-color: var(--accent-border); }
.summary-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}
.summary-card-patient { font-weight: 600; font-size: 14px; }
.summary-card-badges { display: flex; gap: 6px; flex-wrap: wrap; }
.summary-field { margin-bottom: 8px; font-size: 13px; }
.summary-field .label { font-weight: 600; color: #374151; }
.summary-field .value { color: #4b5563; }
.summary-recommendation {
  background: var(--accent-light);
  border-left: 3px solid var(--accent);
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--accent-dark);
  margin-top: 8px;
}
.summary-action {
  background: #f0fdf4;
  border-left: 3px solid #10b981;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 12px;
  color: #065f46;
  margin-top: 6px;
}
.summary-transcript {
  font-size: 12px;
  color: #6b7280;
  font-style: italic;
  border-top: 1px solid #f3f4f6;
  margin-top: 10px;
  padding-top: 8px;
}

/* Doctor page layout */
.doctor-layout {
  display: flex;
  gap: 0;
  height: calc(100vh - 120px);
  overflow: hidden;
}
.feed-panel {
  flex: 3;
  padding: 16px;
  overflow-y: auto;
  border-right: 1px solid #e5e7eb;
}
.feed-panel h2 {
  font-size: 14px;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 12px;
}
.ai-panel {
  flex: 2;
  padding: 16px;
  background: #f9fafb;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ai-panel h2 {
  font-size: 14px;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
}

/* Profile modal */
.profile-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 2000;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
}
.profile-modal-panel {
  width: 400px;
  max-width: 100%;
  height: 100vh;
  background: white;
  overflow-y: auto;
  padding: 24px;
  box-shadow: -4px 0 24px rgba(0,0,0,0.12);
  animation: slideInRight 0.25s ease;
}
@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.modal-avatar {
  width: 64px; height: 64px; border-radius: 50%;
  background: var(--accent-light); color: var(--accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; font-weight: 700;
  margin: 0 auto 16px;
}
.modal-close {
  background: none; border: none; font-size: 22px; cursor: pointer; color: #6b7280;
}
.modal-section { margin-bottom: 16px; }
.modal-section-title {
  font-size: 11px; font-weight: 700; color: #9ca3af;
  text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px;
}
.modal-row { display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
.modal-row .key { color: #6b7280; }
.modal-row .val { font-weight: 500; color: #1f2937; text-align: right; max-width: 60%; }
.pill-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.pill { background: var(--accent-light); color: var(--accent-dark); padding: 3px 10px; border-radius: 20px; font-size: 12px; }

/* Approve care plan button */
.btn-approve {
  background: #10b981; color: white; border: none;
  padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;
  cursor: pointer; margin-top: 8px; transition: background 0.2s;
}
.btn-approve:hover { background: #059669; }
.btn-approve:disabled { background: #6b7280; cursor: default; }
.approved-tag { color: #059669; font-size: 12px; font-weight: 600; }

.hidden { display: none !important; }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/shared/theme.css
git commit -m "feat: add teal/mint healthcare theme CSS"
```

---

### Task 11: Profile modal JS

**Files:**
- Create: `frontend/shared/profile-modal.js`

- [ ] **Step 1: Create frontend/shared/profile-modal.js**

```js
// frontend/shared/profile-modal.js
class ProfileModal {
  constructor() {
    this.overlay = null;
  }

  open(profile) {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'profile-modal-overlay';
    overlay.innerHTML = `
      <div class="profile-modal-panel">
        <div class="modal-header">
          <strong>${profile.name}</strong>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-avatar">${profile.avatar}</div>
        ${profile.role === 'patient' ? this._patientBody(profile) : this._doctorBody(profile)}
      </div>
    `;
    overlay.querySelector('.modal-close').addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });
    document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  close() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  _patientBody(p) {
    const details = p.extra_details || {};
    const meds = Array.isArray(p.medications) ? p.medications : [];
    return `
      <div class="modal-section">
        <div class="modal-section-title">Personal</div>
        <div class="modal-row"><span class="key">Age</span><span class="val">${p.age}</span></div>
        <div class="modal-row"><span class="key">Blood Type</span><span class="val">${details.blood_type || '—'}</span></div>
        <div class="modal-row"><span class="key">Allergies</span><span class="val">${details.allergies || 'None'}</span></div>
        <div class="modal-row"><span class="key">Emergency Contact</span><span class="val">${details.emergency_contact || '—'}</span></div>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Condition</div>
        <div class="modal-row"><span class="key">Diagnosis</span><span class="val">${p.condition || '—'}</span></div>
        <div class="modal-row"><span class="key">Assigned Doctor</span><span class="val">${p.next_appointment || '—'}</span></div>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Medications</div>
        <div class="pill-list">${meds.map(m => `<span class="pill">${m}</span>`).join('')}</div>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Medical History</div>
        <p style="font-size:13px;color:#4b5563;line-height:1.6">${details.medical_history || '—'}</p>
      </div>
    `;
  }

  _doctorBody(d) {
    const details = d.extra_details || {};
    const langs = Array.isArray(details.languages) ? details.languages : [];
    const patients = Array.isArray(details.patients) ? details.patients : [];
    return `
      <div class="modal-section">
        <div class="modal-section-title">Professional</div>
        <div class="modal-row"><span class="key">Specialty</span><span class="val">${d.specialty || '—'}</span></div>
        <div class="modal-row"><span class="key">Hospital</span><span class="val">${d.hospital || '—'}</span></div>
        <div class="modal-row"><span class="key">Experience</span><span class="val">${details.experience || '—'}</span></div>
        <div class="modal-row"><span class="key">Qualifications</span><span class="val">${details.qualifications || '—'}</span></div>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Languages</div>
        <div class="pill-list">${langs.map(l => `<span class="pill">${l}</span>`).join('')}</div>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Bio</div>
        <p style="font-size:13px;color:#4b5563;line-height:1.6">${details.bio || '—'}</p>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Patients</div>
        <div class="pill-list">${patients.map(p => `<span class="pill">${p}</span>`).join('')}</div>
      </div>
    `;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/shared/profile-modal.js
git commit -m "feat: add shared ProfileModal component"
```

---

### Task 12: Patient HTML page

**Files:**
- Modify: `frontend/patient.html` (replace stub)

- [ ] **Step 1: Replace frontend/patient.html with full page**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HealthAI — Patient</title>
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/shared/theme.css" />
  <script src="/lib/agora-rtc-sdk-ng/AgoraRTC_N-production.js"></script>
  <script src="/lib/agora-rtm/agora-rtm.js"></script>
</head>
<body>

  <!-- Profile selection screen -->
  <div id="profile-selection" class="profile-selection">
    <div class="selection-container">
      <h1>HealthAI</h1>
      <p class="subtitle">Select your profile to continue</p>
      <div class="profile-cards" id="patient-cards">
        <p style="color:#9ca3af">Loading profiles…</p>
      </div>
    </div>
  </div>

  <!-- Main patient page (hidden until profile selected) -->
  <div id="main-page" class="hidden">
    <div class="page-header">
      <div class="logo">HealthAI</div>
      <button id="switch-user-btn" class="switch-user-btn">Switch Patient</button>
    </div>

    <div id="profile-card-container"></div>

    <div class="page-content">
      <section id="agent-state" class="agent-state state-offline">
        <div class="state-indicator">
          <span class="state-dot"></span>
          <span class="state-text">offline</span>
        </div>
      </section>

      <section id="ai-visualizer" class="ai-visualizer">
        <div class="visualizer-container">
          <div class="wave-bars">
            <div class="wave-bar"></div>
            <div class="wave-bar"></div>
            <div class="wave-bar"></div>
            <div class="wave-bar"></div>
            <div class="wave-bar"></div>
            <div class="wave-bar"></div>
            <div class="wave-bar"></div>
            <div class="wave-bar"></div>
          </div>
        </div>
      </section>

      <section class="controls">
        <button id="call-btn" class="btn primary">
          <span class="btn-text">📞 Call AI Doctor</span>
          <span class="btn-loading" style="display:none">Connecting…</span>
        </button>
        <button id="postop-btn" class="btn" style="background:#f0fdf4;border-color:#10b981;color:#065f46">
          <span class="btn-text">🏥 Post-Op Care Check-In</span>
          <span class="btn-loading" style="display:none">Connecting…</span>
        </button>
        <button id="end-call-btn" class="btn danger hidden">
          <span class="btn-text">End Call</span>
          <span class="btn-loading" style="display:none">Ending…</span>
        </button>
      </section>
    </div>

    <!-- Chat -->
    <div id="chatToggle" class="chat-toggle" style="display:none">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M8 12h8M8 8h8M8 16h5M7 20l4-4h6a3 3 0 003-3V7a3 3 0 00-3-3H7a3 3 0 00-3 3v10a3 3 0 003 3z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <div id="chatPanel" class="chat-panel">
      <div class="chat-header"><h3>Chat with AI</h3><button id="closeChatBtn" class="close-btn">×</button></div>
      <div class="chat-messages" id="chatMessages"></div>
      <div id="typingIndicator" class="typing-indicator" style="display:none">
        <div class="typing-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
        <span>thinking…</span>
      </div>
      <div class="chat-input">
        <input type="text" id="messageInput" placeholder="Start the conversation to begin chatting…" disabled />
        <button id="sendBtn" class="send-btn" disabled>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="chat-actions"><button id="clearChatBtn" class="clear-btn">Clear Chat</button></div>
    </div>
  </div>

  <script src="/utils/config.js"></script>
  <script src="/utils/audioVisualizer.js"></script>
  <script src="/utils/chat.js"></script>
  <script src="/shared/profile-modal.js"></script>
  <script src="/patient.js"></script>
</body>
</html>
```

- [ ] **Step 2: Run server and verify /patient loads without JS errors**

```bash
npm run dev
```

Open `http://localhost:3000/patient`. Expected: profile selection screen shows, no console errors (except possibly 404 for patient.js since it doesn't exist yet).

- [ ] **Step 3: Commit**

```bash
git add frontend/patient.html
git commit -m "feat: add patient.html page shell"
```

---

### Task 13: Patient JS logic

**Files:**
- Create: `frontend/patient.js`

- [ ] **Step 1: Create frontend/patient.js**

```js
// frontend/patient.js
(function () {
  // ===========================
  // STATE
  // ===========================
  let selectedProfile = null;
  let rtcClient = null;
  let rtcLocalAudioTrack = null;
  let rtcJoined = false;
  let rtcRemoteUsers = {};
  let rtmClient = null;
  let agoraChannel = null;
  let agoraChannelInfo = null;
  let agoraUserUID = Math.floor(Math.random() * 100000) + 1000;
  let agentUID = null;
  let agoraConvoAIAgentID = null;
  let agentState = 'idle';
  let chatManager = null;
  let currentCallType = null; // 'patient' | 'post-op'
  const profileModal = new ProfileModal();

  // ===========================
  // INIT
  // ===========================
  async function init() {
    const stored = sessionStorage.getItem('selectedPatient');
    if (!stored) {
      await showProfileSelection();
    } else {
      selectedProfile = JSON.parse(stored);
      await initMainPage();
    }
  }

  async function showProfileSelection() {
    document.getElementById('profile-selection').classList.remove('hidden');
    document.getElementById('main-page').classList.add('hidden');
    try {
      const profiles = await API.healthcare.listProfiles('patient');
      const container = document.getElementById('patient-cards');
      container.innerHTML = profiles.map(p => `
        <div class="profile-select-card" data-id="${p.id}">
          <div class="avatar">${p.avatar}</div>
          <div class="card-name">${p.name}</div>
          <div class="card-detail">${p.condition || p.specialty || ''}</div>
        </div>
      `).join('');
      container.querySelectorAll('.profile-select-card').forEach(card => {
        card.addEventListener('click', () => selectProfile(card.dataset.id));
      });
    } catch (e) {
      console.error('Failed to load profiles', e);
    }
  }

  async function selectProfile(profileId) {
    const profile = await API.healthcare.getProfile(profileId);
    sessionStorage.setItem('selectedPatient', JSON.stringify(profile));
    selectedProfile = profile;
    await initMainPage();
  }

  async function initMainPage() {
    document.getElementById('profile-selection').classList.add('hidden');
    document.getElementById('main-page').classList.remove('hidden');
    renderProfileCard(selectedProfile);
    initAgoraClients();
    setupEventListeners();
    chatManager = new ChatManager();
    chatManager.initialize();
  }

  // ===========================
  // PROFILE CARD
  // ===========================
  function renderProfileCard(p) {
    const container = document.getElementById('profile-card-container');
    container.innerHTML = `
      <div class="profile-card">
        <div class="avatar">${p.avatar}</div>
        <div class="profile-info">
          <span class="profile-name" id="open-profile-modal">${p.name}</span>
          <div class="profile-meta">${p.condition || ''} · ${p.next_appointment || ''}</div>
        </div>
      </div>
    `;
    document.getElementById('open-profile-modal').addEventListener('click', () => profileModal.open(p));
  }

  // ===========================
  // EVENT LISTENERS
  // ===========================
  function setupEventListeners() {
    document.getElementById('call-btn').addEventListener('click', () => startCall('patient'));
    document.getElementById('postop-btn').addEventListener('click', () => startCall('post-op'));
    document.getElementById('end-call-btn').addEventListener('click', stopCall);
    document.getElementById('switch-user-btn').addEventListener('click', () => {
      sessionStorage.removeItem('selectedPatient');
      location.reload();
    });
  }

  // ===========================
  // AGORA INIT
  // ===========================
  function initAgoraClients() {
    agoraChannel = UTILS.generateChannelName();
    rtcClient = AgoraRTC.createClient({ mode: 'live', codec: 'vp8', role: 'host' });
    rtcClient.on('user-published', handleRTCUserPublished);
    rtcClient.on('user-unpublished', handleRTCUserUnpublished);
    rtmClient = null; // initialised lazily on first call
  }

  // ===========================
  // CALL FLOW
  // ===========================
  async function startCall(callType) {
    currentCallType = callType;
    setCallButtonLoading(callType, true);

    try {
      agoraChannelInfo = await API.agora.getChannelInfo(agoraChannel, agoraUserUID);

      // Build profile context string
      const profileContext = buildProfileContext(selectedProfile, callType);
      let greetingMessage = `Hello ${selectedProfile.name}! I'm your AI medical assistant. How can I help you today?`;

      // For post-op, fetch care plan
      let carePlanText = '';
      if (callType === 'post-op') {
        try {
          const plan = await API.healthcare.getCarePlan(selectedProfile.id);
          carePlanText = plan.plan_text.map(d => `${d.days}: ${d.instructions}`).join(' ');
          greetingMessage = `Hello ${selectedProfile.name}! I'm calling to check on your recovery. How are you feeling today?`;
        } catch (_) { /* no care plan — proceed anyway */ }
      }

      // Init RTM client
      rtmClient = new AgoraRTM.RTM(agoraChannelInfo.appId, agoraUserUID.toString());
      rtmClient.addEventListener('message', handleRTMMessage);
      rtmClient.addEventListener('presence', handleRTMPresenceEvent);

      await joinRTCChannel(agoraChannelInfo.appId, agoraChannelInfo.channel, agoraChannelInfo.uid, agoraChannelInfo.token);
      await joinRTMChannel(agoraChannelInfo.channel, agoraChannelInfo.uid, agoraChannelInfo.token);

      const fullContext = carePlanText
        ? `${profileContext}\nCare plan: ${carePlanText}`
        : profileContext;

      const response = await API.agora.startConversation({
        channel: agoraChannelInfo.channel,
        agentName: 'HealthAI_' + agoraChannelInfo.channel,
        remoteUid: agoraUserUID,
        promptType: callType,
        profileContext: fullContext,
        greetingMessage
      });

      agoraConvoAIAgentID = response.agentId;
      agentUID = response.agentUid;
    } catch (e) {
      console.error('Failed to start call', e);
      setCallButtonLoading(callType, false);
    }
  }

  function buildProfileContext(p, callType) {
    const meds = Array.isArray(p.medications) ? p.medications.join(', ') : p.medications || '';
    return [
      `Patient name: ${p.name}`,
      `Age: ${p.age}`,
      `Current conditions: ${p.condition || 'None recorded'}`,
      `Current medications: ${meds || 'None'}`,
      `Next appointment: ${p.next_appointment || 'Not scheduled'}`
    ].join('\n');
  }

  async function stopCall() {
    setEndCallLoading(true);
    try {
      // Extract summary before stopping
      const summary = extractSummary();

      if (rtcJoined) {
        await rtcLeaveChannel();
        await rtmLeaveChannel();
      }
      if (agoraConvoAIAgentID) {
        await API.agora.stopConversation(agoraConvoAIAgentID);
        agoraConvoAIAgentID = null;
        agentUID = null;
      }

      // Save summary to backend (patient calls only)
      if (summary && currentCallType === 'patient' && selectedProfile) {
        try {
          await API.healthcare.createSummary({ patient_id: selectedProfile.id, ...summary });
        } catch (e) {
          console.error('Failed to save summary', e);
        }
      }

      onCallStopped();
    } catch (e) {
      console.error('Failed to stop call', e);
      setEndCallLoading(false);
    }
  }

  function extractSummary() {
    if (!chatManager) return null;
    const messages = chatManager.getCurrentSessionMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.sender === 'ai' && msg.content) {
        const match = msg.content.match(/<summary>([\s\S]*?)<\/summary>/);
        if (match) {
          try { return JSON.parse(match[1].trim()); } catch (_) {}
        }
      }
    }
    return null;
  }

  // ===========================
  // AGORA RTC
  // ===========================
  async function joinRTCChannel(appId, channel, uid, token) {
    rtcLocalAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
    await rtcClient.join(appId, channel, token || null, uid);
    await rtcClient.publish([rtcLocalAudioTrack]);
    rtcJoined = true;
  }

  async function rtcLeaveChannel() {
    if (rtcLocalAudioTrack) { rtcLocalAudioTrack.close(); rtcLocalAudioTrack = null; }
    await rtcClient.leave();
    rtcJoined = false;
  }

  function handleRTCUserPublished(user, mediaType) {
    rtcRemoteUsers[user.uid] = user;
    if (mediaType === 'audio') {
      rtcClient.subscribe(user, mediaType).then(() => {
        user.audioTrack.play();
        if (user.uid == agentUID) {
          onCallStarted();
          setTimeout(() => {
            if (window.audioVisualizer) window.audioVisualizer.startFrequencyAnalysis(user.audioTrack);
          }, 1000);
        }
      });
    }
  }

  function handleRTCUserUnpublished(user) {
    delete rtcRemoteUsers[user.uid];
    if (user.uid == agentUID) {
      if (window.audioVisualizer) window.audioVisualizer.stopFrequencyAnalysis();
      updateAgentStateUI('offline');
    }
  }

  // ===========================
  // AGORA RTM
  // ===========================
  async function joinRTMChannel(channel, uid, token) {
    await rtmClient.login({ token: token || null, uid: uid.toString() });
    await rtmClient.subscribe(channel);
  }

  async function rtmLeaveChannel() {
    try { await rtmClient.unsubscribe(agoraChannel); } catch (_) {}
  }

  function handleRTMMessage(event) {
    if (event.channelType !== 'MESSAGE' || event.channelName !== agoraChannel) return;
    try {
      const parsed = typeof event.message === 'string' ? JSON.parse(event.message) : null;
      if (!parsed) return;

      // Hide summary XML from chat display but let ChatManager store the message for extraction
      if (parsed.object === 'assistant.transcription' && parsed.text && parsed.text.includes('<summary>')) {
        // Store in chatManager messages but display a cleaner version
        const cleanText = parsed.text.replace(/<summary>[\s\S]*?<\/summary>/, '').trim();
        if (cleanText) chatManager && chatManager.receiveRtmMessage({ ...parsed, text: cleanText });
        // Still pass the full message to chatManager's internal storage so extractSummary() finds it
        if (chatManager) {
          chatManager.currentSessionMessages.push({ id: Date.now(), content: parsed.text, sender: 'ai', timestamp: new Date() });
        }
        return;
      }

      chatManager && chatManager.receiveRtmMessage(parsed);
    } catch (_) {}
  }

  function handleRTMPresenceEvent(event) {
    if (event.eventType === 'REMOTE_STATE_CHANGED' && event.publisher !== agoraUserUID?.toString()) {
      const state = event.stateChanged?.state;
      if (state) { agentState = state; updateAgentStateUI(state); }
    }
  }

  async function sendTextMessage(text) {
    if (!rtmClient || !agoraChannel || !rtcJoined) return;
    await rtmClient.publish(agoraChannel, text, { customType: 'user.transcription' });
  }
  window.sendTextMessage = sendTextMessage;

  // ===========================
  // UI HELPERS
  // ===========================
  function onCallStarted() {
    setCallButtonLoading(currentCallType, false);
    document.getElementById('call-btn').classList.add('hidden');
    document.getElementById('postop-btn').classList.add('hidden');
    document.getElementById('end-call-btn').classList.remove('hidden');
    updateAgentStateUI('speaking');
    if (chatManager) { chatManager.enableChat(); chatManager.startNewSession(); }
  }

  function onCallStopped() {
    setEndCallLoading(false);
    document.getElementById('call-btn').classList.remove('hidden');
    document.getElementById('postop-btn').classList.remove('hidden');
    document.getElementById('end-call-btn').classList.add('hidden');
    updateAgentStateUI('offline');
    if (chatManager) { chatManager.disableChat(); chatManager.endSession(); }
    currentCallType = null;
  }

  function setCallButtonLoading(callType, loading) {
    const btn = callType === 'post-op'
      ? document.getElementById('postop-btn')
      : document.getElementById('call-btn');
    loading ? btn.classList.add('loading') : btn.classList.remove('loading');
  }

  function setEndCallLoading(loading) {
    const btn = document.getElementById('end-call-btn');
    loading ? btn.classList.add('loading') : btn.classList.remove('loading');
  }

  function updateAgentStateUI(state) {
    const el = document.getElementById('agent-state');
    const text = el?.querySelector('.state-text');
    if (!el || !text) return;
    text.textContent = state;
    el.className = 'agent-state state-' + state.toLowerCase();
  }

  init();
})();
```

- [ ] **Step 2: Start the dev server and test the patient page manually**

```bash
npm run dev
```

Open `http://localhost:3000/patient`. Verify:
1. Profile selection screen shows two patient cards
2. Click "Sarah Chen" → main page appears with her profile card
3. "Switch Patient" button returns to selection
4. Click her name → profile modal opens with full details

- [ ] **Step 3: Commit**

```bash
git add frontend/patient.js
git commit -m "feat: add patient.js — profile selection, call flow, summary extraction"
```

---

### Task 14: Doctor HTML page

**Files:**
- Modify: `frontend/doctor.html` (replace stub)

- [ ] **Step 1: Replace frontend/doctor.html with full page**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HealthAI — Doctor</title>
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/shared/theme.css" />
  <script src="/lib/agora-rtc-sdk-ng/AgoraRTC_N-production.js"></script>
  <script src="/lib/agora-rtm/agora-rtm.js"></script>
</head>
<body>

  <!-- Profile selection -->
  <div id="profile-selection" class="profile-selection">
    <div class="selection-container">
      <h1>HealthAI</h1>
      <p class="subtitle">Doctor — select your profile</p>
      <div class="profile-cards" id="doctor-cards">
        <p style="color:#9ca3af">Loading profiles…</p>
      </div>
    </div>
  </div>

  <!-- Main doctor page -->
  <div id="main-page" class="hidden">
    <div class="page-header">
      <div class="logo">HealthAI</div>
      <button id="switch-user-btn" class="switch-user-btn">Switch Doctor</button>
    </div>

    <div id="profile-card-container"></div>

    <div class="doctor-layout">
      <!-- Patient summary feed -->
      <div class="feed-panel">
        <h2>Patient Summaries</h2>
        <div id="summary-feed"></div>
      </div>

      <!-- AI assistant panel -->
      <div class="ai-panel">
        <h2>AI Assistant</h2>

        <section id="agent-state" class="agent-state state-offline">
          <div class="state-indicator">
            <span class="state-dot"></span>
            <span class="state-text">offline</span>
          </div>
        </section>

        <section id="ai-visualizer" class="ai-visualizer">
          <div class="visualizer-container">
            <div class="wave-bars">
              <div class="wave-bar"></div><div class="wave-bar"></div>
              <div class="wave-bar"></div><div class="wave-bar"></div>
              <div class="wave-bar"></div><div class="wave-bar"></div>
              <div class="wave-bar"></div><div class="wave-bar"></div>
            </div>
          </div>
        </section>

        <section class="controls">
          <button id="call-btn" class="btn primary">
            <span class="btn-text">📞 Call AI Assistant</span>
            <span class="btn-loading" style="display:none">Connecting…</span>
          </button>
          <button id="end-call-btn" class="btn danger hidden">
            <span class="btn-text">End Call</span>
            <span class="btn-loading" style="display:none">Ending…</span>
          </button>
        </section>

        <!-- Chat -->
        <div id="chatToggle" class="chat-toggle" style="display:none;position:static;width:40px;height:40px;font-size:18px">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M8 12h8M8 8h8M8 16h5M7 20l4-4h6a3 3 0 003-3V7a3 3 0 00-3-3H7a3 3 0 00-3 3v10a3 3 0 003 3z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>
    </div>

    <!-- Chat panel (fixed, right side) -->
    <div id="chatPanel" class="chat-panel">
      <div class="chat-header"><h3>Chat with AI</h3><button id="closeChatBtn" class="close-btn">×</button></div>
      <div class="chat-messages" id="chatMessages"></div>
      <div id="typingIndicator" class="typing-indicator" style="display:none">
        <div class="typing-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
        <span>thinking…</span>
      </div>
      <div class="chat-input">
        <input type="text" id="messageInput" placeholder="Start the conversation to begin chatting…" disabled />
        <button id="sendBtn" class="send-btn" disabled>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="chat-actions"><button id="clearChatBtn" class="clear-btn">Clear Chat</button></div>
    </div>
  </div>

  <script src="/utils/config.js"></script>
  <script src="/utils/audioVisualizer.js"></script>
  <script src="/utils/chat.js"></script>
  <script src="/shared/profile-modal.js"></script>
  <script src="/doctor.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/doctor.html
git commit -m "feat: add doctor.html page shell"
```

---

### Task 15: Doctor JS logic

**Files:**
- Create: `frontend/doctor.js`

- [ ] **Step 1: Create frontend/doctor.js**

```js
// frontend/doctor.js
(function () {
  // ===========================
  // STATE
  // ===========================
  let selectedProfile = null;
  let eventSource = null;
  let rtcClient = null;
  let rtcLocalAudioTrack = null;
  let rtcJoined = false;
  let rtcRemoteUsers = {};
  let rtmClient = null;
  let agoraChannel = null;
  let agoraChannelInfo = null;
  let agoraUserUID = Math.floor(Math.random() * 100000) + 1000;
  let agentUID = null;
  let agoraConvoAIAgentID = null;
  let chatManager = null;
  const profileModal = new ProfileModal();

  // ===========================
  // INIT
  // ===========================
  async function init() {
    const stored = sessionStorage.getItem('selectedDoctor');
    if (!stored) {
      await showProfileSelection();
    } else {
      selectedProfile = JSON.parse(stored);
      await initMainPage();
    }
  }

  async function showProfileSelection() {
    document.getElementById('profile-selection').classList.remove('hidden');
    document.getElementById('main-page').classList.add('hidden');
    try {
      const profiles = await API.healthcare.listProfiles('doctor');
      const container = document.getElementById('doctor-cards');
      container.innerHTML = profiles.map(p => `
        <div class="profile-select-card" data-id="${p.id}">
          <div class="avatar">${p.avatar}</div>
          <div class="card-name">${p.name}</div>
          <div class="card-detail">${p.specialty || ''}</div>
        </div>
      `).join('');
      container.querySelectorAll('.profile-select-card').forEach(card => {
        card.addEventListener('click', () => selectProfile(card.dataset.id));
      });
    } catch (e) {
      console.error('Failed to load profiles', e);
    }
  }

  async function selectProfile(profileId) {
    const profile = await API.healthcare.getProfile(profileId);
    sessionStorage.setItem('selectedDoctor', JSON.stringify(profile));
    selectedProfile = profile;
    await initMainPage();
  }

  async function initMainPage() {
    document.getElementById('profile-selection').classList.add('hidden');
    document.getElementById('main-page').classList.remove('hidden');
    renderProfileCard(selectedProfile);
    await loadSummaryFeed();
    connectSSE();
    initAgoraClients();
    setupEventListeners();
    chatManager = new ChatManager();
    chatManager.initialize();
  }

  // ===========================
  // PROFILE CARD
  // ===========================
  function renderProfileCard(p) {
    const container = document.getElementById('profile-card-container');
    container.innerHTML = `
      <div class="profile-card">
        <div class="avatar">${p.avatar}</div>
        <div class="profile-info">
          <span class="profile-name" id="open-profile-modal">${p.name}</span>
          <div class="profile-meta">${p.specialty || ''} · ${p.hospital || ''}</div>
        </div>
      </div>
    `;
    document.getElementById('open-profile-modal').addEventListener('click', () => profileModal.open(p));
  }

  // ===========================
  // SUMMARY FEED
  // ===========================
  async function loadSummaryFeed() {
    try {
      const summaries = await API.healthcare.listSummaries();
      const feed = document.getElementById('summary-feed');
      feed.innerHTML = '';
      if (summaries.length === 0) {
        feed.innerHTML = '<p style="color:#9ca3af;font-size:13px">No patient summaries yet. Summaries appear here when patients finish calls.</p>';
      } else {
        summaries.forEach(s => feed.appendChild(buildSummaryCard(s)));
      }
    } catch (e) {
      console.error('Failed to load summaries', e);
    }
  }

  function buildSummaryCard(s) {
    const symptoms = Array.isArray(s.symptoms) ? s.symptoms.join(', ') : '';
    const meds = Array.isArray(s.medications_discussed) ? s.medications_discussed.join(', ') : '';
    const vitals = s.vitals_mentioned && typeof s.vitals_mentioned === 'object'
      ? Object.entries(s.vitals_mentioned).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
    const timeAgo = s.created_at ? new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const hasCarePlan = s.call_type === 'post-op';

    const card = document.createElement('div');
    card.className = 'summary-card';
    card.dataset.summaryId = s.id;
    card.innerHTML = `
      <div class="summary-card-header">
        <span class="summary-card-patient">${s.patient_name || s.patient_id}</span>
        <div class="summary-card-badges">
          <span class="badge badge-${s.call_type}">${s.call_type}</span>
          <span class="badge badge-${s.urgency}">${s.urgency}</span>
          <span style="font-size:11px;color:#9ca3af">${timeAgo}</span>
        </div>
      </div>
      ${s.chief_complaint ? `<div class="summary-field"><span class="label">Chief complaint: </span><span class="value">${escapeHtml(s.chief_complaint)}</span></div>` : ''}
      ${symptoms ? `<div class="summary-field"><span class="label">Symptoms: </span><span class="value">${escapeHtml(symptoms)}</span></div>` : ''}
      ${vitals ? `<div class="summary-field"><span class="label">Vitals mentioned: </span><span class="value">${escapeHtml(vitals)}</span></div>` : ''}
      ${meds ? `<div class="summary-field"><span class="label">Medications discussed: </span><span class="value">${escapeHtml(meds)}</span></div>` : ''}
      ${s.ai_recommendation ? `<div class="summary-recommendation">AI: ${escapeHtml(s.ai_recommendation)}</div>` : ''}
      ${s.suggested_action ? `<div class="summary-action">Suggested action: ${escapeHtml(s.suggested_action)}</div>` : ''}
      ${s.transcript_excerpt ? `<div class="summary-transcript">"${escapeHtml(s.transcript_excerpt)}"</div>` : ''}
      ${hasCarePlan ? `<div id="plan-actions-${s.id}"><button class="btn-approve" onclick="approvePlan('${s.patient_id}')">Approve Care Plan</button></div>` : ''}
    `;
    return card;
  }

  // Exposed globally so inline onclick works
  window.approvePlan = async function (patientId) {
    try {
      const plan = await API.healthcare.getCarePlan(patientId);
      await API.healthcare.updateCarePlan(plan.id, { status: 'approved' });
      // Update UI
      document.querySelectorAll(`[id^="plan-actions-"]`).forEach(el => {
        const card = el.closest('.summary-card');
        if (card) {
          const pid = card.querySelector('.btn-approve')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
          if (pid === patientId) el.innerHTML = '<span class="approved-tag">✓ Care plan approved</span>';
        }
      });
    } catch (e) {
      console.error('Failed to approve care plan', e);
    }
  };

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===========================
  // SSE — live summary feed
  // ===========================
  function connectSSE() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource('/events');
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'new_summary' && data.summary) {
          const feed = document.getElementById('summary-feed');
          const placeholder = feed.querySelector('p');
          if (placeholder) placeholder.remove();
          feed.prepend(buildSummaryCard(data.summary));
        }
      } catch (_) {}
    };
    eventSource.onerror = () => {
      // SSE auto-reconnects — no action needed
    };
  }

  // ===========================
  // EVENT LISTENERS
  // ===========================
  function setupEventListeners() {
    document.getElementById('call-btn').addEventListener('click', startCall);
    document.getElementById('end-call-btn').addEventListener('click', stopCall);
    document.getElementById('switch-user-btn').addEventListener('click', () => {
      sessionStorage.removeItem('selectedDoctor');
      if (eventSource) eventSource.close();
      location.reload();
    });
  }

  // ===========================
  // AGORA INIT
  // ===========================
  function initAgoraClients() {
    agoraChannel = UTILS.generateChannelName();
    rtcClient = AgoraRTC.createClient({ mode: 'live', codec: 'vp8', role: 'host' });
    rtcClient.on('user-published', handleRTCUserPublished);
    rtcClient.on('user-unpublished', handleRTCUserUnpublished);
  }

  // ===========================
  // CALL FLOW
  // ===========================
  async function startCall() {
    const btn = document.getElementById('call-btn');
    btn.classList.add('loading');
    try {
      agoraChannelInfo = await API.agora.getChannelInfo(agoraChannel, agoraUserUID);

      const profileContext = [
        `Doctor name: ${selectedProfile.name}`,
        `Specialty: ${selectedProfile.specialty}`,
        `Hospital: ${selectedProfile.hospital}`
      ].join('\n');

      rtmClient = new AgoraRTM.RTM(agoraChannelInfo.appId, agoraUserUID.toString());
      rtmClient.addEventListener('message', handleRTMMessage);
      rtmClient.addEventListener('presence', handleRTMPresenceEvent);

      await joinRTCChannel(agoraChannelInfo.appId, agoraChannelInfo.channel, agoraChannelInfo.uid, agoraChannelInfo.token);
      await joinRTMChannel(agoraChannelInfo.channel, agoraChannelInfo.uid, agoraChannelInfo.token);

      const response = await API.agora.startConversation({
        channel: agoraChannelInfo.channel,
        agentName: 'HealthAI_Doctor_' + agoraChannelInfo.channel,
        remoteUid: agoraUserUID,
        promptType: 'doctor',
        profileContext,
        greetingMessage: `Hello ${selectedProfile.name}! I'm your AI clinical assistant. What can I help you with?`
      });

      agoraConvoAIAgentID = response.agentId;
      agentUID = response.agentUid;
    } catch (e) {
      console.error('Failed to start call', e);
      btn.classList.remove('loading');
    }
  }

  async function stopCall() {
    const btn = document.getElementById('end-call-btn');
    btn.classList.add('loading');
    try {
      if (rtcJoined) { await rtcLeaveChannel(); await rtmLeaveChannel(); }
      if (agoraConvoAIAgentID) {
        await API.agora.stopConversation(agoraConvoAIAgentID);
        agoraConvoAIAgentID = null; agentUID = null;
      }
      onCallStopped();
    } catch (e) {
      console.error('Failed to stop call', e);
      btn.classList.remove('loading');
    }
  }

  // ===========================
  // AGORA RTC
  // ===========================
  async function joinRTCChannel(appId, channel, uid, token) {
    rtcLocalAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
    await rtcClient.join(appId, channel, token || null, uid);
    await rtcClient.publish([rtcLocalAudioTrack]);
    rtcJoined = true;
  }

  async function rtcLeaveChannel() {
    if (rtcLocalAudioTrack) { rtcLocalAudioTrack.close(); rtcLocalAudioTrack = null; }
    await rtcClient.leave();
    rtcJoined = false;
  }

  function handleRTCUserPublished(user, mediaType) {
    rtcRemoteUsers[user.uid] = user;
    if (mediaType === 'audio') {
      rtcClient.subscribe(user, mediaType).then(() => {
        user.audioTrack.play();
        if (user.uid == agentUID) {
          onCallStarted();
          setTimeout(() => {
            if (window.audioVisualizer) window.audioVisualizer.startFrequencyAnalysis(user.audioTrack);
          }, 1000);
        }
      });
    }
  }

  function handleRTCUserUnpublished(user) {
    delete rtcRemoteUsers[user.uid];
    if (user.uid == agentUID) {
      if (window.audioVisualizer) window.audioVisualizer.stopFrequencyAnalysis();
      updateAgentStateUI('offline');
    }
  }

  // ===========================
  // AGORA RTM
  // ===========================
  async function joinRTMChannel(channel, uid, token) {
    await rtmClient.login({ token: token || null, uid: uid.toString() });
    await rtmClient.subscribe(channel);
  }

  async function rtmLeaveChannel() {
    try { await rtmClient.unsubscribe(agoraChannel); } catch (_) {}
  }

  function handleRTMMessage(event) {
    if (event.channelType !== 'MESSAGE' || event.channelName !== agoraChannel) return;
    try {
      const parsed = typeof event.message === 'string' ? JSON.parse(event.message) : null;
      if (parsed) chatManager && chatManager.receiveRtmMessage(parsed);
    } catch (_) {}
  }

  function handleRTMPresenceEvent(event) {
    if (event.eventType === 'REMOTE_STATE_CHANGED' && event.publisher !== agoraUserUID?.toString()) {
      const state = event.stateChanged?.state;
      if (state) updateAgentStateUI(state);
    }
  }

  async function sendTextMessage(text) {
    if (!rtmClient || !agoraChannel || !rtcJoined) return;
    await rtmClient.publish(agoraChannel, text, { customType: 'user.transcription' });
  }
  window.sendTextMessage = sendTextMessage;

  // ===========================
  // UI HELPERS
  // ===========================
  function onCallStarted() {
    document.getElementById('call-btn').classList.remove('loading');
    document.getElementById('call-btn').classList.add('hidden');
    document.getElementById('end-call-btn').classList.remove('hidden');
    updateAgentStateUI('speaking');
    if (chatManager) { chatManager.enableChat(); chatManager.startNewSession(); }
  }

  function onCallStopped() {
    document.getElementById('end-call-btn').classList.remove('loading');
    document.getElementById('call-btn').classList.remove('hidden');
    document.getElementById('end-call-btn').classList.add('hidden');
    updateAgentStateUI('offline');
    if (chatManager) { chatManager.disableChat(); chatManager.endSession(); }
  }

  function updateAgentStateUI(state) {
    const el = document.getElementById('agent-state');
    const text = el?.querySelector('.state-text');
    if (!el || !text) return;
    text.textContent = state;
    el.className = 'agent-state state-' + state.toLowerCase();
  }

  init();
})();
```

- [ ] **Step 2: Start dev server and test doctor page manually**

```bash
npm run dev
```

Open `http://localhost:3000/doctor`. Verify:
1. Doctor selection screen shows two doctor cards
2. Select "Dr. James Williams" → doctor dashboard appears
3. Summary feed shows "No patient summaries yet" message
4. Open a second browser tab at `http://localhost:3000/patient`, select Sarah Chen, the patient page loads
5. Switch User works

Open patient in one tab, doctor in another — both load correctly.

- [ ] **Step 3: Commit**

```bash
git add frontend/doctor.js
git commit -m "feat: add doctor.js — profile selection, summary feed, SSE, AI call"
```

---

### Task 16: Update index.html to landing page

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1: Replace frontend/index.html with landing page**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HealthAI Demo</title>
  <link rel="stylesheet" href="styles.css" />
  <link rel="stylesheet" href="shared/theme.css" />
</head>
<body style="min-height:100vh;display:flex;align-items:center;justify-content:center">
  <div style="text-align:center;padding:40px">
    <h1 style="color:#0d9488;font-size:36px;font-weight:700;margin-bottom:8px">HealthAI</h1>
    <p style="color:#6b7280;font-size:16px;margin-bottom:40px">AI-powered healthcare assistant demo</p>
    <div style="display:flex;gap:20px;justify-content:center">
      <a href="/patient" style="display:block;background:white;border:2px solid #99f6e4;border-radius:16px;padding:32px 40px;text-decoration:none;box-shadow:0 4px 16px rgba(13,148,136,0.08);transition:all 0.2s" onmouseover="this.style.borderColor='#0d9488';this.style.transform='translateY(-3px)'" onmouseout="this.style.borderColor='#99f6e4';this.style.transform='none'">
        <div style="font-size:40px;margin-bottom:12px">👤</div>
        <div style="font-weight:700;font-size:16px;color:#1f2937;margin-bottom:4px">Patient</div>
        <div style="font-size:13px;color:#6b7280">Call AI doctor, check-in</div>
      </a>
      <a href="/doctor" style="display:block;background:white;border:2px solid #99f6e4;border-radius:16px;padding:32px 40px;text-decoration:none;box-shadow:0 4px 16px rgba(13,148,136,0.08);transition:all 0.2s" onmouseover="this.style.borderColor='#0d9488';this.style.transform='translateY(-3px)'" onmouseout="this.style.borderColor='#99f6e4';this.style.transform='none'">
        <div style="font-size:40px;margin-bottom:12px">🩺</div>
        <div style="font-weight:700;font-size:16px;color:#1f2937;margin-bottom:4px">Doctor</div>
        <div style="font-size:13px;color:#6b7280">View summaries, consult AI</div>
      </a>
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 2: Run all backend tests to confirm nothing regressed**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 3: Start server and verify landing page**

```bash
npm run dev
```

Open `http://localhost:3000`. Verify two cards appear and clicking each navigates to the correct page.

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html
git commit -m "feat: update index.html to HealthAI demo landing page"
```

---

### Task 17: End-to-end demo smoke test

This task verifies the full demo flow works before sign-off.

- [ ] **Step 1: Make sure .env has real Agora credentials**

Copy `.env.example` to `.env` and fill in:
- `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`
- `AGORA_API_KEY`, `AGORA_API_SECRET`
- `LLM_URL`, `LLM_API_KEY`
- `TTS_MINIMAX_API_KEY`, `TTS_MINIMAX_GROUP_ID`, `TTS_MINIMAX_VOICE_ID`
- `PROMPT_PATIENT` — paste the template from `.env.example`
- `PROMPT_POST_OP_CARE`, `PROMPT_DOCTOR_ASSISTANT` — same

- [ ] **Step 2: Start server**

```bash
npm start
```

- [ ] **Step 3: Open two browser windows**

Window 1: `http://localhost:3000/patient` — select Sarah Chen  
Window 2: `http://localhost:3000/doctor` — select Dr. James Williams

- [ ] **Step 4: Patient calls AI Doctor**

In Window 1: click "Call AI Doctor". Verify:
- AI greets "Sarah" by name
- Voice works (speak and AI responds)
- Agent state updates (speaking/listening/thinking)
- Audio visualizer animates
- Chat panel shows transcript

- [ ] **Step 5: End call and verify summary appears in doctor feed**

In Window 1: click "End Call". Wait 2-3 seconds.  
In Window 2: verify a new summary card appears in the feed automatically (SSE push), showing:
- Sarah Chen's name
- Call type badge
- Urgency badge
- Chief complaint, symptoms, AI recommendation

- [ ] **Step 6: Doctor calls AI Assistant**

In Window 2: click "Call AI Assistant". Verify AI greets "Dr. Williams" and answers clinical questions.

- [ ] **Step 7: Patient Post-Op Check-In (Marcus Johnson)**

In Window 1: click "Switch Patient", select Marcus Johnson.  
Click "Post-Op Care Check-In". Verify AI references the care plan (Day 1–3 instructions).  
In Window 2: verify "Approve Care Plan" button appears on Marcus's summary card.  
Click "Approve Care Plan" — button changes to "✓ Care plan approved".

- [ ] **Step 8: Run full test suite one final time**

```bash
npm test
```

Expected: all tests pass, no failures.

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "feat: healthcare AI demo complete — patient/doctor pages, SSE, SQLite, profiles"
```
