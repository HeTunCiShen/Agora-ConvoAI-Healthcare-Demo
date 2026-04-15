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
