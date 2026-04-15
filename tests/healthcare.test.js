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
