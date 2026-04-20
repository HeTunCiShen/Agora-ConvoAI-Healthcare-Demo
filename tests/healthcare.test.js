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
  app.get('/api/healthcare/profile-summary/:patientId', ctrl.getProfileSummary);
  app.get('/api/healthcare/appointments', ctrl.listAppointments);
  app.post('/api/healthcare/appointments', ctrl.createAppointment);
  app.put('/api/healthcare/appointments/:id', ctrl.updateAppointment);
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

  test('returns all 6 profiles when no role filter', async () => {
    const res = await request(app).get('/api/healthcare/profiles');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(6);
  });

  test('filters by role=patient returns 2', async () => {
    const res = await request(app).get('/api/healthcare/profiles?role=patient');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every(p => p.role === 'patient')).toBe(true);
  });

  test('filters by role=doctor returns 4', async () => {
    const res = await request(app).get('/api/healthcare/profiles?role=doctor');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
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
      suggested_action: 'Review at next appointment',
      doctor_id: 'doctor-1',
      consultation_kind: 'general_consulting'
    });
    expect(res.status).toBe(201);
    expect(res.body.patient_id).toBe('patient-1');
    expect(res.body.call_type).toBe('pre-session');
    expect(Array.isArray(res.body.symptoms)).toBe(true);
    expect(res.body.doctor_id).toBe('doctor-1');
    expect(res.body.consultation_kind).toBe('general_consulting');
    expect(res.body.doctor_name).toBe('Dr. James Williams');
  });

  test('returns 400 when doctor_id is not a doctor profile', async () => {
    const res = await request(app).post('/api/healthcare/summaries').send({
      patient_id: 'patient-1',
      call_type: 'patient',
      doctor_id: 'patient-2'
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/doctor/);
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

  test('returns array including seeded demo summaries', async () => {
    const res = await request(app).get('/api/healthcare/summaries');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(4);
  });

  test('filters summaries by patient_id and doctor_id', async () => {
    const res = await request(app).get('/api/healthcare/summaries?patient_id=patient-1&doctor_id=doctor-1');
    expect(res.status).toBe(200);
    expect(res.body.every((s) => s.patient_id === 'patient-1' && s.doctor_id === 'doctor-1')).toBe(true);
    expect(res.body.map((s) => s.id)).toContain('seed-call-p1-1');
    expect(res.body.map((s) => s.id)).not.toContain('seed-call-p1-2');
  });

  test('filters summaries by doctor_id only', async () => {
    const res = await request(app).get('/api/healthcare/summaries?doctor_id=doctor-2');
    expect(res.status).toBe(200);
    expect(res.body.every((s) => s.doctor_id === 'doctor-2')).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
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

describe('POST /api/healthcare/appointments', () => {
  const app = makeApp();

  test('creates an appointment and returns 201', async () => {
    const res = await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-1',
      doctor_id: 'doctor-1',
      date_time: '2026-04-22T10:00:00.000Z',
      reason: 'Follow-up on blood pressure'
    });
    expect(res.status).toBe(201);
    expect(res.body.patient_id).toBe('patient-1');
    expect(res.body.doctor_id).toBe('doctor-1');
    expect(res.body.status).toBe('requested');
    expect(res.body.reason).toBe('Follow-up on blood pressure');
    expect(res.body.id).toBeDefined();
  });

  test('returns 400 when patient_id missing', async () => {
    const res = await request(app).post('/api/healthcare/appointments').send({
      doctor_id: 'doctor-1',
      date_time: '2026-04-22T10:00:00.000Z'
    });
    expect(res.status).toBe(400);
  });

  test('returns 400 when doctor_id missing', async () => {
    const res = await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-1',
      date_time: '2026-04-22T10:00:00.000Z'
    });
    expect(res.status).toBe(400);
  });

  test('returns 400 when date_time missing', async () => {
    const res = await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-1',
      doctor_id: 'doctor-1'
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/healthcare/appointments', () => {
  test('returns seeded demo appointments when listing all', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/healthcare/appointments');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    expect(res.body.map((a) => a.id).sort()).toEqual([
      'seed-appt-p1-1',
      'seed-appt-p1-2',
      'seed-appt-p2-1',
      'seed-appt-p2-2'
    ].sort());
  });

  test('filters by patient_id', async () => {
    const app = makeApp();
    await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-1', doctor_id: 'doctor-1',
      date_time: '2026-04-22T10:00:00.000Z', reason: 'Check-up'
    });
    await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-2', doctor_id: 'doctor-2',
      date_time: '2026-04-23T14:00:00.000Z', reason: 'Post-op'
    });

    const res = await request(app).get('/api/healthcare/appointments?patient_id=patient-1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.every((a) => a.patient_id === 'patient-1')).toBe(true);
  });

  test('filters by doctor_id', async () => {
    const app = makeApp();
    await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-1', doctor_id: 'doctor-1',
      date_time: '2026-04-22T10:00:00.000Z', reason: 'Check-up'
    });
    await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-2', doctor_id: 'doctor-2',
      date_time: '2026-04-23T14:00:00.000Z', reason: 'Post-op'
    });

    const res = await request(app).get('/api/healthcare/appointments?doctor_id=doctor-2');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.every((a) => a.doctor_id === 'doctor-2')).toBe(true);
  });

  test('includes patient_name and doctor_name via JOIN', async () => {
    const app = makeApp();
    await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-1', doctor_id: 'doctor-1',
      date_time: '2026-04-22T10:00:00.000Z', reason: 'Check-up'
    });
    const res = await request(app).get('/api/healthcare/appointments?patient_id=patient-1');
    expect(res.body[0].patient_name).toBe('Sarah Chen');
    expect(res.body[0].doctor_name).toBe('Dr. James Williams');
  });
});

describe('PUT /api/healthcare/appointments/:id', () => {
  const app = makeApp();

  test('confirms an appointment', async () => {
    const create = await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-1', doctor_id: 'doctor-1',
      date_time: '2026-04-22T10:00:00.000Z', reason: 'Check-up'
    });
    const res = await request(app)
      .put(`/api/healthcare/appointments/${create.body.id}`)
      .send({ status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
  });

  test('declines an appointment', async () => {
    const create = await request(app).post('/api/healthcare/appointments').send({
      patient_id: 'patient-1', doctor_id: 'doctor-1',
      date_time: '2026-04-22T10:00:00.000Z', reason: 'Check-up'
    });
    const res = await request(app)
      .put(`/api/healthcare/appointments/${create.body.id}`)
      .send({ status: 'declined' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('declined');
  });

  test('returns 404 for unknown appointment id', async () => {
    const res = await request(app)
      .put('/api/healthcare/appointments/bad-id')
      .send({ status: 'confirmed' });
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
