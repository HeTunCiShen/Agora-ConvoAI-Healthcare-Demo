# Appointment Time Slots & Conflict Detection — Design

**Date:** 2026-06-07
**Status:** Approved (design), pending implementation plan
**Author:** Maintainer pass (Sunrise Australia demo)

## Goal

Make the appointment module feel real by adding **time-of-day slots** and
**conflict detection**:

- Bookable hours are **08:00–16:00**, in **30-minute slots**. First slot 08:00,
  last slot **15:30** (ends 16:00). Start times must be on `:00` or `:30`.
- A slot already taken by that doctor is **unavailable**. The AI tells the user
  it is not available and offers the day's open times.
- Out-of-hours / conflicting bookings are rejected everywhere: the manual form,
  the live call (best-effort), and post-call transcript extraction (authoritative).
- The agent prompt carries the **operator's current local time** so the demo
  works across timezones. SIP calls use the **doctor page's** browser time.
- Seed sample data (call summaries + appointments) moves to **after 2026-06-15**
  onto valid, non-conflicting slots.

## Key decision: "floating wall-clock" time (no timezone)

Appointment times are stored **timezone-naive**: `YYYY-MM-DDTHH:MM:00` with **no
`Z` and no offset**. The `"14:00"` value is an abstract slot label shared by all
users; **no timezone conversion is performed**.

- A Sydney user sees a DB session as "2pm" and booking 2pm collides with it.
- A Korea user sees the same DB session as "2pm"; booking 2pm also collides.

Both read the stored `"14:00"` as their own local 2pm, but it is the same number,
so they share one wall-clock calendar.

**Consequence / required change:** today the code stores `new Date(dt).toISOString()`
(UTC `Z`) and displays with `toLocaleString()` (browser-tz conversion), which
drifts per timezone. We switch to:

- **Store** naive strings (no `Z`).
- **Display** the wall clock directly (parse the naive string's date/HH:MM, do
  not tz-convert).
- **Compare/conflict** on the naive wall-clock value (slot key = `doctor_id` +
  naive `date_time`), not on epoch milliseconds.

This is "floating time" — not real timezone handling, but intentional and ideal
for a multi-timezone shared-calendar demo.

## Slot model — `backend/lib/slots.js` (new shared module)

Constants: `BUSINESS_START_HOUR = 8`, `BUSINESS_END_HOUR = 16`, `SLOT_MINUTES = 30`.

Functions (all operate on naive wall-clock strings/values, no `Date` tz math):

- `parseNaive(dt)` → `{ date: 'YYYY-MM-DD', hour, minute, key }` or `null`.
- `normalizeNaive(dt)` → strip any trailing `Z`/offset, round/return canonical
  `YYYY-MM-DDTHH:MM:00`; used to sanitize LLM and client input.
- `isValidSlot(dt)` → true if minute ∈ {0,30} and `8:00 <= start < 16:00`
  (i.e. last valid start is 15:30).
- `enumerateSlots(date)` → `['08:00', '08:30', …, '15:30']`.
- `getBookedSlots(db, doctorId, date)` → naive `date_time`s for that doctor+date
  whose `status IN ('requested','confirmed')`.
- `getAvailableSlots(db, doctorId, date)` → `enumerateSlots(date)` minus booked.
- `findConflict(db, doctorId, dt)` → existing requested/confirmed row at same slot
  (or `null`).

Conflict status policy: **`requested` and `confirmed` occupy** a slot; `declined`
frees it.

## Backend changes — `healthcareController.js`, routes

1. **`createAppointment`** (`POST /appointments`): normalize `date_time`; reject
   with `422 { error, reason:'out_of_hours' }` if `!isValidSlot`; reject with
   `409 { error, reason:'conflict', available:[…] }` if `findConflict`. Otherwise
   insert as today (status `requested`).
2. **New `GET /availability?doctor_id=&date=YYYY-MM-DD`** → `{ date, available:[],
   booked:[] }`. Consumed by the manual form and (optionally) prompt building.
3. **`/summarize`** post-processing: after the LLM result and
   `filterSpuriousAppointmentRequests`, run a **validation pass** over
   `appointment_requests`:
   - normalize each `date_time` to naive;
   - drop if `!isValidSlot`;
   - drop if it conflicts with an existing requested/confirmed appointment **or**
     with another request already accepted earlier in the same batch;
   - return only survivors. (Authoritative — rejected requests are never written.)

## Frontend — manual form (`patient.js`, and `doctor.js` if it has the form)

- Replace the single `datetime-local` with **`<input type="date">` + a slot
  `<select>`**.
- On date change → `GET /availability` → populate the dropdown with **free slots
  only** (label e.g. `8:00 AM`). If none free → disabled option "No slots
  available this day."
- Submit posts `date_time` as naive `YYYY-MM-DDTHH:MM:00`.
- Handle `409`/`422` from the server defensively (show a short inline message and
  refresh availability), in case the slot was taken between fetch and submit.
- **Display**: render existing appointment times from the naive string directly
  (no `toLocaleString` tz-convert). A small helper formats `YYYY-MM-DDTHH:MM` →
  `Jun 16, 2026 · 2:00 PM`.

## Frontend — call flow / prompt (`patient.js`, `doctor.js`, `agoraController.js`)

- Build "current date and time" from the **operator's browser local time** (wall
  clock); drop the misleading `(Australian time)` label.
  - Web patient call → patient page time. Web doctor call → doctor page time.
  - **SIP post-op call → doctor page time** (patient has no browser).
- Inject **booking rules** into the prompt: 30-minute slots, 08:00–16:00, last
  start 15:30, only `:00`/`:30`.
- Inject, per available doctor, their **booked slots for the next ~7 days**
  (naive values, status requested/confirmed). The agent computes free times
  itself and, on a clash, replies "that time isn't available; today's open times
  are …". Live guidance is best-effort; post-call validation is authoritative.

## Seed data — `seed.js`

- **Mock call summaries**: move `created_at` to ~**2026-06-15/06-16** (recent
  history). Assumes the event/demo date is on/after 2026-06-15.
- **Mock appointments**: move `date_time` to **2026-06-16 and later**, each on a
  **valid slot** (`:00`/`:30`, 08:00–15:30), naive format (no `Z`), with **no two
  appointments sharing a doctor+slot**. Keep the existing status mix
  (confirmed/requested). Note: `patient-2` has two appointments with `doctor-2` —
  they must use different slots/days.

## Testing

- **New** `tests/slots.test.js`: `isValidSlot` boundaries (08:00 ok, 15:30 ok,
  16:00 invalid, 07:30 invalid, 14:15 invalid), `enumerateSlots`,
  `getBookedSlots`/`getAvailableSlots`, `findConflict` (requested & confirmed
  block, declined frees).
- **Update/extend** `tests/summarize.test.js`: out-of-hours request dropped;
  conflicting request dropped; two requests for the same slot in one batch → one
  survives; valid distinct requests pass.
- **Update** any existing appointment tests that assumed `Z`/UTC storage to the
  naive format.

## Out of scope / non-goals

- Real timezone conversion or per-clinic timezones (intentionally "floating").
- Rescheduling UI, recurring appointments, slot duration other than 30 min.
- Surfacing per-request rejection reasons to the patient after a call (the agent
  already explains verbally; invalid requests are silently dropped).
