# Healthcare AI Demo — Design Spec
**Event:** Sunrise Australia  
**Date:** 2026-04-15  
**Status:** Approved — Phase I

---

## Overview

A healthcare AI voice demo built on the Agora ConvoAI Web Template. Showcases an AI doctor assistant across four scenarios: patient calling AI, AI following up with patient post-operation, doctor calling AI for clinical questions, and real-time structured summaries delivered to the doctor's dashboard.

---

## Scope

### Phase I (this spec)
- Two separate pages: `/patient` and `/doctor`
- Profile selection (no auth — demo picker)
- Patient calls AI doctor (single button, AI routes scenario)
- AI post-op care check-in (mock button on patient page)
- Doctor receives live structured patient summaries via SSE
- Doctor calls AI assistant
- Expandable profile cards
- SQLite persistence
- White + teal/mint theme

### Phase II (future — not built here)
- PSTN/SIP outbound calls from AI to patient phone number
- Camera/vision support — video frames sent to customised LLM endpoint
- Media attachments stored in DB (medicine photos, symptom images)
- RAG integration in conversational AI
- User registration for patients and doctors

---

## Pages & Routing

| Route | File | Description |
|-------|------|-------------|
| `GET /` | `frontend/index.html` | Landing: links to /patient and /doctor |
| `GET /patient` | `frontend/patient.html` | Patient experience |
| `GET /doctor` | `frontend/doctor.html` | Doctor dashboard |

### Profile Selection
Both `/patient` and `/doctor` show a selection screen on first load (no prior `sessionStorage` entry). The user picks which person they are from 2 cards. Selection is stored in `sessionStorage`. A "Switch user" link on each page returns to the selection screen.

---

## Demo Personas

### Patients
| Field | Patient 1 | Patient 2 |
|-------|-----------|-----------|
| Name | Sarah Chen | Marcus Johnson |
| Age | 34 | 52 |
| Condition | Hypertension, mild anxiety | Post-knee-surgery recovery |
| Medications | Lisinopril 10mg, Propranolol 20mg | Tramadol 50mg, Aspirin 100mg |
| Next Appointment | Apr 18 — Dr. James Williams | Apr 20 — Dr. Priya Patel |
| Phone *(Phase II)* | +61 400 000 001 | +61 400 000 002 |

### Doctors
| Field | Doctor 1 | Doctor 2 |
|-------|----------|----------|
| Name | Dr. James Williams | Dr. Priya Patel |
| Specialty | Cardiologist | Orthopaedic Surgeon |
| Hospital | Sydney General Hospital | Sydney General Hospital |
| Experience | 12 years | 9 years |
| Languages | English, Mandarin | English, Hindi |

---

## Patient Page

### Profile Card (compact)
- Avatar (initials), name (clickable → profile modal), age, condition, assigned doctor, next appointment

### Buttons
- **"Call AI Doctor"** — starts Agora ConvoAI session with `PROMPT_PATIENT`
- **"Post-Op Care Check-In"** — starts Agora ConvoAI session with `PROMPT_POST_OP_CARE`

### Call Flow
1. Patient clicks call button
2. Frontend fetches selected patient profile from `GET /api/healthcare/profiles/:id`
3. Passes profile as `profileContext` to `POST /api/agora/start`
4. Backend injects profile details into the prompt template before sending to Agora
5. AI greets patient by name with full context
6. Existing RTC/RTM flow handles voice + chat
7. On call end, frontend parses RTM transcript messages, extracts structured summary, POSTs to `POST /api/healthcare/summaries`
8. Backend saves to SQLite, triggers SSE push to doctor page

### Profile Modal (expanded)
Full medications list, medical history, emergency contact, extra notes.

---

## Doctor Page

### Profile Card (compact)
Avatar (initials), name (clickable → profile modal), specialty, hospital.

### Patient Summary Feed (left ~60%)
- Loads on page open via `GET /api/healthcare/summaries`
- Live updates via `EventSource('GET /api/healthcare/events')`
- Newest summary on top
- Each card shows:
  - Patient name + call type badge (pre-session / condition-check / post-session / post-op)
  - Urgency badge (low / medium / high)
  - Chief complaint
  - Symptoms list
  - Vitals mentioned
  - Medications discussed
  - AI recommendation
  - Transcript excerpt
  - Suggested action for doctor
  - Care plan approve/edit button (if post-op call)

### AI Assistant Panel (right ~40%)
- **"Call AI Assistant"** button — starts Agora session with `PROMPT_DOCTOR_ASSISTANT`
- Doctor profile injected into prompt at call start
- Existing chat panel and audio visualizer reused

### Profile Modal (expanded)
Qualifications, bio, languages spoken, patient roster (names only).

---

## Backend Architecture

### New Files
```
backend/
├── db/
│   ├── database.js              -- better-sqlite3 connection + table init
│   ├── seed.js                  -- demo profiles + sample care plan seeder
│   └── healthcare.db            -- generated at runtime, gitignored
├── controllers/
│   ├── agoraController.js       -- existing, extended to accept profileContext
│   └── healthcareController.js  -- profiles, summaries, care plans, SSE
├── routes/
│   └── healthcare_routes.js     -- /api/healthcare/* routes
└── sse.js                       -- SSE connection manager
```

### API Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/healthcare/profiles/:id` | Fetch profile by id |
| GET | `/api/healthcare/profiles?role=patient` | List all patients or doctors |
| GET | `/api/healthcare/summaries` | All summaries (doctor feed) |
| POST | `/api/healthcare/summaries` | Save summary after call ends |
| GET | `/api/healthcare/care-plans/:patientId` | Get patient care plan |
| PUT | `/api/healthcare/care-plans/:id` | Doctor approves/edits plan |
| GET | `/api/healthcare/events` | SSE stream for doctor page |

### SSE Flow
1. Doctor page opens `EventSource('/api/healthcare/events')` on load
2. Patient finishes a call → frontend POSTs structured summary
3. Backend saves to `call_summaries`, inserts into `sse_events`
4. SSE manager pushes `data: {...}\n\n` to all connected doctor clients
5. Doctor feed card prepended instantly — no polling

### Agora Start — Profile Injection
`POST /api/agora/start` accepts optional `profileContext` (plain text).  
Backend prepends it to the relevant prompt template before the Agora agent join call.

---

## Data Model (SQLite)

```sql
profiles (
  id TEXT PRIMARY KEY,          -- 'patient-1', 'patient-2', 'doctor-1', 'doctor-2'
  role TEXT,                    -- 'patient' | 'doctor'
  name TEXT,
  avatar TEXT,                  -- initials for demo
  age INTEGER,
  specialty TEXT,               -- doctor only
  hospital TEXT,                -- doctor only
  condition TEXT,               -- patient only
  medications TEXT,             -- patient only (JSON array)
  next_appointment TEXT,        -- patient only
  assigned_doctor TEXT,         -- patient only (doctor id)
  phone_number TEXT,            -- [Phase II] PSTN/SIP outbound number
  extra_details TEXT            -- JSON blob for expanded profile modal
)

call_summaries (
  id TEXT PRIMARY KEY,
  patient_id TEXT,
  call_type TEXT,               -- 'pre-session' | 'condition-check' | 'post-session' | 'post-op'
  call_channel TEXT,            -- [Phase II] 'web' | 'pstn' | 'sip'
  chief_complaint TEXT,
  symptoms TEXT,                -- JSON array
  vitals_mentioned TEXT,        -- JSON object
  medications_discussed TEXT,   -- JSON array
  ai_recommendation TEXT,
  urgency TEXT,                 -- 'low' | 'medium' | 'high'
  transcript_excerpt TEXT,
  suggested_action TEXT,
  media_attachment_ids TEXT,    -- [Phase II] JSON array of media_attachments.id
  created_at TEXT
)

-- [Phase II] Video frame captures from vision-enabled calls
media_attachments (
  id TEXT PRIMARY KEY,
  call_summary_id TEXT,
  patient_id TEXT,
  media_type TEXT,              -- 'symptom_photo' | 'medication_photo' | 'document'
  storage_path TEXT,
  llm_analysis TEXT,
  captured_at TEXT
)

care_plans (
  id TEXT PRIMARY KEY,
  patient_id TEXT,
  plan_text TEXT,               -- JSON array of day-by-day instructions
  status TEXT,                  -- 'pending-review' | 'approved' | 'modified'
  doctor_notes TEXT,
  created_at TEXT,
  updated_at TEXT
)

sse_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT,              -- 'new_summary' | 'plan_updated' | 'media_captured'
  payload TEXT,                 -- JSON
  created_at TEXT
)
```

---

## AI System Prompts

Three prompt templates stored in `.env`. Patient profile is injected at call start.

### PROMPT_PATIENT
Universal patient assistant. Handles pre-session, condition check, and post-session via conversational routing.

```
You are an AI medical assistant for a clinic. You are speaking with {name}, age {age}.
Current conditions: {condition}. Current medications: {medications}.
Next appointment: {next_appointment} with {assigned_doctor}.

Greet {name} warmly by name. Ask what brings them in today.
Identify their intent:
- Pre-session: gather symptoms and reason for visit before upcoming appointment
- Condition check: assess a current health concern, ask diagnostic questions, recommend urgency
- Post-session: answer questions about medications, dosage, side effects, or recovery

Adapt your conversation to the identified intent. Be empathetic, clear, and professional.
Do not diagnose definitively — recommend seeing the doctor for confirmation.

At the end of the call, output a JSON summary (enclosed in <summary></summary> tags):
{
  "call_type": "pre-session|condition-check|post-session",
  "chief_complaint": "",
  "symptoms": [],
  "vitals_mentioned": {},
  "medications_discussed": [],
  "ai_recommendation": "",
  "urgency": "low|medium|high",
  "transcript_excerpt": "",
  "suggested_action": ""
}
```

### PROMPT_POST_OP_CARE
```
You are an AI following up with {name} after their recent procedure.
Care plan: {care_plan}.

Check how they are feeling, pain levels (1-10), whether they are following the care plan,
medication adherence, and any unexpected symptoms. Be warm, encouraging, and reassuring.
Flag anything concerning as urgent for the doctor to review.
```

### PROMPT_DOCTOR_ASSISTANT
```
You are an AI clinical assistant speaking with {name}, {specialty} at {hospital}.
Answer medical questions concisely and accurately — drug interactions, treatment protocols,
dosage guidelines, differential diagnoses. Be direct and professional. Cite your reasoning.
```

---

## Frontend File Structure

```
frontend/
├── index.html              -- landing page (links to /patient, /doctor)
├── patient.html            -- patient page
├── patient.js              -- patient page logic
├── doctor.html             -- doctor page
├── doctor.js               -- doctor page logic
├── shared/
│   ├── profile-modal.js    -- shared expandable profile modal
│   └── theme.css           -- teal/mint healthcare theme (CSS variable overrides)
├── utils/
│   ├── config.js           -- existing, unchanged
│   ├── chat.js             -- existing, unchanged
│   └── audioVisualizer.js  -- existing, unchanged
└── styles.css              -- existing, unchanged
```

---

## Visual Theme

**White + Teal/Mint**  
Primary: `#0d9488` (teal-600)  
Background: `#f0fdfb`  
Card background: `#ffffff`  
Accent light: `#e0faf5`  
Text: `#1f2937`  
Urgency badges: green / amber / red  

Implemented as CSS variable overrides in `theme.css` — does not modify `styles.css`.

---

## Out of Scope (Phase I)

- Real authentication / login
- User registration
- PSTN / SIP calls
- Camera / vision
- Custom LLM endpoint
- RAG
- Multi-device real-time sync (doctor and patient on different machines)
- Call recording
- HIPAA compliance measures
