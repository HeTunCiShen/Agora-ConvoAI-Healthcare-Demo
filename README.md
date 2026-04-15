# Healthcare AI Demo

A healthcare AI voice demo built on the **Agora ConvoAI Web Template**. Showcases an AI clinical assistant across four scenarios: patient pre-session intake, post-op care follow-up, doctor AI assistant, and a real-time structured summary feed delivered to the doctor's dashboard.

Built with: Node.js + Express, vanilla JS, Agora RTC/RTM SDK, SQLite, OpenAI-compatible LLM, MiniMax TTS.

---

## Pages

| URL | Description |
|-----|-------------|
| `/` | Landing page |
| `/patient` | Patient experience — call AI doctor or start post-op check-in |
| `/doctor` | Doctor dashboard — live patient summary feed + AI clinical assistant |

Both pages show a profile picker on first visit. No login required for the demo.

---

## Quick Start

### Prerequisites

- Node.js v14+
- Agora account with App ID, App Certificate, and Conversational AI enabled
- OpenAI-compatible LLM API key
- MiniMax TTS credentials (or substitute another TTS vendor)

### Installation

```bash
git clone <repo-url>
cd Agora_ConvoAI_Web_Template
npm install --force
cp .env.example .env
# Edit .env with your credentials
npm start
```

Open `http://localhost:3000`.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

### Required

```env
# Agora — https://console.agora.io/
AGORA_APP_ID=
AGORA_APP_CERTIFICATE=
AGORA_API_KEY=
AGORA_API_SECRET=

# LLM (OpenAI-compatible endpoint)
LLM_URL=https://api.openai.com/v1/chat/completions
LLM_VENDOR=openai
LLM_API_KEY=
LLM_MODEL=gpt-4o-mini

# TTS — MiniMax
TTS_MINIMAX_API_KEY=
TTS_MINIMAX_GROUP_ID=
TTS_MINIMAX_VOICE_ID=English_PlayfulGirl
```

### Optional

```env
# HTTP Basic Auth (leave blank to disable)
AUTH_USERNAME=
AUTH_PASSWORD=

# Server
PORT=3000

# Healthcare AI system prompts (defaults built-in if omitted)
PROMPT_PATIENT=...
PROMPT_POST_OP_CARE=...
PROMPT_DOCTOR_ASSISTANT=...
```

---

## Demo Personas

The database is seeded automatically on first start.

**Patients**

| Name | Age | Condition |
|------|-----|-----------|
| Sarah Chen | 34 | Hypertension, mild anxiety |
| Marcus Johnson | 52 | Post-knee-surgery recovery (has care plan) |

**Doctors**

| Name | Specialty |
|------|-----------|
| Dr. James Williams | Cardiologist |
| Dr. Priya Patel | Orthopaedic Surgeon |

---

## Features

### Patient Page
- **Call AI Doctor** — AI greets patient by name with full medical context, handles pre-session intake / condition check / post-session questions
- **Post-Op Care Check-In** — AI follows up on recovery, reviews care plan, flags concerns
- At end of call, AI outputs a structured JSON summary which is automatically saved and pushed to the doctor's dashboard

### Doctor Page
- **Live summary feed** — New patient call summaries appear instantly via Server-Sent Events (no polling)
- Each card shows: chief complaint, symptoms, vitals, medications discussed, AI recommendation, urgency badge, suggested action
- **Approve Care Plan** button on post-op summaries
- **Call AI Assistant** — AI clinical assistant answers drug interactions, treatment protocols, dosage questions

### Both Pages
- Real-time voice via Agora RTC
- Live text chat alongside voice via Agora RTM
- Audio visualizer
- Expandable profile modal
- "Switch user" to change persona

---

## Project Structure

```
backend/
  server.js                    # Express app entry point
  sse.js                       # Server-Sent Events manager
  controllers/
    agoraController.js         # Agora ConvoAI API, prompt injection
    healthcareController.js    # Profiles, summaries, care plans
  routes/
    agora_routes.js            # /api/agora/*
    healthcare_routes.js       # /api/healthcare/*
  middleware/
    auth.js                    # HTTP Basic Auth
  db/
    database.js                # SQLite schema (better-sqlite3)
    seed.js                    # Demo data seeder

frontend/
  index.html                   # Landing page
  patient.html / patient.js    # Patient experience
  doctor.html  / doctor.js     # Doctor dashboard
  shared/
    theme.css                  # Teal/mint healthcare theme
    profile-modal.js           # Expandable profile modal
  utils/
    config.js                  # API client, shared utilities
    chat.js                    # Chat panel component
    audioVisualizer.js         # Audio visualizer

tests/                         # Jest + Supertest — 37 tests
docs/superpowers/
  specs/                       # Design specification
  plans/                       # Implementation plan
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/events` | SSE stream for live updates (no auth) |
| GET | `/api/agora/channel-info` | Get RTC/RTM token |
| POST | `/api/agora/start` | Start ConvoAI agent |
| DELETE | `/api/agora/stop/:agentId` | Stop ConvoAI agent |
| GET | `/api/healthcare/profiles` | List profiles (`?role=patient\|doctor`) |
| GET | `/api/healthcare/profiles/:id` | Single profile |
| GET | `/api/healthcare/summaries` | All call summaries |
| POST | `/api/healthcare/summaries` | Save summary after call |
| GET | `/api/healthcare/care-plans/:patientId` | Get patient care plan |
| PUT | `/api/healthcare/care-plans/:id` | Update care plan |

---

## Development

```bash
npm run dev    # nodemon auto-reload
npm test       # run all 37 tests
```

Tests use an in-memory SQLite database — no setup needed.

---

## AI System Prompts

Three prompt templates are loaded from `.env`. Patient/doctor profile is injected as context at call start.

- `PROMPT_PATIENT` — Patient assistant. Handles pre-session, condition check, and post-session via conversational routing. Outputs a structured JSON summary at end of call (required for doctor feed).
- `PROMPT_POST_OP_CARE` — Post-operative follow-up. Reviews care plan, checks pain levels and medication adherence.
- `PROMPT_DOCTOR_ASSISTANT` — Clinical assistant for doctors. Answers medical questions directly and professionally.

Default values are built in if the env vars are not set.

---

## Security Notes

- Auth credentials are injected server-side into page HTML so the browser can use Basic Auth for API calls
- The `/events` SSE endpoint has no auth (browser `EventSource` cannot send auth headers)
- Never commit `.env` to version control
- Use HTTPS in production

---

## License

MIT
