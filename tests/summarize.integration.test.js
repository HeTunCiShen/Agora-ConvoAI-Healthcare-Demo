// tests/summarize.integration.test.js
// Real LLM integration test — does NOT mock axios.
// Loads .env credentials and hits the actual OpenAI endpoint.
// Run with: npx jest tests/summarize.integration.test.js --testTimeout=30000

require('dotenv').config();

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
  app.post('/api/healthcare/summarize', ctrl.generateSummary);
  app.post('/api/healthcare/summaries', ctrl.createSummary);
  app.get('/api/healthcare/summaries', ctrl.listSummaries);
  return app;
}

const patientTranscript = [
  { role: 'user',      content: 'Hi, I have been having headaches and dizziness for two days.' },
  { role: 'assistant', content: 'I am sorry to hear that. Can you rate your pain from 1 to 10?' },
  { role: 'user',      content: 'About a 6. I checked my blood pressure and it was 142 over 88.' },
  { role: 'assistant', content: 'That is elevated. Are you currently taking any medications for blood pressure?' },
  { role: 'user',      content: 'I take lisinopril 10mg but I missed a dose yesterday.' }
];

const doctorTranscript = [
  { role: 'user',      content: 'What is the first-line treatment for stage 1 hypertension?' },
  { role: 'assistant', content: 'Lifestyle modifications first: DASH diet, sodium below 2.3g, aerobic exercise 150 min/week. If BP stays elevated after 3 months, start lisinopril 10mg or amlodipine 5mg.' },
  { role: 'user',      content: 'Any interactions with metformin?' },
  { role: 'assistant', content: 'No significant interaction between lisinopril and metformin. Monitor eGFR — ACE inhibitors can affect renal function.' }
];

describe('LLM connectivity check', () => {
  test('summarize LLM is configured in .env', () => {
    const url = process.env.SUMMARIZE_LLM_URL || process.env.LLM_URL;
    const key = process.env.SUMMARIZE_LLM_API_KEY || process.env.LLM_API_KEY;
    const model = process.env.SUMMARIZE_LLM_MODEL || process.env.LLM_MODEL;
    console.log('Summarize LLM URL:', url);
    console.log('Summarize LLM key:', key ? `${key.slice(0, 10)}...` : 'NOT SET');
    console.log('Summarize LLM model:', model);
    expect(url).toBeTruthy();
    expect(key).toBeTruthy();
  });
});

describe('Real LLM — patient transcript', () => {
  const app = makeApp();

  test('summarizes patient call and returns valid JSON structure', async () => {
    console.log('\n--- Sending patient transcript to LLM ---');
    const res = await request(app).post('/api/healthcare/summarize').send({
      transcript: patientTranscript,
      call_type: 'patient'
    });

    console.log('HTTP status:', res.status);
    console.log('Response body:', JSON.stringify(res.body, null, 2));

    expect(res.status).toBe(200);
    expect(res.body.call_type).toBe('patient');
    expect(typeof res.body.chief_complaint).toBe('string');
    expect(res.body.chief_complaint.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.symptoms)).toBe(true);
    expect(['low', 'medium', 'high']).toContain(res.body.urgency);
    expect(typeof res.body.ai_recommendation).toBe('string');
  }, 30000);
});

describe('Real LLM — doctor transcript', () => {
  const app = makeApp();

  test('summarizes doctor-query call and returns valid JSON structure', async () => {
    console.log('\n--- Sending doctor transcript to LLM ---');
    const res = await request(app).post('/api/healthcare/summarize').send({
      transcript: doctorTranscript,
      call_type: 'doctor-query'
    });

    console.log('HTTP status:', res.status);
    console.log('Response body:', JSON.stringify(res.body, null, 2));

    expect(res.status).toBe(200);
    expect(res.body.call_type).toBe('doctor-query');
    expect(typeof res.body.chief_complaint).toBe('string');
    expect(res.body.chief_complaint.length).toBeGreaterThan(0);
    expect(typeof res.body.ai_recommendation).toBe('string');
  }, 30000);
});

describe('Real LLM — full flow: summarize → save → retrieve', () => {
  const app = makeApp();

  test('saves real summary to DB and retrieves it', async () => {
    console.log('\n--- Full flow: summarize → save → retrieve ---');

    // Step 1: summarize
    const summarizeRes = await request(app).post('/api/healthcare/summarize').send({
      transcript: patientTranscript,
      call_type: 'patient'
    });
    console.log('Summarize status:', summarizeRes.status);
    expect(summarizeRes.status).toBe(200);

    // Step 2: save
    const saveRes = await request(app).post('/api/healthcare/summaries').send({
      patient_id: 'patient-1',
      ...summarizeRes.body
    });
    console.log('Save status:', saveRes.status);
    expect(saveRes.status).toBe(201);

    // Step 3: retrieve
    const feedRes = await request(app).get('/api/healthcare/summaries');
    const found = feedRes.body.find(s => s.id === saveRes.body.id);
    console.log('Found in feed:', !!found);
    console.log('Saved summary:', JSON.stringify(found, null, 2));
    expect(found).toBeDefined();
    expect(found.chief_complaint).toBeTruthy();
  }, 30000);
});
