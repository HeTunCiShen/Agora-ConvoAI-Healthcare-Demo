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
