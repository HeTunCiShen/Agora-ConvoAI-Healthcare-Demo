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
