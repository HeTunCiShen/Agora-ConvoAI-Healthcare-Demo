// tests/summarize.test.js
// Tests the POST /api/healthcare/summarize endpoint end-to-end:
//   1. Validation errors
//   2. Patient call summarization (mocked LLM)
//   3. Doctor call summarization (mocked LLM)
//   4. LLM returns markdown-wrapped JSON (fence stripping)
//   5. Full flow: summarize → save → appears in GET /api/healthcare/summaries

const request = require('supertest');
const express = require('express');
const axios = require('axios');
const { createDb } = require('../backend/db/database');
const { seed } = require('../backend/db/seed');
const { makeHealthcareController } = require('../backend/controllers/healthcareController');
const sse = require('../backend/sse');

jest.mock('axios');

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

// Sample transcripts
const patientTranscript = [
  { role: 'user',      content: 'Hi, I have been having a headache and some dizziness for the past two days.' },
  { role: 'assistant', content: 'I am sorry to hear that. Can you rate the pain on a scale of 1 to 10?' },
  { role: 'user',      content: 'Around a 6. I am also taking ibuprofen but it is not helping much.' },
  { role: 'assistant', content: 'Have you noticed any changes in your blood pressure recently?' },
  { role: 'user',      content: 'Yes actually, it was 142 over 88 this morning.' }
];

const doctorTranscript = [
  { role: 'user',      content: 'What is the recommended first-line treatment for stage 1 hypertension?' },
  { role: 'assistant', content: 'For stage 1 hypertension, lifestyle modifications are first-line: DASH diet, sodium restriction below 2.3g daily, aerobic exercise. If BP remains elevated after 3 months, consider starting lisinopril 10mg or amlodipine 5mg.' },
  { role: 'user',      content: 'What about drug interactions with metformin?' },
  { role: 'assistant', content: 'No significant interaction between lisinopril and metformin. ACE inhibitors can rarely cause lactic acidosis risk in renal impairment — check eGFR before starting.' }
];

const mockPatientSummary = {
  call_type: 'condition-check',
  chief_complaint: 'Persistent headache and dizziness for two days',
  symptoms: ['headache', 'dizziness'],
  vitals_mentioned: { bp: '142/88' },
  medications_discussed: ['ibuprofen'],
  ai_recommendation: 'Monitor blood pressure closely and follow up with doctor',
  urgency: 'medium',
  transcript_excerpt: 'Patient reported BP of 142/88 and pain level 6.',
  suggested_action: 'Review hypertension management at next appointment'
};

const mockDoctorSummary = {
  call_type: 'doctor-query',
  chief_complaint: 'First-line treatment for stage 1 hypertension and drug interactions',
  ai_recommendation: 'Lifestyle modifications first; lisinopril or amlodipine if needed. Check eGFR with metformin.',
  transcript_excerpt: 'Doctor asked about hypertension treatment and metformin interaction.',
  suggested_action: '',
  urgency: 'low'
};

function mockLlmResponse(summary) {
  axios.post.mockResolvedValue({
    data: { choices: [{ message: { content: JSON.stringify(summary) } }] }
  });
}

describe('POST /api/healthcare/summarize — validation', () => {
  const app = makeApp();

  beforeEach(() => {
    process.env.LLM_URL = 'https://api.test/v1/chat/completions';
    process.env.LLM_API_KEY = 'test-key';
  });

  test('returns 400 when transcript is missing', async () => {
    const res = await request(app).post('/api/healthcare/summarize').send({ call_type: 'patient' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/transcript/);
  });

  test('returns 400 when transcript is empty array', async () => {
    const res = await request(app).post('/api/healthcare/summarize').send({ transcript: [], call_type: 'patient' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when call_type is missing', async () => {
    const res = await request(app).post('/api/healthcare/summarize').send({ transcript: patientTranscript });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/call_type/);
  });

  test('returns 503 when LLM_URL is not configured', async () => {
    delete process.env.LLM_URL;
    const res = await request(app).post('/api/healthcare/summarize').send({ transcript: patientTranscript, call_type: 'patient' });
    expect(res.status).toBe(503);
  });
});

describe('POST /api/healthcare/summarize — patient call', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LLM_URL = 'https://api.test/v1/chat/completions';
    process.env.LLM_API_KEY = 'test-key';
    mockLlmResponse(mockPatientSummary);
  });

  test('calls LLM and returns structured patient summary', async () => {
    const res = await request(app).post('/api/healthcare/summarize').send({
      transcript: patientTranscript,
      call_type: 'patient'
    });

    expect(res.status).toBe(200);
    expect(res.body.call_type).toBe('patient');          // enforced, not from LLM
    expect(res.body.chief_complaint).toBeTruthy();
    expect(Array.isArray(res.body.symptoms)).toBe(true);
    expect(typeof res.body.vitals_mentioned).toBe('object');
    expect(Array.isArray(res.body.medications_discussed)).toBe(true);
    expect(res.body.urgency).toMatch(/^(low|medium|high)$/);
  });

  test('call_type in response is always the value sent, not what LLM returned', async () => {
    // LLM returns 'condition-check' but we sent 'patient' — should be overridden
    const res = await request(app).post('/api/healthcare/summarize').send({
      transcript: patientTranscript,
      call_type: 'patient'
    });
    expect(res.body.call_type).toBe('patient');
  });

  test('sends transcript as LLM user message with Patient: label', async () => {
    await request(app).post('/api/healthcare/summarize').send({
      transcript: patientTranscript,
      call_type: 'patient'
    });

    const llmPayload = axios.post.mock.calls[0][1];
    const userMsg = llmPayload.messages.find(m => m.role === 'user');
    expect(userMsg.content).toContain('Patient:');
    expect(userMsg.content).toContain('AI:');
  });
});

describe('POST /api/healthcare/summarize — doctor call', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LLM_URL = 'https://api.test/v1/chat/completions';
    process.env.LLM_API_KEY = 'test-key';
    mockLlmResponse(mockDoctorSummary);
  });

  test('returns doctor-query summary with correct call_type', async () => {
    const res = await request(app).post('/api/healthcare/summarize').send({
      transcript: doctorTranscript,
      call_type: 'doctor-query'
    });

    expect(res.status).toBe(200);
    expect(res.body.call_type).toBe('doctor-query');
    expect(res.body.chief_complaint).toBeTruthy();
    expect(res.body.ai_recommendation).toBeTruthy();
  });

  test('sends transcript with Doctor: label, not Patient:', async () => {
    await request(app).post('/api/healthcare/summarize').send({
      transcript: doctorTranscript,
      call_type: 'doctor-query'
    });

    const llmPayload = axios.post.mock.calls[0][1];
    const userMsg = llmPayload.messages.find(m => m.role === 'user');
    expect(userMsg.content).toContain('Doctor:');
    expect(userMsg.content).not.toContain('Patient:');
  });
});

describe('POST /api/healthcare/summarize — LLM edge cases', () => {
  const app = makeApp();

  beforeEach(() => {
    process.env.LLM_URL = 'https://api.test/v1/chat/completions';
    process.env.LLM_API_KEY = 'test-key';
  });

  test('handles LLM response wrapped in markdown code fences', async () => {
    axios.post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: '```json\n' + JSON.stringify(mockPatientSummary) + '\n```'
          }
        }]
      }
    });

    const res = await request(app).post('/api/healthcare/summarize').send({
      transcript: patientTranscript,
      call_type: 'patient'
    });

    expect(res.status).toBe(200);
    expect(res.body.chief_complaint).toBeTruthy();
  });

  test('returns 500 when LLM call fails', async () => {
    axios.post.mockRejectedValue(new Error('Network error'));

    const res = await request(app).post('/api/healthcare/summarize').send({
      transcript: patientTranscript,
      call_type: 'patient'
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });

  test('returns 500 when LLM returns invalid JSON', async () => {
    axios.post.mockResolvedValue({
      data: { choices: [{ message: { content: 'not valid json at all' } }] }
    });

    const res = await request(app).post('/api/healthcare/summarize').send({
      transcript: patientTranscript,
      call_type: 'patient'
    });

    expect(res.status).toBe(500);
  });
});

describe('Full flow: summarize → save → appears in feed', () => {
  // Uses a single app instance so DB is shared across steps
  const app = makeApp();

  beforeEach(() => {
    process.env.LLM_URL = 'https://api.test/v1/chat/completions';
    process.env.LLM_API_KEY = 'test-key';
  });

  test('patient call: summarize, save, and retrieve from GET /summaries', async () => {
    mockLlmResponse(mockPatientSummary);

    // Step 1: generate summary
    const summarizeRes = await request(app).post('/api/healthcare/summarize').send({
      transcript: patientTranscript,
      call_type: 'patient'
    });
    expect(summarizeRes.status).toBe(200);

    const summary = summarizeRes.body;

    // Step 2: save to DB
    const saveRes = await request(app).post('/api/healthcare/summaries').send({
      patient_id: 'patient-1',
      ...summary
    });
    expect(saveRes.status).toBe(201);
    expect(saveRes.body.patient_id).toBe('patient-1');
    expect(saveRes.body.call_type).toBe('patient');

    // Step 3: verify it appears in the feed
    const feedRes = await request(app).get('/api/healthcare/summaries');
    expect(feedRes.status).toBe(200);
    const saved = feedRes.body.find(s => s.id === saveRes.body.id);
    expect(saved).toBeDefined();
    expect(saved.chief_complaint).toBe(mockPatientSummary.chief_complaint);
    expect(Array.isArray(saved.symptoms)).toBe(true);
  });

  test('doctor call: summarize, save, and retrieve from GET /summaries', async () => {
    mockLlmResponse(mockDoctorSummary);

    // Step 1: generate summary
    const summarizeRes = await request(app).post('/api/healthcare/summarize').send({
      transcript: doctorTranscript,
      call_type: 'doctor-query'
    });
    expect(summarizeRes.status).toBe(200);

    // Step 2: save to DB (using doctor's profile id as patient_id)
    const saveRes = await request(app).post('/api/healthcare/summaries').send({
      patient_id: 'doctor-1',
      ...summarizeRes.body
    });
    expect(saveRes.status).toBe(201);
    expect(saveRes.body.call_type).toBe('doctor-query');

    // Step 3: verify it appears in the feed
    const feedRes = await request(app).get('/api/healthcare/summaries');
    const saved = feedRes.body.find(s => s.id === saveRes.body.id);
    expect(saved).toBeDefined();
    expect(saved.call_type).toBe('doctor-query');
  });
});
