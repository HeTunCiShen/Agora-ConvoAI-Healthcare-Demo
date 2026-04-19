# CLAUDE.md — Healthcare AI Demo

A **Healthcare AI Voice Demo** built on the Agora ConvoAI Web Template. Showcases AI-assisted healthcare scenarios: patient consultations, appointment booking via voice, doctor dashboards, and AI-initiated post-op phone calls (SIP).

**Event:** Sunrise Australia  
**Stack:** Node.js + Express, vanilla JS, Agora RTC/RTM/ConvoAI SDK, Akool Avatar, ElevenLabs TTS, SQLite (better-sqlite3), Jest + Supertest  
**Note:** This demo will be operated by customers directly — UI must be intuitive and self-explanatory.  
**DB Note:** Deleting `healthcare.db` and re-seeding wipes all call summaries, appointments, and profile summaries. Seed only creates profiles + 1 care plan.

---

## Running the Project

```bash
npm install --force   # first time only
npm start             # production server at http://localhost:3000
npm run dev           # dev server with nodemon auto-reload
npm test              # 62 tests, 7 suites — all should pass
npm run test:integration  # LLM integration tests (hits real Moonshot API)
```

Set credentials in `.env` (copy from `.env.example`). Required env vars:

| Var | Purpose |
|-----|---------|
| `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` | Agora project auth |
| `AGORA_API_KEY`, `AGORA_API_SECRET` | ConvoAI REST API auth |
| `LLM_URL`, `LLM_API_KEY`, `LLM_MODEL` | Conversation LLM (OpenAI) |
| `TTS_ELEVENLABS_API_KEY`, `TTS_ELEVENLABS_VOICE_ID` | ElevenLabs TTS |
| `AKOOL_API_KEY`, `AKOOL_AVATAR_ID` | Akool avatar (optional — omit to disable) |
| `SUMMARIZE_LLM_URL`, `SUMMARIZE_LLM_API_KEY` | Post-call summary LLM (can differ from conversation LLM) |
| `SIP_FROM_NUMBER` | Outbound SIP caller ID |
| `SIP_DEMO_TO_NUMBER` | Override all SIP calls to this number (for testing) |
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
- **Top bar:** patient profile + "Call AI Assistant" button + agent state
- **Left panel:** all doctors as compact cards
- **Right panel:** selected doctor detail with 3 tabs — Profile, Call History, Appointments
- "Request Appointment" button per doctor (inline form)
- Call overlay with Akool avatar / wave visualizer during active call
- Auto-navigates to correct doctor's Appointments tab when post-call extraction creates one

### Doctor Page Layout
- **Top bar:** doctor profile + "Call AI Assistant" button + agent state
- **Left panel:** all patients as compact cards
- **Right panel:** selected patient detail with 3 tabs — Profile, Call History, Appointments
- "Post-Op Check-In Call" button per patient — prompts for phone number, initiates SIP call
- Live transcript panel during SIP call with real-time AI/Patient dialogue
- Confirm/Decline buttons on appointment requests addressed to this doctor
- SSE connection for live updates (summaries, appointments)

---

## File Map

```
backend/
  server.js                    # Express app, route wiring, serveHtml()
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
    database.js                # createDb(path) — SQLite schema: profiles, call_summaries, appointments,
                               #   patient_profile_summaries, care_plans, media_attachments, sse_events
    seed.js                    # seed(db) — 2 patients + 4 doctors + 1 care plan, INSERT OR IGNORE

frontend/
  index.html                   # Landing page
  patient.html / patient.js    # Patient portal (master-detail layout)
  doctor.html  / doctor.js     # Doctor dashboard (master-detail layout + SIP call lifecycle)
  shared/
    theme.css                  # Teal/mint CSS variables, master-detail layout, tabs, appointment cards,
                               #   SIP live panel, all component styles
    profile-modal.js           # ProfileModal class — open(profile), close()
  utils/
    config.js                  # API.agora.*, API.healthcare.*, STORAGE.*, UTILS.*
    chat.js                    # ChatManager class
    audioVisualizer.js         # Audio frequency visualizer

tests/
  setup.js                     # Sets NODE_ENV=test
  healthcare.test.js           # 24 tests — profiles, summaries, appointments CRUD
  agoraController.test.js      # 6 tests for buildSystemPrompt
  server.test.js               # 5 tests for route/HTML serving
  db/database.test.js          # DB schema tests
  db/seed.test.js              # Seeder tests (6 profiles, idempotency)
  sse.test.js                  # SSE manager tests
  summarize.integration.test.js  # Real LLM integration tests (run separately)
```

---

## Demo Personas (seeded in DB)

| ID | Name | Role | Notes |
|----|------|------|-------|
| `patient-1` | Sarah Chen, 34 | Patient | Hypertension, mild anxiety |
| `patient-2` | Marcus Johnson, 52 | Patient | Post-knee-surgery recovery; has a care plan |
| `doctor-1` | Dr. James Williams | Doctor | Cardiologist, Sydney General |
| `doctor-2` | Dr. Priya Patel | Doctor | Orthopaedic Surgeon, Sydney General |
| `doctor-3` | Dr. Emily Nguyen | Doctor | GP, Sunrise Medical Centre |
| `doctor-4` | Dr. Amir Hassan | Doctor | Neurologist, Sydney General |

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/events` | SSE stream (no auth — registered before basicAuth) |
| GET | `/api/agora/channel-info?channel=&uid=` | RTC/RTM token generation |
| POST | `/api/agora/start` | Start ConvoAI agent (web call) |
| POST | `/api/agora/call` | Start ConvoAI agent + SIP phone call |
| DELETE | `/api/agora/stop/:agentId` | Stop ConvoAI agent |
| POST | `/api/agora/stop/:agentId` | Stop agent (POST alias for sendBeacon) |
| GET | `/api/agora/status/:agentId` | Agent status (STARTING/RUNNING/STOPPED) |
| GET | `/api/healthcare/profiles?role=` | List profiles |
| GET | `/api/healthcare/profiles/:id` | Single profile |
| GET | `/api/healthcare/summaries?patient_id=` | Call summaries (optional patient filter) |
| POST | `/api/healthcare/summaries` | Save summary after call |
| POST | `/api/healthcare/summarize` | LLM-generate structured summary from transcript |
| GET | `/api/healthcare/profile-summary/:patientId` | Consolidated patient profile summary |
| GET | `/api/healthcare/appointments?patient_id=` | List appointments (by patient) |
| GET | `/api/healthcare/appointments?doctor_id=` | List appointments (by doctor) |
| POST | `/api/healthcare/appointments` | Create appointment (status: requested) |
| PUT | `/api/healthcare/appointments/:id` | Confirm/decline appointment |
| GET | `/api/healthcare/care-plans/:patientId` | Get care plan |
| PUT | `/api/healthcare/care-plans/:id` | Approve/edit care plan |

---

## Key Flows

### 1. Patient calls AI Assistant
1. Patient clicks "Call AI Assistant" → frontend joins RTC+RTM, starts ConvoAI agent
2. Agent prompt includes: patient profile, appointments, consolidated history, available doctors, current Australian time
3. Akool avatar renders AI face + ElevenLabs voice; RTM carries live transcript
4. Patient can discuss symptoms, ask questions, or request appointments
5. On "End Call" → transcript sent to LLM for structured summary extraction
6. Summary saved; appointment(s) created if discussed; profile summary regenerated
7. Patient page auto-navigates to the relevant doctor's Appointments tab
8. Doctor page receives SSE notification

### 2. Doctor initiates Post-Op SIP Call
1. Doctor selects patient → clicks "Post-Op Check-In Call" → enters phone number
2. Backend calls Agora `/call` API with SIP block (to_number, from_number)
3. Patient's phone rings; AI greets with doctor's name and hospital
4. Doctor page joins RTM to capture live transcript (displayed in real-time panel)
5. Status polling every 3s shows call state (Ringing → In Progress → Completed)
6. When call ends (hangup, timeout, or doctor clicks Stop): transcript summarized and saved
7. SIP timeouts: 30s ring, 5 min max duration, 60s silence → hangup

### 3. Doctor calls AI Assistant
Doctor clicks "Call AI Assistant" → same RTC+RTM flow as patient, uses `PROMPT_DOCTOR_ASSISTANT`, includes consolidated patient profiles for context.

### 4. Appointment Lifecycle
- Patient requests (via AI call or manual form) → status: `requested`
- Doctor sees appointment in patient detail → Confirm / Decline buttons
- Patient page refreshes on tab focus (no SSE — avoids HTTP/1.1 connection limit)
- Multiple appointments per call supported (LLM extracts array)

---

## Architecture Decisions & Gotchas

### SSE route before basicAuth
`EventSource` can't set auth headers. `/events` is wired before `app.use('/api', basicAuth)`.

### No in-call structured tags
Voice TTS reads ALL LLM output aloud. Tags like `<appointment>` would be spoken as "less than appointment greater than...". All structured extraction happens post-call via the `/summarize` endpoint.

### Akool avatar + ElevenLabs TTS
When avatar is enabled, the avatar UID publishes audio (not the agent UID). The `handleRTCUserPublished` handler checks both: `user.uid == agentUID || (avatarUID && user.uid == avatarUID)`. If the avatar fails to publish within 5 seconds but agent is RUNNING, `onCallStarted()` is force-triggered.

### HTTP/1.1 connection limit
Browsers limit ~6 concurrent connections per domain. Two SSE connections (patient + doctor page) can block API calls. Solution: only the doctor page uses SSE. Patient page uses `visibilitychange` to refresh on tab focus.

### Auth credentials injected into HTML
`serveHtml()` injects `window.APP_AUTH_USERNAME` / `window.APP_AUTH_PASSWORD` into `<head>`. Frontend reads these for API `Authorization` headers.

### Call lifecycle — edge cases handled
- **Tab close/refresh:** `beforeunload` fires `navigator.sendBeacon` to POST `/api/agora/stop/:agentId`
- **Network drop:** RTC `connection-state-change` to `DISCONNECTED` triggers auto-cleanup
- **Agent dies unexpectedly:** `user-left` event auto-triggers `stopCall()`
- **Agent status 404:** Backend returns `{ status: 'STOPPED' }` instead of 500

### Full transcript saved with summaries
`call_summaries.transcript` stores the full conversation as a JSON array of `{role, content}` objects. Passed from the frontend alongside the LLM-generated summary when calling `POST /api/healthcare/summaries`. Displayed in Call History tabs via a "Show Transcript" toggle button (hidden by default).

### Profile summary regeneration
After each call summary is saved, the backend regenerates a consolidated profile summary for that patient (all calls → LLM → single concise summary). Next call injects this instead of raw records. Retry with backoff for rate limits.

### SIP call request structure
`sip` block is **top-level** (same level as `name` and `properties`), NOT inside `properties`. Phone numbers must have no spaces.

### Multi-user safety
All call state (agent IDs, channels) is scoped per browser tab/session. One user cannot stop another's call.

---

## Future Work

- **Server-side transcript capture:** Currently transcripts only exist in browser memory. If user closes tab, transcript is lost. SIP calls have no browser. Need server-side RTM listener or Agora webhook to capture transcripts independently. (See memory: `project_server_side_transcript.md`)
- **SIP RTM transcript:** Feature is implemented on frontend but requires Agora to enable RTM for SIP calls on the AppID. Once enabled, live transcript will appear on doctor page during SIP calls.

### Dual LLM setup
Live conversation uses OpenAI (`LLM_URL` / `LLM_API_KEY`) — this is what Agora ConvoAI calls. Post-call summarization uses Moonshot (`SUMMARIZE_LLM_URL` / `SUMMARIZE_LLM_API_KEY`) — a separate provider to avoid regional restrictions. If Moonshot is rate-limited, summaries fail silently (call still works). Profile summary regeneration has retry with backoff; the `/summarize` endpoint does not.

---

## Deployment

### Vercel

`vercel.json` is pre-configured. The app runs as a serverless function via `@vercel/node`.

**SQLite on Vercel:** DB is stored in `/tmp` (auto-detected via `process.env.VERCEL`). Data resets on cold starts — seed data is re-created automatically. For a demo this is fine. For persistence, migrate to Turso or PlanetScale.

**Steps:**
1. Push to GitHub (see below)
2. Go to [vercel.com](https://vercel.com) → "Add New Project" → Import your GitHub repo
3. Leave Root Directory as `.`, Build Command as default
4. Add all environment variables from `.env` in the Vercel dashboard:
   - `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `AGORA_API_KEY`, `AGORA_API_SECRET`
   - `LLM_URL`, `LLM_API_KEY`, `LLM_MODEL`
   - `TTS_ELEVENLABS_API_KEY`, `TTS_ELEVENLABS_VOICE_ID`, `TTS_ELEVENLABS_MODEL_ID`
   - `AKOOL_API_KEY`, `AKOOL_AVATAR_ID`
   - `SUMMARIZE_LLM_URL`, `SUMMARIZE_LLM_API_KEY`, `SUMMARIZE_LLM_MODEL`
   - `SIP_FROM_NUMBER`
   - `PROMPT_PATIENT`, `PROMPT_POST_OP_CARE`, `PROMPT_DOCTOR_ASSISTANT`
5. Deploy

**Note:** `better-sqlite3` is a native C++ module. Vercel compiles it during build on their Linux servers. If it fails, add `npm install --force` as the Install Command in Vercel settings.

### GitHub

```bash
git add -A
git commit -m "Healthcare AI demo — voice calls, appointments, SIP, avatar, transcript"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

`.gitignore` already excludes `.env`, `healthcare.db`, `node_modules/`, and `.superpowers/`.

---

## Design Specs

- **Original spec:** `docs/superpowers/specs/2026-04-15-healthcare-ai-demo-design.md`
- **Appointment module spec:** `docs/superpowers/specs/2026-04-17-appointment-module-design.md`
