// frontend/doctor.js
(function () {
  // ===========================
  // STATE
  // ===========================
  let selectedProfile = null;
  let eventSource = null;
  let rtcClient = null;
  let rtcLocalAudioTrack = null;
  let rtcJoined = false;
  let rtcRemoteUsers = {};
  let rtmClient = null;
  let agoraChannel = null;
  let agoraChannelInfo = null;
  let agoraUserUID = Math.floor(Math.random() * 100000) + 1000;
  let agentUID = null;
  let agoraConvoAIAgentID = null;
  let avatarUID = null;
  let chatManager = null;
  const profileModal = new ProfileModal();

  // Master-detail state
  let allPatients = [];
  let selectedPatientId = null;

  // SIP call state
  let sipAgentId = null;
  let sipChannel = null;
  let sipPatient = null;
  let sipRtmClient = null;
  let sipTranscript = [];
  let sipPollTimer = null;

  // ===========================
  // INIT
  // ===========================
  async function init() {
    const stored = sessionStorage.getItem('selectedDoctor');
    if (!stored) {
      await showProfileSelection();
    } else {
      selectedProfile = JSON.parse(stored);
      await initMainPage();
    }
  }

  async function showProfileSelection() {
    document.getElementById('profile-selection').classList.remove('hidden');
    document.getElementById('main-page').classList.add('hidden');
    try {
      const profiles = await API.healthcare.listProfiles('doctor');
      const container = document.getElementById('doctor-cards');
      container.innerHTML = profiles.map(p => `
        <div class="profile-select-card" data-id="${p.id}">
          <div class="avatar">${p.avatar}</div>
          <div class="card-name">${p.name}</div>
          <div class="card-detail">${p.specialty || ''}</div>
        </div>
      `).join('');
      container.querySelectorAll('.profile-select-card').forEach(card => {
        card.addEventListener('click', () => selectProfile(card.dataset.id));
      });
    } catch (e) {
      console.error('Failed to load profiles', e);
    }
  }

  async function selectProfile(profileId) {
    const profile = await API.healthcare.getProfile(profileId);
    sessionStorage.setItem('selectedDoctor', JSON.stringify(profile));
    selectedProfile = profile;
    await initMainPage();
  }

  async function initMainPage() {
    document.getElementById('profile-selection').classList.add('hidden');
    document.getElementById('main-page').classList.remove('hidden');
    renderTopBar(selectedProfile);
    await loadPatientCards();
    connectSSE();
    initAgoraClients();
    setupEventListeners();
    chatManager = new ChatManager();
    chatManager.initialize();
  }

  // ===========================
  // TOP BAR
  // ===========================
  function renderTopBar(p) {
    const container = document.getElementById('top-bar-profile');
    container.innerHTML = `
      <div class="avatar">${p.avatar}</div>
      <div>
        <div class="profile-name" id="open-profile-modal">${p.name}</div>
        <div class="profile-meta">${p.specialty || ''} · ${p.hospital || ''}</div>
      </div>
    `;
    document.getElementById('open-profile-modal').addEventListener('click', () => profileModal.open(p));
  }

  // ===========================
  // MASTER PANEL — PATIENT CARDS
  // ===========================
  async function loadPatientCards() {
    try {
      allPatients = await API.healthcare.listProfiles('patient');

      const container = document.getElementById('patient-list');
      const cardsHtml = allPatients.map(p => {
        return `
          <div class="master-card${selectedPatientId === p.id ? ' selected' : ''}" data-id="${p.id}">
            <div class="card-row">
              <div class="card-avatar">${p.avatar}</div>
              <div>
                <div class="card-name">${p.name}</div>
                <div class="card-sub">${p.condition || ''}</div>
              </div>
            </div>
          </div>
        `;
      }).join('');
      container.innerHTML = `<div class="panel-title">Patients</div>${cardsHtml}`;

      container.querySelectorAll('.master-card').forEach(card => {
        card.addEventListener('click', () => selectPatient(card.dataset.id));
      });

      if (allPatients.length > 0 && !selectedPatientId) {
        selectPatient(allPatients[0].id);
      }
    } catch (e) {
      console.error('Failed to load patient cards', e);
    }
  }

  async function selectPatient(patientId) {
    selectedPatientId = patientId;
    document.querySelectorAll('#patient-list .master-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.id === patientId);
    });
    await renderDetailPanel(patientId);
  }

  // ===========================
  // DETAIL PANEL
  // ===========================
  async function renderDetailPanel(patientId) {
    const patient = allPatients.find(p => p.id === patientId);
    if (!patient) return;

    const meds = Array.isArray(patient.medications) ? patient.medications.join(', ') : patient.medications || '';
    const panel = document.getElementById('detail-panel');

    panel.innerHTML = `
      <div class="detail-header">
        <div>
          <div class="detail-name">${patient.name}</div>
          <div class="detail-meta">Age ${patient.age || '?'} · ${patient.condition || ''} · ${meds || 'No medications'}</div>
        </div>
        <button class="btn-request-appt" id="btn-postop-call">📞 Post-Op Check-In Call</button>
      </div>
      <div class="tab-bar">
        <button class="tab active" data-tab="profile">Profile</button>
        <button class="tab" data-tab="calls">Call History</button>
        <button class="tab" data-tab="appointments">Appointments</button>
      </div>
      <div id="tab-profile" class="tab-content active"></div>
      <div id="tab-calls" class="tab-content"></div>
      <div id="tab-appointments" class="tab-content"></div>
    `;

    panel.querySelectorAll('.tab-bar .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.remove('active'));
        panel.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
      });
    });

    // Post-Op Check-In Call button
    document.getElementById('btn-postop-call').addEventListener('click', () => showPostOpCallForm(patient));

    renderProfileTab(patient);
    await renderCallHistoryTab(patientId);
    await renderAppointmentsTab(patientId);
  }

  // ===========================
  // SIP CALL — POST-OP CHECK-IN
  // ===========================
  function showPostOpCallForm(patient) {
    // Don't open if SIP call already active
    if (sipAgentId) return;

    const panel = document.getElementById('detail-panel');
    if (panel.querySelector('.sip-call-form')) return; // already open

    const form = document.createElement('div');
    form.className = 'appt-form sip-call-form';
    form.innerHTML = `
      <label>Patient phone number</label>
      <input type="tel" id="sip-phone" placeholder="+61 400 123 456" />
      <div id="sip-phone-error" style="color:#ef4444;font-size:11px;margin:-6px 0 8px;display:none;"></div>
      <div style="font-size:11px;color:#9ca3af;margin:-4px 0 10px;">Format: country code + number, e.g. +61 412 345 678 (AU) or +1 408 603 8971 (US)</div>
      <div class="form-actions">
        <button class="btn-request-appt" id="sip-confirm">Confirm & Call</button>
        <button class="btn" id="sip-cancel" style="padding:5px 12px;font-size:11px;">Cancel</button>
      </div>
    `;

    const header = panel.querySelector('.detail-header');
    header.after(form);

    form.querySelector('#sip-confirm').addEventListener('click', () => {
      const phone = form.querySelector('#sip-phone').value.trim();
      const errorEl = form.querySelector('#sip-phone-error');
      // Validate: must start with + and have at least 10 digits
      const digitsOnly = phone.replace(/[\s\-()]/g, '');
      if (!digitsOnly.match(/^\+\d{10,15}$/)) {
        errorEl.textContent = 'Please enter a valid phone number starting with + (e.g. +61412345678)';
        errorEl.style.display = 'block';
        return;
      }
      errorEl.style.display = 'none';
      form.remove();
      startPostOpCall(patient, digitsOnly);
    });
    form.querySelector('#sip-cancel').addEventListener('click', () => form.remove());
  }

  async function startPostOpCall(patient, phoneNumber) {
    const btn = document.getElementById('btn-postop-call');
    btn.disabled = true;
    btn.textContent = '⏳ Ringing...';
    sipPatient = patient;
    sipTranscript = [];

    // Step 1: Start the SIP call (critical — if this fails, abort)
    const meds = Array.isArray(patient.medications) ? patient.medications.join(', ') : patient.medications || '';
    let profileContext = [
      `Patient name: ${patient.name}`,
      `Age: ${patient.age}`,
      `Current conditions: ${patient.condition || 'None'}`,
      `Current medications: ${meds || 'None'}`
    ].join('\n');

    try {
      const ps = await API.healthcare.getProfileSummary(patient.id);
      profileContext += '\n\nConsolidated history:\n' + ps.summary_text;
    } catch (_) {}

    try {
      const plan = await API.healthcare.getCarePlan(patient.id);
      const planText = plan.plan_text.map(d => `${d.days}: ${d.instructions}`).join(' ');
      profileContext += '\n\nCare plan: ' + planText;
    } catch (_) {}

    const now = new Date();
    profileContext += `\n\nCurrent date and time: ${now.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })} (Australian time)`;

    sipChannel = UTILS.generateChannelName();
    let sipUid = null;
    try {
      const response = await API.agora.startSIPCall({
        channel: sipChannel,
        agentName: 'HealthAI_PostOp_' + sipChannel,
        toNumber: phoneNumber,
        promptType: 'post-op',
        profileContext,
        greetingMessage: `Hello ${patient.name}! This is your AI health assistant from ${selectedProfile.hospital || 'the clinic'}, calling on behalf of ${selectedProfile.name} for a post-op check-in. How are you feeling today?`
      });
      sipAgentId = response.agentId;
      sipUid = response.sipUid;
      console.log('[sipCall] started — agentId=%s channel=%s sipUid=%s', sipAgentId, sipChannel, sipUid);
    } catch (e) {
      console.error('[sipCall] failed to start:', e);
      btn.disabled = false;
      btn.textContent = '📞 Post-Op Check-In Call';
      sipAgentId = null;
      sipChannel = null;
      sipPatient = null;
      return;
    }

    // Step 2: Show live panel and start polling (non-critical — call is already running)
    showSipLivePanel();
    startSipStatusPoll();

    // Step 3: Join RTM to monitor transcript (optional — failure doesn't affect the call)
    try {
      await joinSipRTM(sipChannel);
    } catch (e) {
      console.warn('[sipCall] RTM join failed (transcript unavailable):', e.message);
    }
  }

  async function joinSipRTM(channel) {
    try {
      // Use a separate monitor UID (not SIP or agent UID) to observe RTM transcript
      const monitorUid = Math.floor(Math.random() * 100000) + 500000;
      const info = await API.agora.getChannelInfo(channel, monitorUid);
      sipRtmClient = new AgoraRTM.RTM(info.appId, monitorUid.toString());
      sipRtmClient.addEventListener('message', handleSipRTMMessage);
      await sipRtmClient.login({ token: info.token || null, uid: monitorUid.toString() });
      await sipRtmClient.subscribe(channel);
      console.log('[sipRTM] joined channel=%s monitorUid=%d token=%s', channel, monitorUid, info.token ? 'yes' : 'none');
    } catch (e) {
      console.error('[sipRTM] failed to join:', e);
    }
  }

  function handleSipRTMMessage(event) {
    console.log('[sipRTM] message event channelType=%s channelName=%s sipChannel=%s', event.channelType, event.channelName, sipChannel);
    if (event.channelType !== 'MESSAGE' || !sipChannel || event.channelName !== sipChannel) return;
    try {
      const parsed = typeof event.message === 'string' ? JSON.parse(event.message) : null;
      if (!parsed) return;
      console.log('[sipRTM] parsed object=%s text=%s', parsed.object, parsed.text?.substring(0, 50));

      if (parsed.object === 'assistant.transcription' && parsed.text) {
        console.log('[sipTranscript] AI:', parsed.text);
        const existing = sipTranscript.find(m => m.turnId === parsed.turn_id && m.role === 'ai');
        if (existing) {
          existing.content = parsed.text;
        } else {
          sipTranscript.push({ role: 'ai', content: parsed.text, turnId: parsed.turn_id });
        }
        updateSipLiveTranscript();
      } else if (parsed.object === 'user.transcription' && parsed.final === true && parsed.text) {
        console.log('[sipTranscript] Patient:', parsed.text);
        sipTranscript.push({ role: 'user', content: parsed.text });
        updateSipLiveTranscript();
      }
    } catch (e) {
      console.error('[sipRTM] parse error:', e);
    }
  }

  function showSipLivePanel() {
    const panel = document.getElementById('detail-panel');
    // Remove existing live panel if any
    const existing = panel.querySelector('.sip-live-panel');
    if (existing) existing.remove();

    const livePanel = document.createElement('div');
    livePanel.className = 'sip-live-panel';
    livePanel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="width:8px;height:8px;border-radius:50%;background:#ef4444;animation:pulse 0.8s infinite;display:inline-block;"></span>
          <strong style="font-size:13px;">Post-Op Call in Progress</strong>
        </div>
        <button class="btn-decline" id="sip-stop-btn">Stop Call</button>
      </div>
      <div id="sip-transcript" style="max-height:200px;overflow-y:auto;background:#f9fafb;border-radius:8px;padding:10px;font-size:12px;"></div>
    `;

    // Insert after header, before tabs
    const tabBar = panel.querySelector('.tab-bar');
    if (tabBar) tabBar.before(livePanel);
    else panel.prepend(livePanel);

    document.getElementById('sip-stop-btn').addEventListener('click', stopSipCall);

    const btn = document.getElementById('btn-postop-call');
    btn.textContent = '🔴 Call in Progress';
  }

  function updateSipLiveTranscript() {
    const container = document.getElementById('sip-transcript');
    if (!container) return;
    container.innerHTML = sipTranscript.map(m => {
      const label = m.role === 'ai' ? '<strong style="color:#0d9488;">AI:</strong>' : '<strong style="color:#2563eb;">Patient:</strong>';
      return `<div style="margin-bottom:6px;">${label} ${escapeHtml(m.content)}</div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  }

  function startSipStatusPoll() {
    if (sipPollTimer) clearInterval(sipPollTimer);
    let failCount = 0;
    sipPollTimer = setInterval(async () => {
      if (!sipAgentId) { clearInterval(sipPollTimer); return; }
      try {
        const st = await API.agora.getAgentStatus(sipAgentId);
        failCount = 0;
        console.log('[sipPoll] status=%s', st.status);

        const btn = document.getElementById('btn-postop-call');
        if (st.status === 'RUNNING' && btn) {
          btn.textContent = '🔴 Call in Progress';
        } else if (st.status === 'STARTING' && btn) {
          btn.textContent = '⏳ Ringing...';
        }

        // Agent stopped — call ended
        if (st.status !== 'RUNNING' && st.status !== 'STARTING') {
          console.log('[sipPoll] agent stopped (status=%s) — cleaning up', st.status);
          clearInterval(sipPollTimer);
          await onSipCallEnded();
        }
      } catch (e) {
        failCount++;
        console.warn('[sipPoll] status check failed (attempt %d):', failCount, e);
        // If status check fails 3 times in a row, assume agent stopped
        if (failCount >= 3) {
          console.log('[sipPoll] 3 consecutive failures — assuming agent stopped');
          clearInterval(sipPollTimer);
          await onSipCallEnded();
        }
      }
    }, 3000);
  }

  async function stopSipCall() {
    if (!sipAgentId) return;
    const agentId = sipAgentId;
    console.log('[sipCall] stopping agentId=%s', agentId);
    try {
      await API.agora.stopConversation(agentId);
    } catch (e) {
      console.error('[sipCall] stop failed:', e);
    }
    // Poll will pick up the STOPPED status and trigger onSipCallEnded
  }

  async function onSipCallEnded() {
    const patient = sipPatient;
    const transcript = sipTranscript.slice();

    // Clean up RTM
    if (sipRtmClient) {
      try { await sipRtmClient.unsubscribe(sipChannel); } catch (_) {}
      try { await sipRtmClient.logout(); } catch (_) {}
      sipRtmClient = null;
    }

    // Reset state
    sipAgentId = null;
    sipChannel = null;
    sipPatient = null;
    sipTranscript = [];
    if (sipPollTimer) { clearInterval(sipPollTimer); sipPollTimer = null; }

    // Update UI
    const btn = document.getElementById('btn-postop-call');
    if (btn) {
      btn.textContent = '✓ Call completed';
      btn.disabled = true;
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '📞 Post-Op Check-In Call';
      }, 3000);
    }

    // Remove live panel
    const livePanel = document.querySelector('.sip-live-panel');
    if (livePanel) {
      livePanel.querySelector('#sip-stop-btn')?.remove();
      livePanel.querySelector('strong').textContent = 'Call ended — saving summary...';
      livePanel.querySelector('span').style.background = '#9ca3af';
      livePanel.querySelector('span').style.animation = 'none';
    }

    // Summarize and save
    if (transcript.length > 0 && patient) {
      const messages = transcript.map(m => ({
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: m.content
      }));
      console.log('[sipCall] summarizing %d messages for %s', messages.length, patient.id);
      try {
        const summary = await API.healthcare.summarize({ transcript: messages, call_type: 'post-op' });
        await API.healthcare.createSummary({ patient_id: patient.id, ...summary, transcript: messages });
        console.log('[sipCall] summary saved');
      } catch (e) {
        console.error('[sipCall] summary failed:', e);
      }
    }

    // Remove live panel and refresh
    if (livePanel) setTimeout(() => livePanel.remove(), 2000);
    if (selectedPatientId) renderDetailPanel(selectedPatientId);
    loadPatientCards();
  }

  function renderProfileTab(patient) {
    const details = patient.extra_details || {};
    const container = document.getElementById('tab-profile');
    let html = '<div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:14px;">';
    if (patient.age) html += `<div class="detail-row"><span class="key">Age</span><span class="val">${patient.age}</span></div>`;
    if (patient.condition) html += `<div class="detail-row"><span class="key">Conditions</span><span class="val">${escapeHtml(patient.condition)}</span></div>`;
    const meds = Array.isArray(patient.medications) ? patient.medications.join(', ') : patient.medications;
    if (meds) html += `<div class="detail-row"><span class="key">Medications</span><span class="val">${escapeHtml(meds)}</span></div>`;
    if (details.blood_type) html += `<div class="detail-row"><span class="key">Blood Type</span><span class="val">${escapeHtml(details.blood_type)}</span></div>`;
    if (details.allergies) html += `<div class="detail-row"><span class="key">Allergies</span><span class="val">${escapeHtml(details.allergies)}</span></div>`;
    if (details.medical_history) html += `<div style="font-size:12px;padding:6px 0;color:#475569;line-height:1.4;border-top:1px solid #f3f4f6;margin-top:4px;">${escapeHtml(details.medical_history)}</div>`;
    if (details.emergency_contact) html += `<div class="detail-row"><span class="key">Emergency Contact</span><span class="val">${escapeHtml(details.emergency_contact)}</span></div>`;
    html += '</div>';
    container.innerHTML = html;
  }

  async function renderCallHistoryTab(patientId) {
    const container = document.getElementById('tab-calls');
    try {
      const summaries = await API.healthcare.listSummaries(patientId);
      if (summaries.length === 0) {
        container.innerHTML = '<p class="empty-state">No call history for this patient.</p>';
        return;
      }
      container.innerHTML = summaries.map(s => {
        const symptoms = Array.isArray(s.symptoms) ? s.symptoms.join(', ') : '';
        const meds = Array.isArray(s.medications_discussed) ? s.medications_discussed.join(', ') : '';
        const timeStr = s.created_at ? new Date(s.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        return `
          <div class="summary-card">
            <div class="summary-card-header">
              <span class="summary-card-patient">${timeStr}</span>
              <div class="summary-card-badges">
                <span class="badge badge-${s.call_type}">${s.call_type}</span>
                <span class="badge badge-${s.urgency}">${s.urgency}</span>
              </div>
            </div>
            ${s.chief_complaint ? `<div class="summary-field"><span class="label">Chief complaint: </span><span class="value">${escapeHtml(s.chief_complaint)}</span></div>` : ''}
            ${symptoms ? `<div class="summary-field"><span class="label">Symptoms: </span><span class="value">${escapeHtml(symptoms)}</span></div>` : ''}
            ${meds ? `<div class="summary-field"><span class="label">Medications: </span><span class="value">${escapeHtml(meds)}</span></div>` : ''}
            ${s.ai_recommendation ? `<div class="summary-recommendation">AI: ${escapeHtml(s.ai_recommendation)}</div>` : ''}
            ${s.suggested_action ? `<div class="summary-action">Suggested action: ${escapeHtml(s.suggested_action)}</div>` : ''}
            ${Array.isArray(s.transcript) && s.transcript.length > 0 ? `
              <button class="btn-transcript-toggle" onclick="this.nextElementSibling.classList.toggle('hidden');this.textContent=this.nextElementSibling.classList.contains('hidden')?'Show Transcript':'Hide Transcript'">Show Transcript</button>
              <div class="transcript-block hidden">${s.transcript.map(m =>
                `<div class="transcript-line"><span class="transcript-role ${m.role}">${m.role === 'assistant' ? 'AI' : 'Patient'}:</span> ${escapeHtml(m.content)}</div>`
              ).join('')}</div>
            ` : ''}
          </div>
        `;
      }).join('');
    } catch (e) {
      container.innerHTML = '<p class="empty-state">Failed to load call history.</p>';
    }
  }

  async function renderAppointmentsTab(patientId) {
    const container = document.getElementById('tab-appointments');
    try {
      const appointments = await API.healthcare.listAppointments({ patient_id: patientId });
      console.log('[appointments] patientId=%s found=%d', patientId, appointments.length, appointments);
      if (appointments.length === 0) {
        container.innerHTML = '<p class="empty-state">No appointments with this patient.</p>';
        return;
      }
      container.innerHTML = appointments.map(a => {
        const dt = new Date(a.date_time).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const statusLabel = a.status === 'requested' ? '⏳ Appointment Request' : a.status === 'confirmed' ? '✓ Confirmed' : '✗ Declined';
        const canActOn = a.status === 'requested' && a.doctor_id === selectedProfile.id;
        const actions = canActOn ? `
          <div class="appt-actions">
            <button class="btn-confirm" onclick="handleAppointment('${a.id}','confirmed')">Confirm</button>
            <button class="btn-decline" onclick="handleAppointment('${a.id}','declined')">Decline</button>
          </div>` : '';
        return `
          <div class="appt-card${a.status === 'requested' ? ' pending' : ''}">
            <div class="appt-status status-${a.status}">${statusLabel}</div>
            <div class="appt-datetime">${dt} — ${a.doctor_name || a.doctor_id}</div>
            ${a.reason ? `<div class="appt-reason">Reason: ${escapeHtml(a.reason)}</div>` : ''}
            ${actions}
          </div>
        `;
      }).join('');
    } catch (e) {
      container.innerHTML = '<p class="empty-state">Failed to load appointments.</p>';
    }
  }

  // Global handler for confirm/decline buttons
  window.handleAppointment = async function (appointmentId, status) {
    try {
      await API.healthcare.updateAppointment(appointmentId, { status });
      if (selectedPatientId) await renderDetailPanel(selectedPatientId);
      await loadPatientCards();
    } catch (e) {
      console.error('Failed to update appointment', e);
    }
  };

  // ===========================
  // SSE — live updates
  // ===========================
  function connectSSE() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource('/events');
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'new_summary' || data.type === 'new_appointment' || data.type === 'appointment_updated') {
          loadPatientCards();
          if (selectedPatientId) renderDetailPanel(selectedPatientId);
        }
      } catch (_) {}
    };
  }

  // ===========================
  // EVENT LISTENERS
  // ===========================
  function setupEventListeners() {
    document.getElementById('call-btn').addEventListener('click', startCall);
    document.getElementById('end-call-btn').addEventListener('click', stopCall);
    document.getElementById('switch-user-btn').addEventListener('click', () => {
      sessionStorage.removeItem('selectedDoctor');
      if (eventSource) eventSource.close();
      location.reload();
    });

    // Fix 1: stop agent on tab close/refresh (best-effort via sendBeacon)
    window.addEventListener('beforeunload', () => {
      if (agoraConvoAIAgentID) {
        const url = `${CONFIG.API_BASE_URL}/api/agora/stop/${agoraConvoAIAgentID}`;
        navigator.sendBeacon(url, '');
      }
    });
  }

  // ===========================
  // AGORA INIT
  // ===========================
  function initAgoraClients() {
    agoraChannel = UTILS.generateChannelName();
    rtcClient = AgoraRTC.createClient({ mode: 'live', codec: 'vp8', role: 'host' });
    rtcClient.on('user-published', handleRTCUserPublished);
    rtcClient.on('user-unpublished', handleRTCUserUnpublished);
    rtcClient.on('user-joined', (user) => console.log('[RTC] user-joined uid=%s', user.uid));
    rtcClient.on('user-left', (user, reason) => {
      console.log('[RTC] user-left uid=%s reason=%s', user.uid, reason);
      // Fix 4: if agent/avatar leaves unexpectedly, auto-reset UI
      const isCallUser = user.uid == agentUID || (avatarUID && user.uid == avatarUID);
      if (isCallUser && !document.getElementById('end-call-btn').classList.contains('hidden')) {
        console.log('[RTC] agent left unexpectedly — auto-resetting UI');
        stopCall();
      }
    });
    rtcClient.on('connection-state-change', (cur, prev, reason) => {
      console.log('[RTC] connection-state-change %s→%s reason=%s', prev, cur, reason);
      // Fix 2: auto-cleanup if connection drops during a call
      if (cur === 'DISCONNECTED' && rtcJoined) {
        console.log('[RTC] connection lost during call — triggering cleanup');
        rtcJoined = false;
        onCallStopped();
        if (agoraConvoAIAgentID) {
          const agentId = agoraConvoAIAgentID;
          agoraConvoAIAgentID = null; agentUID = null;
          API.agora.stopConversation(agentId).catch(e =>
            console.error('[RTC] failed to stop agent after disconnect:', e));
        }
      }
    });
  }

  // ===========================
  // CALL FLOW
  // ===========================
  async function startCall() {
    const btn = document.getElementById('call-btn');
    btn.classList.add('loading');
    btn.setAttribute('disabled', 'true');
    try {
      agoraChannelInfo = await API.agora.getChannelInfo(agoraChannel, agoraUserUID);

      let profileContext = [
        `Doctor name: ${selectedProfile.name}`,
        `Specialty: ${selectedProfile.specialty}`,
        `Hospital: ${selectedProfile.hospital}`
      ].join('\n');

      // Include consolidated profile summaries for recent patients
      try {
        const summaries = await API.healthcare.listSummaries();
        const seen = new Set();
        const patientIds = summaries.filter(s => {
          if (seen.has(s.patient_id)) return false;
          seen.add(s.patient_id);
          return true;
        }).slice(0, 5).map(s => s.patient_id);

        const profiles = [];
        for (const pid of patientIds) {
          try {
            const ps = await API.healthcare.getProfileSummary(pid);
            profiles.push(`${ps.patient_id}: ${ps.summary_text}`);
          } catch (_) {}
        }
        if (profiles.length > 0) {
          profileContext += '\n\nPatient profiles (consolidated from prior calls):\n' + profiles.join('\n\n');
        }
      } catch (_) {}

      rtmClient = new AgoraRTM.RTM(agoraChannelInfo.appId, agoraUserUID.toString());
      rtmClient.addEventListener('message', handleRTMMessage);
      rtmClient.addEventListener('presence', handleRTMPresenceEvent);

      await joinRTCChannel(agoraChannelInfo.appId, agoraChannelInfo.channel, agoraChannelInfo.uid, agoraChannelInfo.token);
      await joinRTMChannel(agoraChannelInfo.channel, agoraChannelInfo.uid, agoraChannelInfo.token);

      const response = await API.agora.startConversation({
        channel: agoraChannelInfo.channel,
        agentName: 'HealthAI_Doctor_' + agoraChannelInfo.channel,
        remoteUid: agoraUserUID,
        promptType: 'doctor',
        profileContext,
        greetingMessage: `Hello ${selectedProfile.name}! I'm your AI clinical assistant. What can I help you with?`
      });

      agoraConvoAIAgentID = response.agentId;
      agentUID = response.agentUid;
      avatarUID = response.avatarUid || null;
      console.log('[startCall] agent started — agentId=%s agentUid=%s avatarUid=%s',
        agoraConvoAIAgentID, agentUID, avatarUID);

      const _pollId = agoraConvoAIAgentID;
      setTimeout(async () => {
        try {
          const st = await API.agora.getAgentStatus(_pollId);
          console.log('[startCall] agent status at 5s:', JSON.stringify(st));
          if (st.status === 'RUNNING' && document.getElementById('end-call-btn').classList.contains('hidden')) {
            console.log('[startCall] agent RUNNING but UI not started — forcing onCallStarted()');
            onCallStarted();
          }
        } catch (e) {
          console.warn('[startCall] status poll failed:', e.message);
        }
      }, 5000);
    } catch (e) {
      console.error('Failed to start call', e);
      btn.classList.remove('loading');
      btn.removeAttribute('disabled');
    }
  }

  async function stopCall() {
    const transcript = (chatManager ? chatManager.getCurrentSessionMessages() : [])
      .slice(-20)
      .map(m => ({ role: m.sender === 'ai' ? 'assistant' : 'user', content: m.content }));
    const profile = selectedProfile;
    const agentId = agoraConvoAIAgentID;

    onCallStopped();

    console.log('[stopCall] starting cleanup...');
    const t0 = Date.now();

    try {
      if (rtcJoined) {
        await rtcLeaveChannel();
        await rtmLeaveChannel();
      }
      if (agentId) {
        agoraConvoAIAgentID = null; agentUID = null;
        await API.agora.stopConversation(agentId);
      }
    } catch (e) {
      console.error(`[stopCall] cleanup error at ${Date.now() - t0}ms:`, e);
    }

    if (transcript.length > 0 && profile) {
      API.healthcare.summarize({ transcript, call_type: 'doctor-query' })
        .then(summary => API.healthcare.createSummary({ patient_id: profile.id, ...summary, transcript }))
        .then(() => console.log('[stopCall] doctor summary saved'))
        .catch(e => console.error('[stopCall] failed to save doctor summary:', e));
    }
  }

  // ===========================
  // AGORA RTC
  // ===========================
  async function joinRTCChannel(appId, channel, uid, token) {
    rtcLocalAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
    await rtcClient.join(appId, channel, token || null, uid);
    await rtcClient.publish([rtcLocalAudioTrack]);
    rtcJoined = true;
    console.log('[RTC] joined channel=%s uid=%s state=%s', channel, uid, rtcClient.connectionState);
  }

  async function rtcLeaveChannel() {
    if (rtcLocalAudioTrack) { rtcLocalAudioTrack.close(); rtcLocalAudioTrack = null; }
    await rtcClient.leave();
    rtcJoined = false;
  }

  function handleRTCUserPublished(user, mediaType) {
    rtcRemoteUsers[user.uid] = user;
    console.log('[RTC] user-published uid=%s mediaType=%s (agentUID=%s avatarUID=%s)',
      user.uid, mediaType, agentUID, avatarUID);
    if (mediaType === 'audio') {
      rtcClient.subscribe(user, mediaType).then(() => {
        user.audioTrack.play();
        const isCallAudio = user.uid == agentUID || (avatarUID && user.uid == avatarUID);
        console.log('[RTC] subscribed audio uid=%s isCallAudio=%s', user.uid, isCallAudio);
        if (isCallAudio) {
          onCallStarted();
          setTimeout(() => {
            if (window.audioVisualizer) window.audioVisualizer.startFrequencyAnalysis(user.audioTrack);
          }, 1000);
        }
      }).catch(err => console.error('[RTC] subscribe error:', err));
    } else if (mediaType === 'video' && avatarUID && user.uid == avatarUID) {
      rtcClient.subscribe(user, mediaType).then(() => {
        const container = document.getElementById('avatar-container');
        if (container) {
          user.videoTrack.play(container);
          container.classList.remove('hidden');
          const vc = document.querySelector('.visualizer-container');
          if (vc) vc.classList.add('hidden');
        }
      });
    }
  }

  function handleRTCUserUnpublished(user) {
    delete rtcRemoteUsers[user.uid];
    const isCallUser = user.uid == agentUID || (avatarUID && user.uid == avatarUID);
    if (isCallUser) {
      if (window.audioVisualizer) window.audioVisualizer.stopFrequencyAnalysis();
      updateAgentStateUI('offline');
    }
    if (avatarUID && user.uid == avatarUID) {
      const container = document.getElementById('avatar-container');
      if (container) container.classList.add('hidden');
      const vc = document.querySelector('.visualizer-container');
      if (vc) vc.classList.remove('hidden');
    }
  }

  // ===========================
  // AGORA RTM
  // ===========================
  async function joinRTMChannel(channel, uid, token) {
    await rtmClient.login({ token: token || null, uid: uid.toString() });
    await rtmClient.subscribe(channel);
  }

  async function rtmLeaveChannel() {
    try { await rtmClient.unsubscribe(agoraChannel); } catch (_) {}
    try { await rtmClient.logout(); } catch (_) {}
  }

  function handleRTMMessage(event) {
    if (event.channelType !== 'MESSAGE' || event.channelName !== agoraChannel) return;
    try {
      const parsed = typeof event.message === 'string' ? JSON.parse(event.message) : null;
      if (parsed) chatManager && chatManager.receiveRtmMessage(parsed);
    } catch (_) {}
  }

  function handleRTMPresenceEvent(event) {
    if (event.eventType === 'REMOTE_STATE_CHANGED' && event.publisher !== agoraUserUID?.toString()) {
      const state = event.stateChanged?.state;
      if (state) updateAgentStateUI(state);
    }
  }

  async function sendTextMessage(text) {
    if (!rtmClient || !agoraChannel || !rtcJoined) return;
    await rtmClient.publish(agoraChannel, text, { customType: 'user.transcription' });
  }
  window.sendTextMessage = sendTextMessage;

  // ===========================
  // UI HELPERS
  // ===========================
  function onCallStarted() {
    document.getElementById('call-btn').classList.remove('loading');
    document.getElementById('call-btn').classList.add('hidden');
    document.getElementById('end-call-btn').classList.remove('hidden');
    document.getElementById('call-overlay').classList.remove('hidden');
    updateAgentStateUI('speaking');
    if (chatManager) { chatManager.enableChat(); chatManager.startNewSession(); chatManager.openChat(); }
  }

  function onCallStopped() {
    document.getElementById('end-call-btn').classList.remove('loading');
    document.getElementById('call-btn').classList.remove('hidden');
    document.getElementById('call-btn').removeAttribute('disabled');
    document.getElementById('end-call-btn').classList.add('hidden');
    document.getElementById('call-overlay').classList.add('hidden');
    updateAgentStateUI('offline');
    const avatarContainer = document.getElementById('avatar-container');
    if (avatarContainer) avatarContainer.classList.add('hidden');
    const vc = document.querySelector('.visualizer-container');
    if (vc) vc.classList.remove('hidden');
    avatarUID = null;
    if (chatManager) { chatManager.disableChat(); chatManager.endSession(); }
  }

  function updateAgentStateUI(state) {
    const el = document.getElementById('agent-state');
    const text = el?.querySelector('.state-text');
    if (!el || !text) return;
    text.textContent = state;
    el.className = 'agent-state state-' + state.toLowerCase();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  init();
})();
