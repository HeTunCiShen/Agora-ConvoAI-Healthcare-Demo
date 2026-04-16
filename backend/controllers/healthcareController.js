// backend/controllers/healthcareController.js
const { randomUUID } = require('crypto');
const axios = require('axios');

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

  async function generateSummary(req, res) {
    const { transcript, call_type } = req.body;

    if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
      return res.status(400).json({ error: 'transcript array is required' });
    }
    if (!call_type) {
      return res.status(400).json({ error: 'call_type is required' });
    }

    console.log(`[summarize] call_type=${call_type}, transcript_messages=${transcript.length}`);

    const isDoctor = call_type === 'doctor-query';
    const speakerLabel = isDoctor ? 'Doctor' : 'Patient';

    const systemPrompt = isDoctor
      ? `You are a clinical documentation assistant. Given a conversation transcript between a doctor and an AI clinical assistant, return ONLY a valid JSON object (no markdown, no explanation) with these exact fields:
{"call_type":"doctor-query","chief_complaint":"clinical topic or question discussed","ai_recommendation":"key answer or recommendation given","transcript_excerpt":"most important 1-2 sentence exchange","suggested_action":"follow-up action if any, otherwise empty string","urgency":"low"}`
      : `You are a clinical documentation assistant. Given a conversation transcript between a patient and an AI medical assistant, return ONLY a valid JSON object (no markdown, no explanation) with these exact fields:
{"call_type":"pre-session|condition-check|post-session|post-op","chief_complaint":"main reason for the call","symptoms":[],"vitals_mentioned":{},"medications_discussed":[],"ai_recommendation":"what the AI recommended","urgency":"low|medium|high","transcript_excerpt":"most important 1-2 sentence exchange","suggested_action":"what the doctor should do"}`;

    const conversationText = transcript
      .map(m => `${m.role === 'assistant' ? 'AI' : speakerLabel}: ${m.content}`)
      .join('\n');

    if (!process.env.LLM_URL || !process.env.LLM_API_KEY) {
      console.warn('[summarize] LLM_URL or LLM_API_KEY not configured');
      return res.status(503).json({ error: 'LLM not configured' });
    }

    console.log(`[summarize] calling LLM at ${process.env.LLM_URL}`);

    try {
      const response = await axios.post(
        process.env.LLM_URL,
        {
          model: process.env.LLM_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Transcript:\n${conversationText}` }
          ],
          max_tokens: 500,
          temperature: 0.2
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.LLM_API_KEY}`
          },
          timeout: 15000
        }
      );

      const raw = response.data.choices[0].message.content.trim();
      console.log(`[summarize] LLM raw response: ${raw}`);

      // Strip markdown code fences if model adds them
      const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      const summary = JSON.parse(jsonStr);
      // Ensure call_type is correct regardless of what the LLM returns
      console.log(`[summarize] parsed summary ok, urgency=${summary.urgency}`);
      res.json({ ...summary, call_type });
    } catch (e) {
      console.error('[summarize] LLM error:', e.response?.data || e.message);
      res.status(500).json({ error: 'Failed to generate summary', details: e.message });
    }
  }

  function sseStream(req, res) {
    sse.addClient(res);
  }

  return { getProfile, listProfiles, listSummaries, createSummary, generateSummary, getCarePlan, updateCarePlan, sseStream };
}

module.exports = { makeHealthcareController };
