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
