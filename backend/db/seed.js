// backend/db/seed.js
const PROFILES = [
  {
    id: 'patient-1', role: 'patient', name: 'Sarah Chen', avatar: 'SC', age: 34,
    specialty: null, hospital: null,
    condition: 'Hypertension, mild anxiety',
    medications: JSON.stringify(['Lisinopril 10mg', 'Propranolol 20mg']),
    next_appointment: null,
    assigned_doctor: null,
    phone_number: '+61 400 000 001',
    extra_details: JSON.stringify({
      medical_history: 'Hypertension diagnosed 2021. Anxiety disorder diagnosed 2022.',
      allergies: 'Penicillin',
      blood_type: 'A+',
      emergency_contact: 'Michael Chen (husband) — +61 400 111 222'
    })
  },
  {
    id: 'patient-2', role: 'patient', name: 'Marcus Johnson', avatar: 'MJ', age: 52,
    specialty: null, hospital: null,
    condition: 'Post-knee-surgery recovery',
    medications: JSON.stringify(['Tramadol 50mg', 'Aspirin 100mg']),
    next_appointment: null,
    assigned_doctor: null,
    phone_number: '+61 400 000 002',
    extra_details: JSON.stringify({
      medical_history: 'Right knee replacement Apr 10 2026. Type 2 diabetes (controlled).',
      allergies: 'None known',
      blood_type: 'O+',
      emergency_contact: 'Linda Johnson (wife) — +61 400 333 444'
    })
  },
  {
    id: 'doctor-1', role: 'doctor', name: 'Dr. James Williams', avatar: 'JW', age: null,
    specialty: 'Cardiologist', hospital: 'Sydney General Hospital',
    condition: null, medications: null, next_appointment: null, assigned_doctor: null,
    phone_number: null,
    extra_details: JSON.stringify({
      experience: '12 years',
      languages: ['English', 'Mandarin'],
      qualifications: 'MBBS (Sydney), FRACP (Cardiology)',
      bio: 'Specialises in cardiovascular disease prevention and hypertension management.',
      patients: ['Sarah Chen']
    })
  },
  {
    id: 'doctor-2', role: 'doctor', name: 'Dr. Priya Patel', avatar: 'PP', age: null,
    specialty: 'Orthopaedic Surgeon', hospital: 'Sydney General Hospital',
    condition: null, medications: null, next_appointment: null, assigned_doctor: null,
    phone_number: null,
    extra_details: JSON.stringify({
      experience: '9 years',
      languages: ['English', 'Hindi'],
      qualifications: 'MBBS (Melbourne), FRACS (Orthopaedics)',
      bio: 'Specialises in joint replacement surgery and post-operative rehabilitation.',
      patients: ['Marcus Johnson']
    })
  },
  {
    id: 'doctor-3', role: 'doctor', name: 'Dr. Emily Nguyen', avatar: 'EN', age: null,
    specialty: 'General Practitioner', hospital: 'Sunrise Medical Centre',
    condition: null, medications: null, next_appointment: null, assigned_doctor: null,
    phone_number: null,
    extra_details: JSON.stringify({
      experience: '7 years',
      languages: ['English', 'Vietnamese'],
      qualifications: 'MBBS (UNSW), FRACGP',
      bio: 'Family medicine with a focus on preventive care and chronic disease management.'
    })
  },
  {
    id: 'doctor-4', role: 'doctor', name: 'Dr. Amir Hassan', avatar: 'AH', age: null,
    specialty: 'Neurologist', hospital: 'Sydney General Hospital',
    condition: null, medications: null, next_appointment: null, assigned_doctor: null,
    phone_number: null,
    extra_details: JSON.stringify({
      experience: '15 years',
      languages: ['English', 'Arabic'],
      qualifications: 'MBBS (Cairo), PhD Neuroscience (Oxford), FRACP (Neurology)',
      bio: 'Specialises in headache disorders, epilepsy, and neurodegenerative conditions.'
    })
  }
];

const SAMPLE_CARE_PLAN = {
  id: 'plan-1',
  patient_id: 'patient-2',
  plan_text: JSON.stringify([
    { days: 'Day 1–3', instructions: 'Rest, elevate leg, ice pack 20 min every 2 hours. Tramadol 50mg every 6 hours as needed.' },
    { days: 'Day 4–7', instructions: 'Gentle range-of-motion exercises. Walking 10–15 min twice daily. Aspirin 100mg daily.' },
    { days: 'Day 8–14', instructions: 'Increase walking to 30 min. Physiotherapy begins. Reduce Tramadol as pain permits.' },
    { days: 'Day 14+', instructions: 'Follow-up appointment. Assess wound healing. Continue physiotherapy.' }
  ]),
  status: 'pending-review',
  doctor_notes: '',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

/** Fixed IDs so `INSERT OR IGNORE` stays idempotent across deploys / server restarts. */
const MOCK_CALL_SUMMARIES = [
  {
    id: 'seed-call-p1-1',
    patient_id: 'patient-1',
    call_type: 'patient',
    chief_complaint: 'Evening blood pressure higher than usual',
    symptoms: ['tension headache', 'work stress'],
    vitals_mentioned: { bp_home: '138/86 mmHg', pulse: '76 bpm' },
    medications_discussed: ['Lisinopril 10mg', 'Propranolol 20mg'],
    ai_recommendation: 'Reinforce home BP diary; continue current doses unless systolic stays above 140 for a week.',
    urgency: 'low',
    transcript_excerpt: 'Discussed evening spikes after desk work and sleep hygiene.',
    suggested_action: 'Share BP log at next cardiology visit.',
    transcript: [
      { role: 'user', content: 'My home cuff reads high after dinner most nights.' },
      { role: 'assistant', content: 'Let us review timing of doses and sodium intake.' }
    ],
    created_at: '2026-04-02T22:30:00.000Z',
    doctor_id: 'doctor-1',
    consultation_kind: 'condition_followup'
  },
  {
    id: 'seed-call-p1-2',
    patient_id: 'patient-1',
    call_type: 'condition-check',
    chief_complaint: 'Mild dizziness when standing quickly',
    symptoms: ['orthostatic lightheadedness'],
    vitals_mentioned: { bp_seated: '128/80', bp_standing: '108/70' },
    medications_discussed: ['Propranolol'],
    ai_recommendation: 'Rise slowly from seated position; hydrate; monitor if symptoms worsen.',
    urgency: 'medium',
    transcript_excerpt: 'Symptoms started after dose increase discussion with GP.',
    suggested_action: 'Contact prescriber if dizziness persists beyond 48 hours.',
    transcript: [
      { role: 'user', content: 'I get woozy for a few seconds when I stand up fast.' },
      { role: 'assistant', content: 'That can happen with beta-blockers. Try ankle pumps before standing.' }
    ],
    created_at: '2026-04-12T14:05:00.000Z',
    doctor_id: 'doctor-3',
    consultation_kind: 'general_consulting'
  },
  {
    id: 'seed-call-p2-1',
    patient_id: 'patient-2',
    call_type: 'post-op',
    chief_complaint: 'Knee swelling two weeks after replacement',
    symptoms: ['mild swelling', 'stiffness after long walks'],
    vitals_mentioned: {},
    medications_discussed: ['Tramadol 50mg PRN', 'Aspirin 100mg'],
    ai_recommendation: 'Continue elevation and ice after activity; stay within physiotherapy walking targets.',
    urgency: 'medium',
    transcript_excerpt: 'Swelling improves overnight; no fever or wound drainage reported.',
    suggested_action: 'Orthopaedic nurse callback if redness or fever develops.',
    transcript: [
      { role: 'user', content: 'The knee puffs up by dinner but looks normal in the morning.' },
      { role: 'assistant', content: 'That pattern is common. Ice 15 minutes after walks.' }
    ],
    created_at: '2026-04-08T01:20:00.000Z',
    doctor_id: 'doctor-2',
    consultation_kind: 'post_op_call'
  },
  {
    id: 'seed-call-p2-2',
    patient_id: 'patient-2',
    call_type: 'patient',
    chief_complaint: 'Sleep disruption from post-op discomfort',
    symptoms: ['night pain', 'difficulty finding comfortable position'],
    vitals_mentioned: {},
    medications_discussed: ['Tramadol'],
    ai_recommendation: 'Stagger analgesia with physio schedule; consider pillow between knees side-lying.',
    urgency: 'low',
    transcript_excerpt: 'Pain 4/10 at night, manageable with current PRN dosing.',
    suggested_action: 'Discuss sleep positioning at next physio session.',
    transcript: [
      { role: 'user', content: 'I wake up every few hours because of the knee.' },
      { role: 'assistant', content: 'We can time your pain relief before bedtime.' }
    ],
    created_at: '2026-04-15T10:45:00.000Z',
    doctor_id: 'doctor-2',
    consultation_kind: 'general_consulting'
  }
];

const MOCK_APPOINTMENTS = [
  {
    id: 'seed-appt-p1-1',
    patient_id: 'patient-1',
    doctor_id: 'doctor-1',
    date_time: '2026-04-28T10:00:00.000Z',
    status: 'confirmed',
    reason: 'Hypertension follow-up and home BP review',
    created_at: '2026-04-01T08:00:00.000Z',
    updated_at: '2026-04-01T08:00:00.000Z'
  },
  {
    id: 'seed-appt-p1-2',
    patient_id: 'patient-1',
    doctor_id: 'doctor-3',
    date_time: '2026-05-06T14:30:00.000Z',
    status: 'requested',
    reason: 'Annual GP check-up and medication review',
    created_at: '2026-04-10T11:00:00.000Z',
    updated_at: '2026-04-10T11:00:00.000Z'
  },
  {
    id: 'seed-appt-p2-1',
    patient_id: 'patient-2',
    doctor_id: 'doctor-2',
    date_time: '2026-04-22T11:00:00.000Z',
    status: 'confirmed',
    reason: 'Post-operative knee review and wound check',
    created_at: '2026-04-03T09:30:00.000Z',
    updated_at: '2026-04-03T09:30:00.000Z'
  },
  {
    id: 'seed-appt-p2-2',
    patient_id: 'patient-2',
    doctor_id: 'doctor-2',
    date_time: '2026-05-01T09:30:00.000Z',
    status: 'requested',
    reason: 'Physiotherapy progress review before return to work',
    created_at: '2026-04-11T16:20:00.000Z',
    updated_at: '2026-04-11T16:20:00.000Z'
  }
];

function seed(db) {
  const insertProfile = db.prepare(`
    INSERT OR IGNORE INTO profiles
    (id, role, name, avatar, age, specialty, hospital, condition, medications,
     next_appointment, assigned_doctor, phone_number, extra_details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPlan = db.prepare(`
    INSERT OR IGNORE INTO care_plans
    (id, patient_id, plan_text, status, doctor_notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertCallSummary = db.prepare(`
    INSERT OR IGNORE INTO call_summaries
    (id, patient_id, call_type, chief_complaint, symptoms, vitals_mentioned,
     medications_discussed, ai_recommendation, urgency, transcript_excerpt, suggested_action, transcript, created_at,
     doctor_id, consultation_kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAppointment = db.prepare(`
    INSERT OR IGNORE INTO appointments
    (id, patient_id, doctor_id, date_time, status, reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const syncMockCallDoctor = db.prepare(`
    UPDATE call_summaries SET doctor_id = ?, consultation_kind = ? WHERE id = ?
  `);

  db.transaction(() => {
    for (const p of PROFILES) {
      insertProfile.run(
        p.id, p.role, p.name, p.avatar, p.age, p.specialty, p.hospital,
        p.condition, p.medications, p.next_appointment, p.assigned_doctor,
        p.phone_number, p.extra_details
      );
    }
    insertPlan.run(
      SAMPLE_CARE_PLAN.id, SAMPLE_CARE_PLAN.patient_id, SAMPLE_CARE_PLAN.plan_text,
      SAMPLE_CARE_PLAN.status, SAMPLE_CARE_PLAN.doctor_notes,
      SAMPLE_CARE_PLAN.created_at, SAMPLE_CARE_PLAN.updated_at
    );
    for (const c of MOCK_CALL_SUMMARIES) {
      insertCallSummary.run(
        c.id,
        c.patient_id,
        c.call_type,
        c.chief_complaint,
        JSON.stringify(c.symptoms),
        JSON.stringify(c.vitals_mentioned),
        JSON.stringify(c.medications_discussed),
        c.ai_recommendation,
        c.urgency,
        c.transcript_excerpt,
        c.suggested_action,
        JSON.stringify(c.transcript),
        c.created_at,
        c.doctor_id || null,
        c.consultation_kind || null
      );
      syncMockCallDoctor.run(c.doctor_id || null, c.consultation_kind || null, c.id);
    }
    for (const a of MOCK_APPOINTMENTS) {
      insertAppointment.run(
        a.id,
        a.patient_id,
        a.doctor_id,
        a.date_time,
        a.status,
        a.reason,
        a.created_at,
        a.updated_at
      );
    }
  })();
}

if (require.main === module) {
  const path = require('path');
  const { createDb } = require('./database');
  const db = createDb(path.join(__dirname, 'healthcare.db'));
  seed(db);
  console.log('Demo data seeded.');
  db.close();
}

module.exports = { seed };
