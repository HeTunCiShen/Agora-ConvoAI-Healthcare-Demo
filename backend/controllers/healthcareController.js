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
    const { patient_id } = req.query;
    const rows = patient_id
      ? db.prepare(`
          SELECT cs.*, p.name AS patient_name
          FROM call_summaries cs
          LEFT JOIN profiles p ON cs.patient_id = p.id
          WHERE cs.patient_id = ?
          ORDER BY cs.created_at DESC
        `).all(patient_id)
      : db.prepare(`
          SELECT cs.*, p.name AS patient_name
          FROM call_summaries cs
          LEFT JOIN profiles p ON cs.patient_id = p.id
          ORDER BY cs.created_at DESC
        `).all();
    rows.forEach(r => parseJsonFields(r, ['symptoms', 'vitals_mentioned', 'medications_discussed', 'transcript']));
    res.json(rows);
  }

  function createSummary(req, res) {
    const {
      patient_id, call_type, chief_complaint, symptoms, vitals_mentioned,
      medications_discussed, ai_recommendation, urgency, transcript_excerpt, suggested_action, transcript
    } = req.body;

    if (!patient_id || !call_type) {
      return res.status(400).json({ error: 'patient_id and call_type are required' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO call_summaries
      (id, patient_id, call_type, chief_complaint, symptoms, vitals_mentioned,
       medications_discussed, ai_recommendation, urgency, transcript_excerpt, suggested_action, transcript, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, patient_id, call_type, chief_complaint || '',
      JSON.stringify(symptoms || []),
      JSON.stringify(vitals_mentioned || {}),
      JSON.stringify(medications_discussed || []),
      ai_recommendation || '', urgency || 'low',
      transcript_excerpt || '', suggested_action || '',
      JSON.stringify(transcript || []), now
    );

    const summary = db.prepare('SELECT * FROM call_summaries WHERE id = ?').get(id);
    parseJsonFields(summary, ['symptoms', 'vitals_mentioned', 'medications_discussed', 'transcript']);

    const patient = db.prepare('SELECT name FROM profiles WHERE id = ?').get(patient_id);
    sse.broadcast('new_summary', { summary: { ...summary, patient_name: patient?.name || 'Unknown' } });

    // Fire-and-forget: regenerate the patient's consolidated profile summary
    regenerateProfileSummary(patient_id).catch(e =>
      console.error('[createSummary] profile summary regeneration failed:', e.message));

    res.status(201).json(summary);
  }

  // ===========================
  // PATIENT PROFILE SUMMARY
  // ===========================
  async function regenerateProfileSummary(patientId) {
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(patientId);
    if (!profile) return;
    parseJsonFields(profile, ['medications', 'extra_details']);

    const calls = db.prepare(`
      SELECT * FROM call_summaries WHERE patient_id = ? ORDER BY created_at ASC
    `).all(patientId);
    calls.forEach(r => parseJsonFields(r, ['symptoms', 'vitals_mentioned', 'medications_discussed']));

    if (calls.length === 0) return;

    const meds = Array.isArray(profile.medications) ? profile.medications.join(', ') : profile.medications || 'None';
    const callDigest = calls.map((c, i) => {
      const symptoms = Array.isArray(c.symptoms) ? c.symptoms.join(', ') : '';
      const medsDisc = Array.isArray(c.medications_discussed) ? c.medications_discussed.join(', ') : '';
      return `Call ${i + 1} (${c.call_type}, ${c.created_at}): Chief complaint: ${c.chief_complaint || 'n/a'}. Symptoms: ${symptoms || 'n/a'}. Meds discussed: ${medsDisc || 'n/a'}. AI recommendation: ${c.ai_recommendation || 'n/a'}. Urgency: ${c.urgency}. Suggested action: ${c.suggested_action || 'n/a'}`;
    }).join('\n');

    const llmUrl = process.env.SUMMARIZE_LLM_URL || process.env.LLM_URL;
    const llmKey = process.env.SUMMARIZE_LLM_API_KEY || process.env.LLM_API_KEY;
    const llmModel = process.env.SUMMARIZE_LLM_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini';

    if (!llmUrl || !llmKey) {
      console.warn('[profileSummary] no LLM configured, skipping');
      return;
    }

    const prompt = `You are a clinical documentation assistant. Given a patient's profile and their complete call history, produce a concise clinical summary (max 300 words) that an AI assistant can use as context for the next conversation.

Include:
- Patient overview (name, age, conditions, current medications)
- Key findings and patterns across all calls
- Current status and any ongoing concerns
- Important recommendations that were given
- Any follow-up actions still pending

Patient profile:
Name: ${profile.name}, Age: ${profile.age}, Conditions: ${profile.condition || 'None'}, Medications: ${meds}

Call history (${calls.length} calls):
${callDigest}

Return ONLY the summary text, no JSON, no markdown, no headers.`;

    console.log(`[profileSummary] regenerating for ${patientId}, ${calls.length} calls`);

    const requestBody = {
      model: llmModel,
      messages: [
        { role: 'system', content: 'You are a concise clinical documentation assistant.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 500,
      temperature: 0.2
    };
    const requestConfig = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmKey}`
      },
      timeout: 30000
    };

    // Retry up to 3 times with backoff for rate limits (429)
    let response;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await axios.post(llmUrl, requestBody, requestConfig);
        break;
      } catch (e) {
        if (e.response?.status === 429 && attempt < 3) {
          const delay = attempt * 3000;
          console.log(`[profileSummary] rate limited, retrying in ${delay}ms (attempt ${attempt}/3)`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw e;
        }
      }
    }

    const summaryText = response.data.choices[0].message.content.trim();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO patient_profile_summaries (patient_id, summary_text, call_count, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(patient_id) DO UPDATE SET
        summary_text = excluded.summary_text,
        call_count = excluded.call_count,
        updated_at = excluded.updated_at
    `).run(patientId, summaryText, calls.length, now);

    console.log(`[profileSummary] saved for ${patientId} (${calls.length} calls, ${summaryText.length} chars)`);
  }

  function getProfileSummary(req, res) {
    const { patientId } = req.params;
    const row = db.prepare('SELECT * FROM patient_profile_summaries WHERE patient_id = ?').get(patientId);
    if (!row) return res.status(404).json({ error: 'No profile summary yet' });
    res.json(row);
  }

  // ===========================
  // APPOINTMENTS
  // ===========================
  function listAppointments(req, res) {
    const { patient_id, doctor_id } = req.query;
    let rows;
    if (patient_id) {
      rows = db.prepare(`
        SELECT a.*, p.name AS patient_name, d.name AS doctor_name
        FROM appointments a
        LEFT JOIN profiles p ON a.patient_id = p.id
        LEFT JOIN profiles d ON a.doctor_id = d.id
        WHERE a.patient_id = ?
        ORDER BY a.date_time ASC
      `).all(patient_id);
    } else if (doctor_id) {
      rows = db.prepare(`
        SELECT a.*, p.name AS patient_name, d.name AS doctor_name
        FROM appointments a
        LEFT JOIN profiles p ON a.patient_id = p.id
        LEFT JOIN profiles d ON a.doctor_id = d.id
        WHERE a.doctor_id = ?
        ORDER BY a.date_time ASC
      `).all(doctor_id);
    } else {
      rows = db.prepare(`
        SELECT a.*, p.name AS patient_name, d.name AS doctor_name
        FROM appointments a
        LEFT JOIN profiles p ON a.patient_id = p.id
        LEFT JOIN profiles d ON a.doctor_id = d.id
        ORDER BY a.date_time ASC
      `).all();
    }
    res.json(rows);
  }

  function createAppointment(req, res) {
    const { patient_id, doctor_id, date_time, reason } = req.body;

    if (!patient_id || !doctor_id || !date_time) {
      return res.status(400).json({ error: 'patient_id, doctor_id, and date_time are required' });
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

  function updateAppointment(req, res) {
    const { id } = req.params;
    const { status } = req.body;

    const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    const now = new Date().toISOString();
    db.prepare('UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?')
      .run(status || appointment.status, now, id);

    const updated = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);

    sse.broadcast('appointment_updated', { appointment: updated });

    res.json(updated);
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
{"call_type":"doctor-query","chief_complaint":"clinical topic or question discussed","ai_recommendation":"key answer or recommendation given","transcript_excerpt":"most important 1-2 sentence exchange","suggested_action":"follow-up action if any, otherwise empty string","urgency":"low","related_doctor_name":""}`
      : `You are a clinical documentation assistant. Given a conversation transcript between a patient and an AI medical assistant, return ONLY a valid JSON object (no markdown, no explanation) with these exact fields:
{"call_type":"pre-session|condition-check|post-session|post-op","chief_complaint":"main reason for the call","symptoms":[],"vitals_mentioned":{},"medications_discussed":[],"ai_recommendation":"what the AI recommended","urgency":"low|medium|high","transcript_excerpt":"most important 1-2 sentence exchange","suggested_action":"what the doctor should do","related_doctor_name":"name of the specific doctor discussed or empty string if none","appointment_requests":[]}
If the patient discussed or requested appointments with doctors, add each one to appointment_requests as: {"doctor_name":"full doctor name","date_time":"ISO 8601 datetime","reason":"reason for appointment"}. Multiple appointments in one call are common. Leave as empty array if no appointments discussed.`;

    const conversationText = transcript
      .map(m => `${m.role === 'assistant' ? 'AI' : speakerLabel}: ${m.content}`)
      .join('\n');

    // SUMMARIZE_LLM_* vars override LLM_* — allows a different model/provider
    // just for post-call summarization (e.g. Kimi in China vs OpenAI for conversation)
    const llmUrl = process.env.SUMMARIZE_LLM_URL || process.env.LLM_URL;
    const llmKey = process.env.SUMMARIZE_LLM_API_KEY || process.env.LLM_API_KEY;
    const llmModel = process.env.SUMMARIZE_LLM_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini';

    if (!llmUrl || !llmKey) {
      console.warn('[summarize] no LLM URL/key configured (set SUMMARIZE_LLM_URL or LLM_URL)');
      return res.status(503).json({ error: 'LLM not configured' });
    }

    console.log(`[summarize] calling LLM at ${llmUrl} model=${llmModel}`);

    try {
      const response = await axios.post(
        llmUrl,
        {
          model: llmModel,
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
            'Authorization': `Bearer ${llmKey}`
          },
          timeout: 30000
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

  return { getProfile, listProfiles, listSummaries, createSummary, generateSummary, getProfileSummary, listAppointments, createAppointment, updateAppointment, getCarePlan, updateCarePlan, sseStream };
}

module.exports = { makeHealthcareController };
