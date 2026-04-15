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
