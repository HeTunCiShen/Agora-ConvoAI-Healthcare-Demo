# CLAUDE.md — Healthcare AI Demo

A **Healthcare AI Voice Demo** built on the Agora ConvoAI Web Template. Showcases AI-assisted healthcare scenarios: patient consultations, appointment booking via voice, doctor dashboards, and AI-initiated post-op phone calls (SIP).

**Event:** Sunrise Australia  
**Stack:** Node.js + Express, vanilla JS, Agora RTC/RTM/ConvoAI SDK, Akool Avatar, ElevenLabs TTS, SQLite (better-sqlite3), Jest + Supertest  
**Repo:** https://github.com/HeTunCiShen/Agora-ConvoAI-Healthcare-Demo  
**Production:** https://agora-convoai-healthcare-demo-production.up.railway.app (Railway)  
**Note:** This demo will be operated by customers directly — UI must be intuitive and self-explanatory.  
**DB Note:** Deleting `healthcare.db` and re-seeding wipes all call summaries, appointments, and profile summaries. Seed only creates profiles + 1 care plan.

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
| `AKOOL_API_KEY`, `AKOOL_AVATAR_ID` | Akool avatar (optional — omit both to disable avatar, agent publishes audio directly) |
| `SUMMARIZE_LLM_URL`, `SUMMARIZE_LLM_API_KEY` | Post-call summary LLM (Moonshot — separate from conversation LLM) |
| `SIP_FROM_NUMBER` | Outbound SIP caller ID |
| `SIP_DEMO_TO_NUMBER` | Override all SIP calls to this number (for testing — comment out to use user input) |
| `PROMPT_PATIENT`, `PROMPT_POST_OP_CARE`, `PROMPT_DOCTOR_ASSISTANT` | System prompts per call type |

---

## Pages

| URL | Description |
|-----|-------------|
| `/` | Landing page — links to /patient and /doctor |
| `/patient` | Patient portal — master-detail with doctor cards, call AI, book appointments |
| `/doctor` | Doctor dashboard — master-detail with patient cards, AI assistant, post-op SIP calls |

Both pages show a profile picker on first load (stored in `sessionStorage`). "Switch user" clears it and reloads.

### Patient Page Layout
- **Top bar:** patient profile + "Call AI Assistant" button + agent state indicator
- **Left panel:** all 4 doctors as compact cards (click to select)
- **Right panel:** selected doctor detail with 3 tabs — Profile, Call History, Appointments
- "Request Appointment" button per doctor → inline form in Appointments tab
- Call overlay with Akool avatar (9:16 video) / wave visualizer during active call
- Auto-navigates to correct doctor's Appointments tab when post-call extraction creates one
- Refreshes on tab focus (no SSE — avoids HTTP/1.1 connection limit with doctor page)

### Doctor Page Layout
- **Top bar:** doctor profile + "Call AI Assistant" button + agent state indicator
- **Left panel:** all 2 patients as compact cards (click to select)
- **Right panel:** selected patient detail with 3 tabs — Profile, Call History, Appointments
- "Post-Op Check-In Call" button per patient → phone number input with format validation → SIP call
- Live transcript panel during SIP call with real-time AI/Patient dialogue and Stop button
- Confirm/Decline buttons on appointment requests addressed to this doctor
- SSE connection for live updates (new summaries, appointment changes)

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
    agora_routes.js            # /api/agora/* (GET channel-info, POST start, POST call, DELETE/POST stop, GET status)
    healthcare_routes.js       # /api/healthcare/*
  middleware/
    auth.js                    # HTTP Basic Auth middleware
  db/
    database.js                # createDb(path) — SQLite schema: profiles, call_summaries (with transcript),
                               #   appointments, patient_profile_summaries, care_plans, media_attachments, sse_events
    seed.js                    # seed(db) — 2 patients + 4 doctors + 1 care plan, INSERT OR IGNORE

frontend/
  index.html                   # Landing page
  patient.html / patient.js    # Patient portal (master-detail layout, 714 lines JS)
  doctor.html  / doctor.js     # Doctor dashboard (master-detail + SIP lifecycle, 905 lines JS)
  lib/
    agora-rtc-sdk-ng/          # Agora RTC SDK (copied from node_modules for deployment compatibility)
    agora-rtm/                 # Agora RTM SDK (copied from node_modules for deployment compatibility)
  shared/
    theme.css                  # All styles: CSS variables, master-detail, tabs, cards, appointments,
                               #   SIP live panel, transcript toggle, avatar container (596 lines)
    profile-modal.js           # ProfileModal class — open(profile), close()
  utils/
    config.js                  # API.agora.*, API.healthcare.*, STORAGE.*, UTILS.*
    chat.js                    # ChatManager class — handles RTM messages, session management
    audioVisualizer.js         # Audio frequency visualizer for wave bars

tests/
  setup.js                     # Sets NODE_ENV=test
  healthcare.test.js           # 24 tests — profiles, summaries, appointments CRUD
  agoraController.test.js      # 6 tests for buildSystemPrompt
  server.test.js               # 5 tests for route/HTML serving
  db/database.test.js          # DB schema tests
  db/seed.test.js              # Seeder tests (6 profiles, idempotency)
  sse.test.js                  # SSE manager tests
  summarize.integration.test.js  # Real LLM integration tests (run separately with npm run test:integration)
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
| POST | `/api/agora/stop/:agentId` | Stop agent (POST alias for navigator.sendBeacon on tab close) |
| GET | `/api/agora/status/:agentId` | Agent status (STARTING/RUNNING/STOPPED — 404 returns STOPPED) |
| GET | `/api/healthcare/profiles?role=` | List profiles (optional role filter) |
| GET | `/api/healthcare/profiles/:id` | Single profile |
| GET | `/api/healthcare/summaries?patient_id=` | Call summaries (optional patient filter) |
| POST | `/api/healthcare/summaries` | Save summary + transcript after call |
| POST | `/api/healthcare/summarize` | LLM-generate structured summary from transcript (extracts appointments) |
| GET | `/api/healthcare/profile-summary/:patientId` | Consolidated patient profile summary |
| GET | `/api/healthcare/appointments?patient_id=` | List appointments (by patient, includes doctor names via JOIN) |
| GET | `/api/healthcare/appointments?doctor_id=` | List appointments (by doctor, includes patient names via JOIN) |
| POST | `/api/healthcare/appointments` | Create appointment (status: requested, broadcasts SSE) |
| PUT | `/api/healthcare/appointments/:id` | Confirm/decline appointment (broadcasts SSE) |
| GET | `/api/healthcare/care-plans/:patientId` | Get care plan |
| PUT | `/api/healthcare/care-plans/:id` | Approve/edit care plan (broadcasts SSE) |

---

## Key Flows

### 1. Patient calls AI Assistant
1. Patient clicks "Call AI Assistant" → frontend joins RTC+RTM, starts ConvoAI agent
2. Agent prompt includes: patient profile, all appointments (requested+confirmed), consolidated history from prior calls, available doctors list with specialties, current Australian date/time
3. Akool avatar renders AI face + ElevenLabs voice; RTM carries live transcript to chat panel
4. Patient can discuss symptoms, ask questions, or request appointments (AI confirms verbally, says "appointment will be sent after this call")
5. On "End Call" → full transcript sent to Moonshot LLM for structured summary extraction
6. LLM returns: chief_complaint, symptoms, medications, recommendation, urgency, appointment_requests (array — supports multiple per call)
7. Summary + full transcript saved to DB; appointment(s) created if extracted (fuzzy doctor name matching); patient profile summary regenerated (fire-and-forget with retry)
8. Patient page auto-navigates to the relevant doctor's Appointments tab
9. Doctor page receives SSE notification and refreshes

### 2. Doctor initiates Post-Op SIP Call
1. Doctor selects patient → clicks "Post-Op Check-In Call" → phone number input form appears
2. Phone number validated (must start with +, 10-15 digits). `SIP_DEMO_TO_NUMBER` env var overrides if set.
3. Backend calls Agora `/call` API with SIP block at top level (to_number, from_number, rtc_uid, rtc_token)
4. SIP timeouts: 30s ring, 5 min max duration, 60s silence → hangup
5. Patient's phone rings; AI greets with doctor's name and hospital
6. Doctor page joins RTM to monitor live transcript (separate RTM instance with monitor UID 500000+)
7. Status polling every 3s: Ringing → In Progress (with Stop button) → Completed
8. When call ends: transcript summarized via Moonshot LLM and saved to DB
9. If status poll fails 3x consecutively, assumes agent stopped and triggers cleanup

### 3. Doctor calls AI Assistant
Doctor clicks "Call AI Assistant" → same RTC+RTM+avatar flow as patient, uses `PROMPT_DOCTOR_ASSISTANT`, includes consolidated patient profiles for recent patients as context.

### 4. Appointment Lifecycle
- Patient requests (via AI call extraction or manual inline form) → status: `requested`
- Doctor sees all patient's appointments in detail panel → Confirm/Decline buttons (only on appointments addressed to this doctor)
- Patient page refreshes on tab focus via `visibilitychange` (no SSE — avoids HTTP/1.1 connection limit)
- Multiple appointments per call supported (LLM prompt says "Multiple appointments in one call are common")
- SSE broadcasts `new_appointment` and `appointment_updated` events

---

## Architecture Decisions & Gotchas

### SSE route before basicAuth
`EventSource` can't set auth headers. `/events` is wired in `server.js` before `app.use('/api', basicAuth)`.

### No in-call structured tags
Voice TTS reads ALL LLM output aloud — tags like `<appointment>` would be spoken as "less than appointment greater than...". All structured extraction happens post-call via the `/summarize` endpoint. The AI is instructed to confirm appointment details verbally and say they'll be sent after the call.

### Akool avatar UID publishes audio
When avatar is enabled, the avatar UID (800000+ range) publishes audio, NOT the agent UID (1000+ range). `handleRTCUserPublished` checks both: `user.uid == agentUID || (avatarUID && user.uid == avatarUID)`. If avatar fails to publish within 5 seconds but agent status is RUNNING, `onCallStarted()` is force-triggered as fallback. If avatar ID is invalid, agent joins but stays muted — no audio at all.

### ElevenLabs TTS field name
Agora ConvoAI expects `key` (not `api_key`) for ElevenLabs params. This caused a 400 InvalidRequest until corrected.

### HTTP/1.1 connection limit (6 per domain)
Two SSE connections (patient + doctor page open simultaneously) block API calls. Solution: only the doctor page uses SSE. Patient page uses `visibilitychange` event to refresh on tab focus.

### Auth credentials injected into HTML
`serveHtml()` in `server.js` injects `window.APP_AUTH_USERNAME` / `window.APP_AUTH_PASSWORD` into `<head>`. Frontend `config.js` reads these for API `Authorization: Basic` headers.

### Static files served from frontend/lib/
Agora SDK JS files are copied from `node_modules/` into `frontend/lib/` because serverless platforms (Vercel) can't serve `node_modules` via `express.static`. The `/lib` route now maps to `frontend/lib/`, not `node_modules/`.

### Call lifecycle — edge cases handled
- **Tab close/refresh:** `beforeunload` fires `navigator.sendBeacon` to POST `/api/agora/stop/:agentId` (POST alias added alongside DELETE)
- **Network drop:** RTC `connection-state-change` to `DISCONNECTED` auto-triggers cleanup
- **Agent dies unexpectedly:** `user-left` event auto-triggers `stopCall()`
- **Agent status 404 from Agora:** Backend returns `{ status: 'STOPPED' }` instead of 500
- **SIP poll failures:** 3 consecutive failures → assume agent stopped → trigger `onSipCallEnded()`
- **SIP call start vs RTM failure:** Separated into critical path (SIP call) and optional (RTM transcript). If RTM fails, call still runs with status polling.

### Full transcript saved with summaries
`call_summaries.transcript` stores the full conversation as a JSON array of `{role, content}` objects. Displayed in Call History via "Show Transcript" toggle button (hidden by default, scrollable block with color-coded AI/Patient labels).

### Profile summary regeneration
After each call summary is saved, backend regenerates a consolidated profile summary for that patient (all calls → LLM → single concise summary stored in `patient_profile_summaries`). Next call injects this instead of raw records. Has retry with backoff (3s, 6s) for rate limits.

### SIP call request structure
`sip` block is **top-level** (same level as `name` and `properties`), NOT inside `properties`. Phone numbers must have spaces stripped. SIP UID is in 600000+ range.

### Dual LLM setup
Live conversation uses OpenAI (`LLM_URL` / `LLM_API_KEY`) — this is what Agora ConvoAI calls. Post-call summarization and profile summary regeneration use Moonshot (`SUMMARIZE_LLM_URL` / `SUMMARIZE_LLM_API_KEY`) — a separate provider. If Moonshot is rate-limited (429), profile summary regeneration retries with backoff; the `/summarize` endpoint does not retry (fails silently, call data is not lost).

### Multi-user safety
All call state (agent IDs, channels, SIP state) is scoped per browser tab/session via JavaScript closures. One customer cannot stop another customer's call. SIP calls tracked separately from web calls (`sipAgentId` vs `agoraConvoAIAgentID`).

### Call history filtering on patient page
Patient page filters call history by doctor name: only shows calls that mention the selected doctor in chief_complaint, ai_recommendation, suggested_action, or transcript_excerpt. Doctor page shows ALL calls for a patient (full context).

---

## Deployment

### Railway (production — recommended)

Deployed via GitHub integration. Railway provides persistent filesystem (SQLite works natively), auto-deploys on `git push`.

**URL:** https://agora-convoai-healthcare-demo-production.up.railway.app

**Setup:**
1. Connect GitHub repo `HeTunCiShen/Agora-ConvoAI-Healthcare-Demo` as a service
2. Add all env vars in Railway dashboard (Variables tab → Raw Editor)
3. Railway auto-detects Node.js, runs `npm start`
4. Generate domain in Settings → Networking

**Note:** Railway assigns its own `PORT` — do NOT set `PORT` in env vars (the app reads `process.env.PORT || 3000`).

### Vercel (not recommended for this project)

SQLite doesn't work on Vercel serverless — DB resets on cold starts. `vercel.json` and `.npmrc` are included for reference but **Railway is the production platform**.

### GitHub

```bash
git add -A
git commit -m "description"
git push   # auto-deploys to Railway
```

`.gitignore` excludes: `.env`, `healthcare.db`, `node_modules/`, `.superpowers/`, `.vercel/`

---

## Future Work

- **Server-side transcript capture:** Currently transcripts only exist in browser memory (patient calls) or RTM monitor (SIP calls). If user closes tab, transcript is lost. SIP calls depend on Agora enabling RTM for SIP on the AppID. Long-term: implement server-side RTM listener or Agora webhook to capture transcripts independently of browser state.
- **SIP RTM transcript:** Frontend implementation is complete (live transcript panel, console logging). Waiting for Agora to enable RTM for SIP calls on AppID `bcb29d150a73428985238d8cf3bbaff9`. Once enabled, transcript will flow automatically.
- **Mobile responsive UI:** CSS breakpoint at 768px planned. Master-detail collapses to list → detail with back button. Designs being created in Stitch (Google). Implementation will update `theme.css` + HTML with media queries.

---

## Design Specs

- **Original spec:** `docs/superpowers/specs/2026-04-15-healthcare-ai-demo-design.md`
- **Appointment module spec:** `docs/superpowers/specs/2026-04-17-appointment-module-design.md`
