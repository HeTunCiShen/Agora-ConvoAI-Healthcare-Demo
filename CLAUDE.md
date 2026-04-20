# CLAUDE.md — Healthcare AI Demo

A **Healthcare AI Voice Demo** built on the Agora ConvoAI Web Template. Showcases AI-assisted healthcare scenarios: patient consultations, appointment booking via voice, doctor dashboards, and AI-initiated post-op phone calls (SIP).

**Event:** Sunrise Australia  
**Stack:** Node.js + Express, vanilla JS, Agora RTC/RTM/ConvoAI SDK, Akool Avatar, ElevenLabs TTS, SQLite (better-sqlite3), Jest + Supertest  
**Repo:** https://github.com/HeTunCiShen/Agora-ConvoAI-Healthcare-Demo  
**Production:** https://agora-convoai-healthcare-demo-production.up.railway.app (Railway — auto-deploys on `git push`)  
**Design:** "Clinical Ether" design system — created via Stitch (Google), source files at `/Users/liangzheng/Desktop/ClaudeCodeDemo/stitch_healthcare_ai_voice_hub/`

**Important notes for next developer:**
- This demo is operated by customers directly — UI must be intuitive, no onboarding needed
- Multiple customers may use simultaneously — all call state is session-scoped (safe)
- `git push` to `main` auto-deploys to Railway (takes ~1-2 minutes)
- DB is persistent on Railway (unlike Vercel where it resets)
- Deleting `healthcare.db` and re-seeding wipes all runtime data (summaries, appointments, profile summaries). Seed only creates profiles + 1 care plan.

---

## Running the Project

```bash
npm install --force   # first time only (--force needed for agora-rtm peer dep)
npm start             # production server at http://localhost:3000
npm run dev           # dev server with nodemon auto-reload
npm test              # 62 tests, 7 suites — all should pass
npm run test:integration  # LLM integration tests (hits real Moonshot API, run separately)
```

Set credentials in `.env` (copy from `.env.example`). Required env vars:

| Var | Purpose |
|-----|---------|
| `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` | Agora project auth |
| `AGORA_API_KEY`, `AGORA_API_SECRET` | ConvoAI REST API auth |
| `LLM_URL`, `LLM_API_KEY`, `LLM_MODEL` | Conversation LLM (OpenAI — used by Agora ConvoAI agent) |
| `TTS_ELEVENLABS_API_KEY`, `TTS_ELEVENLABS_VOICE_ID` | ElevenLabs TTS (field name is `key` not `api_key` in Agora API) |
| `AKOOL_API_KEY`, `AKOOL_AVATAR_ID` | Akool avatar (optional — omit both to disable, agent publishes audio directly) |
| `SUMMARIZE_LLM_URL`, `SUMMARIZE_LLM_API_KEY` | Post-call summary LLM (Moonshot — separate from conversation LLM) |
| `SIP_FROM_NUMBER` | Outbound SIP caller ID |
| `SIP_DEMO_TO_NUMBER` | Override all SIP calls to this number (for testing — comment out to use user input) |
| `PROMPT_PATIENT`, `PROMPT_POST_OP_CARE`, `PROMPT_DOCTOR_ASSISTANT` | System prompts per call type |

---

## UI Design — Clinical Ether

The UI was redesigned using Stitch (Google) with a "Clinical Ether" design system. Key principles:

- **No borders** — background color shifts separate sections (the "no-line" rule)
- **Teal-tinted shadows** — `rgba(13,148,136,0.06)` instead of gray
- **Glassmorphism** — frosted glass panels for call UI (`backdrop-filter: blur`)
- **Gradient buttons** — `linear-gradient(135deg, primary, primary-dark)`
- **Inter font** — loaded from Google Fonts
- **Material Symbols** — icons throughout (phone_in_talk, call_end, support_agent, etc.)
- **Responsive** — 768px breakpoint, master-detail collapses to list → detail with back button

### Page Layouts

**Landing page (`/`):**
- Centered two-card layout (Patient / Doctor) with ambient teal glow background
- Agora logo in footer linking to agora.io
- Mobile: cards stack as horizontal rows

**Patient page (`/patient`):**
- **Page nav:** white background with "HealthAI" brand + "Switch Patient" button
- **Top bar:** patient profile info
- **Fixed bottom-left pill:** Call AI Assistant button (on top) + agent state indicator (below), glassmorphism background
- **Master-detail:** left panel = 4 doctor cards ("Care Team"), right panel = selected doctor detail with 3 tabs (Profile, Call History, Appointments)
- **During call:** AI call glass panel appears as right column inside detail area (bento grid layout). Avatar video + wave visualizer. Panel persists when switching doctor tabs — video re-attaches to new DOM.
- **Mobile:** master panel = full screen list, tap card → detail with back button, call controls stretch full width
- **Chat:** toggle button bottom-right, panel slides from right. Does NOT auto-open on mobile.
- **Refreshes on tab focus** (no SSE — avoids HTTP/1.1 connection limit with doctor page)

**Doctor page (`/doctor`):**
- Same nav/top-bar/call-controls pattern as patient page
- **Master-detail:** left panel = 2 patient cards, right panel = patient detail with 3 tabs
- **Post-Op Check-In Call button** in patient detail header → phone number input form → SIP call
- **SIP call lifecycle:** status polling every 3s, live transcript panel (RTM), auto-summarize on end
- **Appointments tab:** Confirm/Decline buttons (only for appointments addressed to this doctor)
- **SSE connection** for live updates (summaries, appointments)
- **During AI call:** same inline glass panel as patient page
- **Chat:** auto-opens on desktop only, not mobile

---

## File Map

```
backend/
  server.js                    # Express app, route wiring, serveHtml(), static files via process.cwd()
  sse.js                       # SSE client set: addClient(), broadcast(), getClientCount()
  controllers/
    agoraController.js         # startConversation (web), startSIPCall (phone), stopConversation,
                               #   getAgentStatus, getChannelInfo, buildSystemPrompt, buildUnifiedToken
    healthcareController.js    # makeHealthcareController(db, sse) factory — profiles, summaries,
                               #   appointments, care plans, profile summary generation, LLM summarize
  routes/
    agora_routes.js            # /api/agora/* (channel-info, start, call, stop, status)
    healthcare_routes.js       # /api/healthcare/*
  middleware/
    auth.js                    # HTTP Basic Auth middleware
  db/
    database.js                # createDb(path) — SQLite schema: profiles, call_summaries (with transcript),
                               #   appointments, patient_profile_summaries, care_plans, media_attachments, sse_events
    seed.js                    # seed(db) — 2 patients + 4 doctors + 1 care plan, INSERT OR IGNORE

frontend/
  index.html                   # Landing page (Clinical Ether design, Agora footer)
  patient.html / patient.js    # Patient portal (master-detail, inline call panel)
  doctor.html  / doctor.js     # Doctor dashboard (master-detail, SIP lifecycle, inline call panel)
  lib/
    agora-rtc-sdk-ng/          # Agora RTC SDK (copied from node_modules for deployment compatibility)
    agora-rtm/                 # Agora RTM SDK (copied from node_modules)
  shared/
    theme.css                  # Clinical Ether design system — all styles, CSS variables, responsive
    profile-modal.js           # ProfileModal class — open(profile), close()
  utils/
    config.js                  # API.agora.*, API.healthcare.*, STORAGE.*, UTILS.*
    chat.js                    # ChatManager class — RTM messages, session management
    audioVisualizer.js         # Audio frequency visualizer for wave bars

tests/                         # 62 tests, 7 suites
docs/superpowers/specs/        # Design specs for original demo and appointment module
```

---

## Demo Personas (seeded in DB)

| ID | Name | Role | Notes |
|----|------|------|-------|
| `patient-1` | Sarah Chen, 34 | Patient | Hypertension, mild anxiety |
| `patient-2` | Marcus Johnson, 52 | Patient | Post-knee-surgery recovery; has a care plan |
| `doctor-1` | Dr. James Williams | Doctor | Cardiologist, Sydney General Hospital |
| `doctor-2` | Dr. Priya Patel | Doctor | Orthopaedic Surgeon, Sydney General Hospital |
| `doctor-3` | Dr. Emily Nguyen | Doctor | General Practitioner, Sunrise Medical Centre |
| `doctor-4` | Dr. Amir Hassan | Doctor | Neurologist, Sydney General Hospital |

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/events` | SSE stream (no auth — registered before basicAuth) |
| GET | `/api/agora/channel-info?channel=&uid=` | RTC/RTM token generation |
| POST | `/api/agora/start` | Start ConvoAI agent (web call) |
| POST | `/api/agora/call` | Start ConvoAI agent + SIP phone call |
| DELETE | `/api/agora/stop/:agentId` | Stop ConvoAI agent |
| POST | `/api/agora/stop/:agentId` | Stop agent (POST alias for sendBeacon on tab close) |
| GET | `/api/agora/status/:agentId` | Agent status (STARTING/RUNNING/STOPPED — 404→STOPPED) |
| GET | `/api/healthcare/profiles?role=` | List profiles |
| GET | `/api/healthcare/profiles/:id` | Single profile |
| GET | `/api/healthcare/summaries?patient_id=` | Call summaries (optional patient filter) |
| POST | `/api/healthcare/summaries` | Save summary + transcript |
| POST | `/api/healthcare/summarize` | LLM-generate structured summary (extracts appointments) |
| GET | `/api/healthcare/profile-summary/:patientId` | Consolidated patient profile summary |
| GET | `/api/healthcare/appointments?patient_id=` | List appointments by patient |
| GET | `/api/healthcare/appointments?doctor_id=` | List appointments by doctor |
| POST | `/api/healthcare/appointments` | Create appointment (status: requested) |
| PUT | `/api/healthcare/appointments/:id` | Confirm/decline appointment |
| GET | `/api/healthcare/care-plans/:patientId` | Get care plan |
| PUT | `/api/healthcare/care-plans/:id` | Approve/edit care plan |

---

## Key Flows

### 1. Patient calls AI Assistant
1. Patient clicks "Call AI Assistant" (fixed bottom-left) → joins RTC+RTM, starts ConvoAI agent
2. Agent prompt: patient profile + appointments + consolidated history + available doctors + Australian time
3. Akool avatar + ElevenLabs voice; call glass panel appears in detail area (right column on desktop)
4. On "End Call" → transcript → Moonshot LLM → structured summary + appointment extraction (multiple per call)
5. Summary + transcript saved; appointments created; profile summary regenerated; UI auto-navigates to doctor's Appointments tab

### 2. Doctor initiates Post-Op SIP Call
1. Doctor clicks "Post-Op Check-In Call" → phone number form with validation
2. Backend calls Agora `/call` API with SIP block (top-level, not inside properties)
3. SIP timeouts: 30s ring, 5 min max, 60s silence
4. Doctor page joins RTM to monitor transcript (monitor UID 500000+)
5. Status polling 3s: Ringing → In Progress → Completed (3 consecutive failures → assume stopped)
6. On end: transcript summarized and saved

### 3. Doctor calls AI Assistant
Same RTC+RTM+avatar flow as patient. Uses `PROMPT_DOCTOR_ASSISTANT`. Includes patient profiles.

### 4. Appointment Lifecycle
- Patient requests via AI call or manual form → `requested`
- Doctor confirms/declines (only their own appointments)
- Patient page refreshes on tab focus (no SSE). Doctor page uses SSE.
- Multiple appointments per call supported

---

## Architecture Gotchas

| Gotcha | Details |
|--------|---------|
| **SSE before basicAuth** | `/events` wired before `app.use('/api', basicAuth)` — EventSource can't set auth headers |
| **No in-call tags** | Voice TTS reads ALL output aloud. Structured extraction is post-call only via `/summarize` |
| **Avatar UID publishes audio** | When Akool enabled, avatar UID (800000+) publishes audio, not agent UID. `handleRTCUserPublished` checks both. 5s fallback if avatar doesn't publish. |
| **ElevenLabs field name** | Agora expects `key` not `api_key` for ElevenLabs TTS params |
| **HTTP/1.1 connection limit** | Only doctor page uses SSE. Patient page uses `visibilitychange` refresh. |
| **Static files in frontend/lib/** | Agora SDK JS copied from node_modules — serverless platforms can't serve node_modules |
| **Tab close cleanup** | `beforeunload` → `sendBeacon` POST to `/api/agora/stop/:agentId` |
| **Network drop** | RTC `DISCONNECTED` → auto-cleanup |
| **Agent crash** | `user-left` → auto `stopCall()` |
| **SIP block is top-level** | Not inside `properties`. Phone numbers must have no spaces. |
| **Dual LLM** | OpenAI for conversation, Moonshot for summarization. Profile summary has retry; `/summarize` does not. |
| **Call panel persists across tabs** | `injectCallPanel()` re-runs after `renderDetailPanel()`. Avatar video re-attaches to new DOM. |
| **Mobile chat** | Does not auto-open on call. Uses `100dvh` + `env(safe-area-inset-bottom)` for iOS Safari. |

---

## Deployment

### Railway (production)

Auto-deploys on `git push` to `main`. Persistent filesystem for SQLite.

**URL:** https://agora-convoai-healthcare-demo-production.up.railway.app

```bash
git add -A
git commit -m "description"
git push   # auto-deploys to Railway in ~1-2 minutes
```

**Setup (if recreating):**
1. Connect GitHub repo `HeTunCiShen/Agora-ConvoAI-Healthcare-Demo`
2. Add env vars in Railway dashboard (Variables → Raw Editor)
3. Generate domain in Settings → Networking
4. Do NOT set `PORT` — Railway assigns its own

### Vercel (not recommended)

`vercel.json` and `.npmrc` included but SQLite resets on cold starts. Use Railway instead.

---

## Future Work

- **Server-side transcript capture:** Transcripts only exist in browser memory. If tab closes, lost. SIP calls have no browser. Need server-side RTM listener or Agora webhook.
- **SIP RTM transcript:** Frontend done (live panel, console logging). Waiting for Agora to enable RTM for SIP on AppID `bcb29d150a73428985238d8cf3bbaff9`.
- **Floating transcript window:** Attempted but CSS positioning didn't work in the current layout. Currently inline toggle. Revisit with a dedicated modal/portal approach.
- **Mobile bottom tab navigation:** Stitch designed it but not yet implemented. Would replace master-detail sidebar on mobile with Doctors/Appts/History/Profile tabs.

---

## Design Specs & References

- **Original demo spec:** `docs/superpowers/specs/2026-04-15-healthcare-ai-demo-design.md`
- **Appointment module spec:** `docs/superpowers/specs/2026-04-17-appointment-module-design.md`
- **Stitch designs (local):** `/Users/liangzheng/Desktop/ClaudeCodeDemo/stitch_healthcare_ai_voice_hub/`
  - `landing_page_desktop/` + `landing_page_mobile/` — screen.png + code.html
  - `patient_page_desktop/` + `patient_page_mobile/`
  - `doctor_page_desktop/` + `doctor_page_mobile/`
  - `aether_health/DESIGN.md` — Clinical Ether design system document
  - `project_requirements_healthcare_ai_voice_demo.md` — PRD
