# Appointment Module — Design Spec

**Goal:** Add appointment scheduling to the HealthAI demo. Patients request appointments with doctors (manually or via AI voice call). Doctors confirm or decline. Both pages get a major layout rework: master-detail with expandable cards showing profile, call history, and appointments.

**Event:** Sunrise Australia demo
**Date:** 2026-04-17

---

## Data Model

### New table: `appointments`

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| patient_id | TEXT NOT NULL | FK to profiles |
| doctor_id | TEXT NOT NULL | FK to profiles |
| date_time | TEXT NOT NULL | ISO 8601, stored UTC |
| status | TEXT NOT NULL | `requested` → `confirmed` / `declined` |
| reason | TEXT | Free text — from patient or AI |
| created_at | TEXT NOT NULL | ISO 8601, UTC |
| updated_at | TEXT NOT NULL | ISO 8601, UTC |

No separate relationship table. Patient-doctor relationships are derived implicitly from appointments and call summaries.

### Seed data

6 profiles total: 2 patients, 4 doctors.

| ID | Name | Specialty | Hospital |
|----|------|-----------|----------|
| doctor-1 | Dr. James Williams | Cardiologist | Sydney General |
| doctor-2 | Dr. Priya Patel | Orthopaedic Surgeon | Sydney General |
| doctor-3 | Dr. Emily Nguyen | General Practitioner | Sunrise Medical Centre |
| doctor-4 | Dr. Amir Hassan | Neurologist | Sydney General |

No seeded appointments — they are created during the demo.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/healthcare/appointments?patient_id=X` | List appointments for a patient |
| GET | `/api/healthcare/appointments?doctor_id=X` | List appointments for a doctor |
| POST | `/api/healthcare/appointments` | Create appointment (status: `requested`) |
| PUT | `/api/healthcare/appointments/:id` | Update status (`confirmed` / `declined`) |

### POST body
```json
{
  "patient_id": "patient-1",
  "doctor_id": "doctor-1",
  "date_time": "2026-04-22T10:00:00.000Z",
  "reason": "Follow-up on blood pressure medication"
}
```

### PUT body
```json
{
  "status": "confirmed"
}
```

SSE broadcasts `new_appointment` and `appointment_updated` events so both pages update in real-time.

---

## Patient Page Layout

Major rework from single-column to master-detail layout.

### Top bar (always visible)
- Patient profile (avatar, name, condition) on the left
- Call buttons on the right: "Call AI Assistant", "Post-Op Check-In", "End Call"
- Agent state indicator next to call buttons

### Left panel: Doctor cards
- Lists ALL doctors in the system (4 doctors)
- Each card shows: avatar, name, specialty
- Selected card has teal border highlight
- Cards with history show quick stats: appointment count, call count

### Right panel: Detail view
- Header: doctor name, specialty, hospital + **"Request Appointment"** button
- 3 tabs:
  - **Profile**: doctor bio, experience, qualifications, languages
  - **Call History**: past call summaries between this patient and this doctor (filtered from existing `call_summaries` table — note: requires adding `doctor_id` context, or showing all patient summaries when viewing a doctor)
  - **Appointments**: list of appointments with this doctor, status badges

### Avatar/Visualizer
- During a call, the avatar container appears overlaying or above the master-detail area (same as current behavior)

### Mobile (future)
- CSS flexbox with breakpoint
- Left panel becomes default view
- Tapping a card pushes detail panel full-screen with back button
- No extra components needed now — just avoid hardcoded widths

---

## Doctor Page Layout

Mirrors the patient page pattern.

### Top bar (always visible)
- Doctor profile (avatar, name, specialty) on the left
- AI assistant call controls on the right: "Call AI Assistant", "End Call"
- Agent state indicator

### Left panel: Patient cards
- Lists ALL patients in the system (2 patients)
- Red notification badge on cards with pending appointment requests
- Quick stats: pending request count, confirmed appointment count

### Right panel: Detail view
- Header: patient name, age, conditions, medications
- 3 tabs:
  - **Profile**: patient demographics, medical history, allergies, emergency contact (from `extra_details`)
  - **Call History**: past call summaries for this patient (replaces the old standalone summary feed — now scoped per patient)
  - **Appointments**: appointment list with **Confirm / Decline** buttons for `requested` status. Pending requests highlighted in yellow.

### SSE integration
- `new_appointment` event: adds notification badge to the relevant patient card, updates Appointments tab if open
- `appointment_updated` event: updates appointment status in real-time

---

## AI Appointment Creation (Primary: In-call structured tags)

### System prompt addition
The patient-facing system prompt instructs the AI:
- When the patient wants to book an appointment, ask for: (1) which doctor, (2) preferred date/time, (3) reason
- Once all three are collected, emit a structured tag in the response
- Then confirm verbally: "I've submitted your appointment request with Dr. [name] for [date]. They'll confirm it shortly."

### Available doctors injection
Before the call, fetch all doctor profiles and inject into the system prompt:
```
Available doctors for appointment booking:
- doctor-1: Dr. James Williams (Cardiologist, Sydney General Hospital)
- doctor-2: Dr. Priya Patel (Orthopaedic Surgeon, Sydney General Hospital)
- doctor-3: Dr. Emily Nguyen (General Practitioner, Sunrise Medical Centre)
- doctor-4: Dr. Amir Hassan (Neurologist, Sydney General Hospital)
```

### Structured tag format
```
<appointment>{"doctor_id":"doctor-1","date_time":"2026-04-22T10:00:00","reason":"Follow-up on blood pressure"}</appointment>
```

### Frontend parsing
In `chatManager.receiveRtmMessage` (or a new handler), detect the `<appointment>` tag in AI messages:
1. Extract the JSON payload
2. Call `POST /api/healthcare/appointments` with `patient_id` (from selected profile) + extracted fields
3. Status is `requested`
4. Strip the tag from displayed message (like the existing `<summary>` tag handling)

### Fallback (Plan A: Post-call extraction)
If the in-call tag is not detected but the transcript contains appointment discussion:
- After call ends, the summary LLM call can also extract appointment intent
- If found, create the appointment from the extracted data
- This is a safety net, not the primary mechanism

---

## Files to Create or Modify

### Backend
- `backend/db/database.js` — add `appointments` table to schema
- `backend/controllers/healthcareController.js` — add `listAppointments`, `createAppointment`, `updateAppointment`
- `backend/routes/healthcare_routes.js` — register new appointment routes
- `backend/controllers/agoraController.js` — update `buildSystemPrompt` to inject doctor list and appointment instructions

### Frontend
- `frontend/patient.html` — rework to master-detail layout
- `frontend/patient.js` — rework to master-detail: doctor card list, detail panel with tabs, appointment creation (manual + AI tag parsing)
- `frontend/doctor.html` — rework to master-detail layout
- `frontend/doctor.js` — rework to master-detail: patient card list, detail panel with tabs, appointment confirm/decline
- `frontend/utils/config.js` — add appointment API calls
- `frontend/shared/theme.css` — add master-detail layout styles, tab styles, appointment card styles

### Tests
- Update `tests/healthcare.test.js` — add appointment CRUD tests
- Update `tests/db/seed.test.js` — verify new table exists

---

## Out of Scope

- Calendar integration (Google Calendar, iCal)
- Appointment reminders / notifications (email, SMS)
- Doctor availability / schedule management
- Recurring appointments
- Video call appointments (telehealth link)
- Patient-doctor assignment logic (all doctors visible to all patients)
