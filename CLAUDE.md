# CLAUDE.md — Healthcare AI Demo

This is a **Healthcare AI Voice Demo** built on top of the Agora ConvoAI Web Template. It showcases AI-assisted healthcare scenarios using Agora RTC (voice) + RTM (messaging).

**Event:** Sunrise Australia (2026-04-15)  
**Stack:** Node.js + Express, vanilla JS, Agora RTC/RTM SDK, SQLite (better-sqlite3), Jest + Supertest

---

## Running the Project

```bash
npm install --force   # first time only
npm start             # production server at http://localhost:3000
npm run dev           # dev server with nodemon auto-reload
npm test              # 37 tests, 6 suites — all should pass
```

Set credentials in `.env` (copy from `.env.example`). Required: `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `AGORA_API_KEY`, `AGORA_API_SECRET`, `LLM_URL`, `LLM_API_KEY`.

---

## Pages

| URL | Description |
|-----|-------------|
| `/` | Landing page — links to /patient and /doctor |
| `/patient` | Patient page — call AI doctor, post-op check-in |
| `/doctor` | Doctor dashboard — live summary feed + AI assistant |

Both `/patient` and `/doctor` show a profile picker on first load (stored in `sessionStorage`). "Switch user" clears it and reloads.

---

## File Map

```
backend/
  server.js                    # Express app, route wiring, serveHtml()
  sse.js                       # SSE client set: addClient(), broadcast(), getClientCount()
  controllers/
    agoraController.js         # Agora ConvoAI API calls, buildSystemPrompt()
    healthcareController.js    # makeHealthcareController(db, sse) factory — 7 methods
  routes/
    agora_routes.js            # /api/agora/*
    healthcare_routes.js       # /api/healthcare/* (NOT the SSE route — see gotchas)
  middleware/
    auth.js                    # HTTP Basic Auth middleware
  db/
    database.js                # createDb(path) — SQLite schema, 5 tables
    seed.js                    # seed(db) — 4 profiles + 1 care plan, INSERT OR IGNORE

frontend/
  index.html                   # Landing page
  patient.html / patient.js    # Patient experience
  doctor.html  / doctor.js     # Doctor dashboard
  shared/
    theme.css                  # Teal/mint CSS variable overrides (does not modify styles.css)
    profile-modal.js           # ProfileModal class — open(profile), close()
  utils/
    config.js                  # API.*, STORAGE.*, UTILS.* — shared by all pages
    chat.js                    # ChatManager class
    audioVisualizer.js         # Audio frequency visualizer

tests/
  setup.js                     # Sets NODE_ENV=test
  healthcare.test.js           # 13 tests for healthcare API
  agoraController.test.js      # 6 tests for buildSystemPrompt
  server.test.js               # 5 tests for route/HTML serving
  db/database.test.js          # DB schema tests
  db/seed.test.js              # Seeder tests
  sse.test.js                  # SSE manager tests
```

---

## Demo Personas (seeded in DB)

| ID | Name | Role | Notes |
|----|------|------|-------|
| `patient-1` | Sarah Chen, 34 | Patient | Hypertension, mild anxiety |
| `patient-2` | Marcus Johnson, 52 | Patient | Post-knee-surgery recovery; has a care plan |
| `doctor-1` | Dr. James Williams | Doctor | Cardiologist, Sydney General |
| `doctor-2` | Dr. Priya Patel | Doctor | Orthopaedic Surgeon, Sydney General |

---

## Architecture Decisions & Gotchas

### 1. SSE route must be registered BEFORE basicAuth

`EventSource` (browser native) cannot set auth headers. The `/events` SSE route is wired in `server.js` **before** `app.use('/api', basicAuth)`. It has no `/api/` prefix on purpose.

```js
app.get('/events', (req, res) => addClient(res));   // ← BEFORE basicAuth
app.use('/api', basicAuth);
app.use('/api/healthcare', healthcareRouter);
```

`healthcare_routes.js` does NOT register the SSE route — only the HTTP API routes. This is intentional.

### 2. `rawAiMessages[]` for summary extraction

The AI embeds a JSON summary at end of call inside `<summary>...</summary>` tags. In `patient.js`, a module-level `rawAiMessages = []` array preserves the raw full text **before** ChatManager strips the tags for display. `extractSummary()` scans this array backwards for the tag.

Do not replace this with `chatManager.currentSessionMessages` — ChatManager stores the cleaned version.

### 3. Profile context injection into prompts

`buildSystemPrompt(promptType, profileContext)` in `agoraController.js` prepends the patient/doctor profile as plain text before the prompt template:

```js
return profileContext ? `${profileContext}\n\n${template}` : template;
```

`promptType` values: `'patient'` | `'post-op'` | `'doctor'`  
Corresponding env vars: `PROMPT_PATIENT` | `PROMPT_POST_OP_CARE` | `PROMPT_DOCTOR_ASSISTANT`

### 4. Auth credentials injected into HTML

`serveHtml(filePath, res)` in `server.js` injects `window.APP_AUTH_USERNAME` and `window.APP_AUTH_PASSWORD` into `<head>` before serving. The frontend `config.js` reads these to add `Authorization: Basic ...` headers to all API calls.

If `</head>` is missing from an HTML file, `server.js` logs a `console.error` (it used to silently fail).

### 5. In-memory DB for tests

`healthcare_routes.js` checks `process.env.NODE_ENV === 'test'` to use `:memory:` instead of `healthcare.db`. `tests/setup.js` sets this before any test runs.

### 6. `require.main === module` guard

`server.js` only calls `app.listen()` when run directly — not when `require()`d by tests. This is what makes Supertest work without port conflicts.

### 7. `encodeURIComponent` in inline onclick

`buildSummaryCard()` in `doctor.js` uses `encodeURIComponent(s.patient_id)` in both the `data-patient-id` attribute and the inline `onclick`. `approvePlan()` decodes with `decodeURIComponent`. This prevents XSS and handles patient IDs with special characters.

### 8. Post-op summary saving

`stopCall()` in `patient.js` saves summaries for **both** `'patient'` and `'post-op'` call types — not just `'patient'`. The condition is:

```js
if (summary && (currentCallType === 'patient' || currentCallType === 'post-op') && selectedProfile)
```

### 9. Race condition on double-click

`startCall()` in `patient.js` disables **both** call buttons at the very top before any `await`. They're re-enabled in the error path. This prevents launching two agents simultaneously.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/events` | SSE stream (no auth — before basicAuth middleware) |
| GET | `/api/agora/channel-info?channel=&uid=` | RTC/RTM token |
| POST | `/api/agora/start` | Start ConvoAI agent |
| DELETE | `/api/agora/stop/:agentId` | Stop ConvoAI agent |
| GET | `/api/healthcare/profiles?role=patient\|doctor` | List profiles |
| GET | `/api/healthcare/profiles/:id` | Single profile |
| GET | `/api/healthcare/summaries` | All call summaries |
| POST | `/api/healthcare/summaries` | Save summary after call |
| GET | `/api/healthcare/care-plans/:patientId` | Get care plan |
| PUT | `/api/healthcare/care-plans/:id` | Approve/edit care plan |

---

## Key Flows

### Patient call → summary → doctor feed
1. Patient clicks "Call AI Doctor" → `startCall('patient')`
2. Frontend fetches RTC token, joins RTC+RTM channels
3. Backend starts ConvoAI agent with injected profile context
4. AI speaks; RTM carries transcription messages
5. AI embeds `<summary>{...}</summary>` at end of call
6. Patient clicks "End Call" → `stopCall()` extracts summary from `rawAiMessages[]`
7. Frontend POSTs summary to `/api/healthcare/summaries`
8. Backend saves to SQLite, broadcasts via SSE
9. Doctor page receives SSE event, prepends card to feed

### Post-op call
Same as above but `startCall('post-op')` — fetches care plan first, appends to profile context, uses `PROMPT_POST_OP_CARE`.

### Doctor call
`startCall()` in `doctor.js` — no summary extraction; uses `PROMPT_DOCTOR_ASSISTANT`.

---

## Design Spec & Plan

- **Spec:** `docs/superpowers/specs/2026-04-15-healthcare-ai-demo-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-04-15-healthcare-ai-demo.md`
