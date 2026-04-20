// frontend/patient.js
(function () {
  // ===========================
  // STATE
  // ===========================
  let selectedProfile = null;
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
  let agentState = 'idle';
  let avatarUID = null;
  let chatManager = null;
  let currentCallType = null; // 'patient' | 'post-op'
  const profileModal = new ProfileModal();

  // Master-detail state
  let allDoctors = [];
  let selectedDoctorId = null;
  let callChromeResizeTimer = null;

  // ===========================
  // INIT
  // ===========================
  async function init() {
    const stored = sessionStorage.getItem('selectedPatient');
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
      const profiles = await API.healthcare.listProfiles('patient');
      const container = document.getElementById('patient-cards');
      container.innerHTML = profiles.map(p => `
        <div class="profile-select-card" data-id="${p.id}">
          <div class="avatar">${p.avatar}</div>
          <div class="card-name">${p.name}</div>
          <div class="card-detail">${p.condition || p.specialty || ''}</div>
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
    sessionStorage.setItem('selectedPatient', JSON.stringify(profile));
    selectedProfile = profile;
    await initMainPage();
  }

  async function initMainPage() {
    document.getElementById('profile-selection').classList.add('hidden');
    document.getElementById('main-page').classList.remove('hidden');
    renderTopBar(selectedProfile);
    await loadDoctorCards();
    initAgoraClients();
    setupEventListeners();
    chatManager = new ChatManager();
    chatManager.initialize();

    // Refresh appointments when user returns to this tab (instead of SSE — avoids HTTP/1.1 connection limit)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && selectedDoctorId) {
        renderDetailPanel(selectedDoctorId);
      }
    });
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
        <div class="profile-meta">${p.condition || ''}</div>
      </div>
    `;
    document.getElementById('open-profile-modal').addEventListener('click', () => profileModal.open(p));
  }

  // ===========================
  // MASTER PANEL — DOCTOR CARDS
  // ===========================
  async function loadDoctorCards() {
    try {
      allDoctors = await API.healthcare.listProfiles('doctor');

      const container = document.getElementById('doctor-list');
      const cardsHtml = allDoctors.map(d => {
        return `
          <div class="master-card${selectedDoctorId === d.id ? ' selected' : ''}" data-id="${d.id}">
            <div class="card-row">
              <div class="card-avatar">${d.avatar}</div>
              <div>
                <div class="card-name">${d.name.replace('Dr. ', '')}</div>
                <div class="card-sub">${d.specialty || ''}</div>
              </div>
            </div>
          </div>
        `;
      }).join('');
      container.innerHTML = `<div class="panel-title">Doctors</div>${cardsHtml}`;

      container.querySelectorAll('.master-card').forEach(card => {
        card.addEventListener('click', () => selectDoctor(card.dataset.id));
      });

      // Auto-select first doctor
      if (allDoctors.length > 0 && !selectedDoctorId) {
        selectDoctor(allDoctors[0].id);
      }
    } catch (e) {
      console.error('Failed to load doctor cards', e);
    }
  }

  async function selectDoctor(doctorId) {
    selectedDoctorId = doctorId;
    // Highlight selected card
    document.querySelectorAll('#doctor-list .master-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.id === doctorId);
    });
    await renderDetailPanel(doctorId);
    // Mobile: show detail, hide list
    if (window.innerWidth <= 768) {
      document.getElementById('doctor-list').classList.add('detail-open');
      document.getElementById('detail-panel').classList.add('mobile-open');
    }
  }

  function mobileBack() {
    document.getElementById('doctor-list').classList.remove('detail-open');
    document.getElementById('detail-panel').classList.remove('mobile-open');
  }

  function isDesktopLayout() {
    return window.innerWidth > 768;
  }

  function resetAvatarMediaSlot() {
    const container = document.getElementById('avatar-container');
    if (!container) return;
    const poster = container.querySelector('.avatar-poster');
    container.querySelectorAll('video').forEach(v => {
      try { v.pause(); } catch (_) {}
      v.remove();
    });
    Array.from(container.children).forEach(child => {
      const keep = child.classList.contains('avatar-poster') || child.id === 'avatar-audio-visual';
      if (!keep) child.remove();
    });
    if (poster) poster.classList.remove('hidden');
  }

  function showAvatarAudioVisualLayer() {
    const el = document.getElementById('avatar-audio-visual');
    if (el) el.classList.remove('hidden');
  }

  function hideAvatarAudioVisualLayer() {
    const el = document.getElementById('avatar-audio-visual');
    if (el) el.classList.add('hidden');
    if (window.audioVisualizer) window.audioVisualizer.stopFrequencyAnalysis();
  }

  function restartCallAudioVisualizerIfNeeded() {
    if (!agoraConvoAIAgentID || !rtcJoined) return;
    const uid = avatarUID || agentUID;
    const u = uid ? rtcRemoteUsers[uid] : null;
    if (!u || !u.audioTrack) return;
    const vid = document.querySelector('#avatar-container video');
    if (vid && vid.readyState >= 2) return;
    showAvatarAudioVisualLayer();
    setTimeout(() => {
      if (!agoraConvoAIAgentID || !rtcJoined || !window.audioVisualizer) return;
      const layer = document.getElementById('avatar-audio-visual');
      if (!layer || layer.classList.contains('hidden')) return;
      window.audioVisualizer.startFrequencyAnalysis(u.audioTrack);
    }, 300);
  }

  function hideAvatarPosterWhenVideoReady(container) {
    const maxAttempts = 80;
    const tick = attempt => {
      const vid = container.querySelector('video');
      if (!vid) {
        if (attempt < maxAttempts) setTimeout(() => tick(attempt + 1), 50);
        return;
      }
      const onVideoPresentable = () => {
        const p = container.querySelector('.avatar-poster');
        if (p) p.classList.add('hidden');
        hideAvatarAudioVisualLayer();
      };
      if (vid.readyState >= 2) onVideoPresentable();
      else {
        vid.addEventListener('playing', onVideoPresentable, { once: true });
        vid.addEventListener('loadeddata', onVideoPresentable, { once: true });
      }
    };
    tick(0);
  }

  function getDesktopCallGlass() {
    return document.querySelector('#detail-panel .call-inline-panel[data-call-chrome="1"] .call-glass-panel');
  }

  function ensureDesktopCallChrome() {
    const panel = document.getElementById('detail-panel');
    if (!panel || !panel.querySelector('.detail-content-area')) return;
    let chrome = panel.querySelector('.call-inline-panel[data-call-chrome="1"]');
    if (!chrome) {
      const tabContent = panel.querySelector('.detail-content-area');
      if (tabContent) tabContent.classList.add('detail-content-left');
      chrome = document.createElement('div');
      chrome.className = 'call-inline-panel';
      chrome.dataset.callChrome = '1';
      chrome.innerHTML = `
        <div class="call-glass-panel call-glass-panel--desktop">
          <div class="call-inline-controls">
            <button type="button" class="btn primary call-ai-main-btn call-ai-main-btn--desktop js-start-call-patient">
              <span class="btn-text"><span class="material-symbols-outlined" style="font-size:20px;vertical-align:middle">phone_in_talk</span> Call AI Assistant</span>
              <span class="btn-loading" style="display:none">Connecting…</span>
            </button>
            <button type="button" class="btn danger call-ai-end-btn js-end-call hidden">
              <span class="btn-text"><span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle">call_end</span> End Call</span>
              <span class="btn-loading" style="display:none">Ending…</span>
            </button>
            <section class="agent-state call-agent-state state-offline">
              <div class="state-indicator">
                <span class="state-dot"></span>
                <span class="state-text">offline</span>
              </div>
            </section>
          </div>
          <div class="call-idle-cover">
            <img src="/shared/cover.png" alt="" width="320" height="569" decoding="async" />
          </div>
          <div id="call-active-region" class="call-active-region hidden">
            <div id="avatar-container" class="avatar-container">
              <img class="avatar-poster" src="/shared/cover.png" alt="" width="320" height="569" decoding="async" />
              <div id="avatar-audio-visual" class="avatar-audio-visual hidden">
                <div class="visualizer-container visualizer-avatar-frame">
                  <div class="wave-bars">
                    <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
                    <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>`;
      panel.appendChild(chrome);
      panel.classList.add('detail-with-call');
    }
    syncCallChromeAfterDetailRender();
  }

  function syncCallChromeAfterDetailRender() {
    const inCall = Boolean(agoraConvoAIAgentID && rtcJoined);
    if (inCall) {
      const region = document.getElementById('call-active-region');
      const cover = document.querySelector('#detail-panel .call-idle-cover');
      if (cover) cover.classList.add('hidden');
      if (region) {
        region.classList.remove('hidden');
        if (!isDesktopLayout()) mountCallActiveToMobileSlot();
      }
      const avatarUser = avatarUID ? rtcRemoteUsers[avatarUID] : null;
      if (avatarUser && avatarUser.videoTrack) {
        const container = document.getElementById('avatar-container');
        if (container) {
          container.classList.remove('hidden');
          if (!container.querySelector('video')) {
            const poster = container.querySelector('.avatar-poster');
            if (poster) poster.classList.remove('hidden');
          }
          avatarUser.videoTrack.play(container);
          hideAvatarPosterWhenVideoReady(container);
        }
      }
    } else {
      resetCallChromeToIdle();
    }
  }

  function mountCallActiveToMobileSlot() {
    const slot = document.getElementById('mobile-call-slot');
    const region = document.getElementById('call-active-region');
    if (!slot || !region) return;
    slot.innerHTML = '<div class="call-mobile-visual call-glass-panel call-glass-panel--mobile"></div>';
    slot.querySelector('.call-mobile-visual').appendChild(region);
    slot.hidden = false;
  }

  function unmountCallActiveFromMobileSlot() {
    const glass = getDesktopCallGlass();
    const region = document.getElementById('call-active-region');
    const slot = document.getElementById('mobile-call-slot');
    if (region && glass && region.parentElement !== glass) {
      glass.appendChild(region);
    }
    if (slot) {
      slot.innerHTML = '';
      slot.hidden = true;
    }
  }

  function resetCallChromeToIdle() {
    unmountCallActiveFromMobileSlot();
    hideAvatarAudioVisualLayer();
    resetAvatarMediaSlot();
    const cover = document.querySelector('#detail-panel .call-idle-cover');
    if (cover) cover.classList.remove('hidden');
    const region = document.getElementById('call-active-region');
    if (region) region.classList.add('hidden');
  }

  // ===========================
  // DETAIL PANEL
  // ===========================
  async function renderDetailPanel(doctorId) {
    const doctor = allDoctors.find(d => d.id === doctorId);
    if (!doctor) return;

    const panel = document.getElementById('detail-panel');
    panel.innerHTML = `
      <button class="mobile-back-btn" onclick="document.getElementById('doctor-list').classList.remove('detail-open');document.getElementById('detail-panel').classList.remove('mobile-open');">
        <span class="material-symbols-outlined" style="font-size:18px">arrow_back</span> Back
      </button>
      <div class="detail-header">
        <div>
          <div class="detail-name">${doctor.name}</div>
          <div class="detail-meta">${doctor.specialty || ''} · ${doctor.hospital || ''}</div>
        </div>
      </div>
      <div class="detail-content-area">
        <div class="tab-bar">
          <button class="tab active" data-tab="profile">Profile</button>
          <button class="tab" data-tab="calls">Call History</button>
          <button class="tab" data-tab="appointments">Appointments</button>
        </div>
        <div id="tab-profile" class="tab-content active"></div>
        <div id="tab-calls" class="tab-content"></div>
        <div id="tab-appointments" class="tab-content"></div>
      </div>
    `;

    // Tab switching
    panel.querySelectorAll('.tab-bar .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.remove('active'));
        panel.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
      });
    });

    // Render all tabs
    renderProfileTab(doctor);
    await renderCallHistoryTab(doctorId);
    await renderAppointmentsTab(doctorId);

    ensureDesktopCallChrome();
  }

  function renderProfileTab(doctor) {
    const details = doctor.extra_details || {};
    const container = document.getElementById('tab-profile');
    let html = '<div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:14px;">';
    if (details.experience) html += `<div class="detail-row"><span class="key">Experience</span><span class="val">${escapeHtml(details.experience)}</span></div>`;
    if (details.qualifications) html += `<div class="detail-row"><span class="key">Qualifications</span><span class="val">${escapeHtml(details.qualifications)}</span></div>`;
    if (details.languages) html += `<div class="detail-row"><span class="key">Languages</span><span class="val">${escapeHtml(details.languages.join(', '))}</span></div>`;
    if (doctor.hospital) html += `<div class="detail-row"><span class="key">Hospital</span><span class="val">${escapeHtml(doctor.hospital)}</span></div>`;
    if (details.bio) html += `<div style="font-size:12px;padding:6px 0;color:#475569;line-height:1.4;">${escapeHtml(details.bio)}</div>`;
    html += '</div>';
    container.innerHTML = html;
  }

  async function renderCallHistoryTab(doctorId) {
    const container = document.getElementById('tab-calls');
    const doctor = allDoctors.find(d => d.id === doctorId);
    try {
      const summaries = await API.healthcare.listSummaries({
        patient_id: selectedProfile.id,
        doctor_id: doctorId
      });
      if (summaries.length === 0) {
        container.innerHTML = `<p class="empty-state">No calls scoped to ${doctor ? doctor.name : 'this doctor'} yet.</p>`;
        return;
      }
      container.innerHTML = summaries.map(s => {
        const symptoms = Array.isArray(s.symptoms) ? s.symptoms.join(', ') : '';
        const meds = Array.isArray(s.medications_discussed) ? s.medications_discussed.join(', ') : '';
        const timeStr = s.created_at ? new Date(s.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const kind = s.consultation_kind || '';
        const kindSlug = kind ? kind.replace(/_/g, '-') : 'other';
        const kindLabel = UTILS.consultationKindLabel(kind, s.call_type);
        const withDoctor = s.doctor_name ? `With ${escapeHtml(s.doctor_name)}` : 'Care team (not specified)';
        return `
          <div class="summary-card">
            <div class="summary-card-header">
              <span class="summary-card-patient">${timeStr}</span>
              <div class="summary-card-badges">
                <span class="badge badge-consult-${kindSlug}" title="Consultation type">${escapeHtml(kindLabel)}</span>
                <span class="badge badge-${s.call_type}">${s.call_type}</span>
                <span class="badge badge-${s.urgency}">${s.urgency}</span>
              </div>
            </div>
            <div class="summary-field summary-with-doctor"><span class="label">Doctor: </span><span class="value">${withDoctor}</span></div>
            ${s.chief_complaint ? `<div class="summary-field"><span class="label">Reason: </span><span class="value">${escapeHtml(s.chief_complaint)}</span></div>` : ''}
            ${symptoms ? `<div class="summary-field"><span class="label">Symptoms: </span><span class="value">${escapeHtml(symptoms)}</span></div>` : ''}
            ${meds ? `<div class="summary-field"><span class="label">Medications: </span><span class="value">${escapeHtml(meds)}</span></div>` : ''}
            ${s.ai_recommendation ? `<div class="summary-recommendation">AI recommendation: ${escapeHtml(s.ai_recommendation)}</div>` : ''}
            ${s.suggested_action ? `<div class="summary-action">Next steps: ${escapeHtml(s.suggested_action)}</div>` : ''}
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

  async function renderAppointmentsTab(doctorId) {
    const container = document.getElementById('tab-appointments');
    try {
      const all = await API.healthcare.listAppointments({ patient_id: selectedProfile.id });
      console.log('[appointments] patient=%s doctor=%s total=%d filtered=%d', selectedProfile.id, doctorId, all.length, all.filter(a => a.doctor_id === doctorId).length, all);
      const appointments = all.filter(a => a.doctor_id === doctorId);
      const requestBtn = `
        <div class="appointments-tab-actions">
          <button type="button" class="btn-request-appt" id="btn-request-appt-tab">+ Request Appointment</button>
        </div>`;
      if (appointments.length === 0) {
        container.innerHTML = requestBtn + '<p class="empty-state">No appointments with this doctor yet.</p>';
        document.getElementById('btn-request-appt-tab').addEventListener('click', () => showAppointmentForm(doctorId));
        return;
      }
      container.innerHTML = requestBtn + appointments.map(a => {
        const dt = new Date(a.date_time).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const statusLabel = a.status === 'requested' ? '⏳ Requested' : a.status === 'confirmed' ? '✓ Confirmed' : '✗ Declined';
        const withLine = a.doctor_name
          ? `<div class="appt-with-doctor"><span class="label">With: </span>${escapeHtml(a.doctor_name)}</div>`
          : '';
        return `
          <div class="appt-card${a.status === 'requested' ? ' pending' : ''}">
            <div class="appt-status status-${a.status}">${statusLabel}</div>
            <div class="appt-datetime">${dt}</div>
            ${withLine}
            ${a.reason ? `<div class="appt-reason">Reason: ${escapeHtml(a.reason)}</div>` : ''}
          </div>
        `;
      }).join('');
      document.getElementById('btn-request-appt-tab').addEventListener('click', () => showAppointmentForm(doctorId));
    } catch (e) {
      container.innerHTML = '<p class="empty-state">Failed to load appointments.</p>';
    }
  }

  // ===========================
  // APPOINTMENT FORM
  // ===========================
  function showAppointmentForm(doctorId) {
    const doctor = allDoctors.find(d => d.id === doctorId);
    const container = document.getElementById('tab-appointments');
    // Switch to appointments tab
    document.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-bar .tab[data-tab="appointments"]').classList.add('active');
    container.classList.add('active');

    const existingForm = container.querySelector('.appt-form');
    if (existingForm) return; // already open

    const form = document.createElement('div');
    form.className = 'appt-form';
    form.innerHTML = `
      <label>Preferred date & time</label>
      <input type="datetime-local" id="appt-datetime" />
      <label>Reason</label>
      <textarea id="appt-reason" rows="2" placeholder="e.g. Follow-up on medication"></textarea>
      <div class="form-actions">
        <button class="btn-request-appt" id="appt-submit">Request Appointment</button>
        <button class="btn" id="appt-cancel" style="padding:5px 12px;font-size:11px;">Cancel</button>
      </div>
    `;
    container.prepend(form);

    form.querySelector('#appt-submit').addEventListener('click', async () => {
      const dateTime = form.querySelector('#appt-datetime').value;
      const reason = form.querySelector('#appt-reason').value;
      if (!dateTime) return;
      try {
        await API.healthcare.createAppointment({
          patient_id: selectedProfile.id,
          doctor_id: doctorId,
          date_time: new Date(dateTime).toISOString(),
          reason
        });
        await renderAppointmentsTab(doctorId);
        await loadDoctorCards();
      } catch (e) {
        console.error('Failed to create appointment', e);
      }
    });
    form.querySelector('#appt-cancel').addEventListener('click', () => {
      form.remove();
    });
  }

  // ===========================
  // EVENT LISTENERS
  // ===========================
  function setupEventListeners() {
    const main = document.getElementById('main-page');
    if (main && !main.dataset.callDelegation) {
      main.dataset.callDelegation = '1';
      main.addEventListener('click', (e) => {
        if (e.target.closest('.js-start-call-patient')) {
          e.preventDefault();
          startCall('patient');
        }
        if (e.target.closest('.js-end-call')) {
          e.preventDefault();
          stopCall();
        }
      });
    }
    document.getElementById('switch-user-btn').addEventListener('click', () => {
      sessionStorage.removeItem('selectedPatient');
      location.reload();
    });

    // Fix 1: stop agent on tab close/refresh (best-effort via sendBeacon)
    window.addEventListener('beforeunload', () => {
      if (agoraConvoAIAgentID) {
        const url = `${CONFIG.API_BASE_URL}/api/agora/stop/${agoraConvoAIAgentID}`;
        const headers = {};
        const authUsername = CONFIG.AUTH_USERNAME || '';
        const authPassword = CONFIG.AUTH_PASSWORD || '';
        if (authUsername && authPassword) {
          headers['Authorization'] = `Basic ${btoa(`${authUsername}:${authPassword}`)}`;
        }
        navigator.sendBeacon(url, '');
      }
    });

    window.addEventListener('resize', () => {
      clearTimeout(callChromeResizeTimer);
      callChromeResizeTimer = setTimeout(() => {
        if (!agoraConvoAIAgentID || !rtcJoined) return;
        if (isDesktopLayout()) unmountCallActiveFromMobileSlot();
        else mountCallActiveToMobileSlot();
        syncCallChromeAfterDetailRender();
      }, 120);
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
      if (isCallUser && Array.from(document.querySelectorAll('.call-ai-end-btn')).some(b => !b.classList.contains('hidden'))) {
        console.log('[RTC] agent left unexpectedly — auto-resetting UI');
        stopCall();
      }
    });
    rtcClient.on('connection-state-change', (cur, prev, reason) => {
      console.log('[RTC] connection-state-change %s→%s reason=%s', prev, cur, reason);
      // Fix 2: auto-cleanup if connection drops during a call
      if (cur === 'DISCONNECTED' && rtcJoined) {
        console.log('[RTC] connection lost during call — triggering cleanup');
        rtcJoined = false; // prevent stopCall from trying to leave again
        onCallStopped();
        if (agoraConvoAIAgentID) {
          const agentId = agoraConvoAIAgentID;
          agoraConvoAIAgentID = null; agentUID = null;
          API.agora.stopConversation(agentId).catch(e =>
            console.error('[RTC] failed to stop agent after disconnect:', e));
        }
      }
    });
    rtmClient = null;
  }

  // ===========================
  // CALL FLOW
  // ===========================
  async function startCall(callType) {
    currentCallType = callType;
    document.querySelectorAll('.call-ai-main-btn').forEach(b => b.setAttribute('disabled', 'true'));
    setCallButtonLoading(callType, true);

    try {
      agoraChannelInfo = await API.agora.getChannelInfo(agoraChannel, agoraUserUID);

      // Build profile context — use consolidated profile summary if available, else static profile
      let profileContext = await buildProfileContext(selectedProfile, callType);
      try {
        const ps = await API.healthcare.getProfileSummary(selectedProfile.id);
        profileContext += '\n\nConsolidated history from prior calls:\n' + ps.summary_text;
      } catch (_) { /* no profile summary yet — first call */ }

      // Inject current date/time so AI understands "tomorrow", "next Tuesday", etc.
      const now = new Date();
      profileContext += `\n\nCurrent date and time: ${now.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })} (Australian time)`;

      // Inject available doctors for appointment booking
      if (allDoctors.length > 0) {
        profileContext += '\n\nAvailable doctors for appointment booking:\n' + allDoctors.map(d =>
          `- ${d.name} (${d.specialty || 'General'}, ${d.hospital || 'N/A'})`
        ).join('\n');
        profileContext += '\nWhen the patient wants to book an appointment, help them choose a doctor, preferred date/time, and reason. Confirm the details verbally. Let them know the appointment request will be sent to the doctor after this call ends. Do not output any tags or special formatting — just speak naturally.';
      }

      let greetingMessage = `Hello ${selectedProfile.name}! I'm your AI health assistant. How can I help you today?`;

      rtmClient = new AgoraRTM.RTM(agoraChannelInfo.appId, agoraUserUID.toString());
      rtmClient.addEventListener('message', handleRTMMessage);
      rtmClient.addEventListener('presence', handleRTMPresenceEvent);

      await joinRTCChannel(agoraChannelInfo.appId, agoraChannelInfo.channel, agoraChannelInfo.uid, agoraChannelInfo.token);
      await joinRTMChannel(agoraChannelInfo.channel, agoraChannelInfo.uid, agoraChannelInfo.token);

      const response = await API.agora.startConversation({
        channel: agoraChannelInfo.channel,
        agentName: 'HealthAI_' + agoraChannelInfo.channel,
        remoteUid: agoraUserUID,
        promptType: 'patient',
        profileContext,
        greetingMessage
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
          const endBtns = Array.from(document.querySelectorAll('.call-ai-end-btn'));
          if (st.status === 'RUNNING' && endBtns.length && endBtns.every(b => b.classList.contains('hidden'))) {
            console.log('[startCall] agent RUNNING but UI not started — forcing onCallStarted()');
            onCallStarted();
          }
        } catch (e) {
          console.warn('[startCall] status poll failed:', e.message);
        }
      }, 5000);
    } catch (e) {
      console.error('Failed to start call', e);
      setCallButtonLoading(callType, false);
      document.querySelectorAll('.call-ai-main-btn').forEach(b => b.removeAttribute('disabled'));
    }
  }

  async function buildProfileContext(p, callType) {
    const meds = Array.isArray(p.medications) ? p.medications.join(', ') : p.medications || '';
    const lines = [
      `Patient name: ${p.name}`,
      `Age: ${p.age}`,
      `Current conditions: ${p.condition || 'None recorded'}`,
      `Current medications: ${meds || 'None'}`
    ];
    // Pull all appointments (upcoming and pending)
    try {
      const appts = await API.healthcare.listAppointments({ patient_id: p.id });
      const relevant = appts.filter(a => a.status !== 'declined');
      if (relevant.length > 0) {
        lines.push('Appointments: ' + relevant.map(a =>
          `${new Date(a.date_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} with ${a.doctor_name || a.doctor_id} (${a.status})`
        ).join('; '));
      } else {
        lines.push('Appointments: None scheduled');
      }
    } catch (_) {
      lines.push('Appointments: None scheduled');
    }
    return lines.join('\n');
  }

  async function stopCall() {
    const transcript = (chatManager ? chatManager.getCurrentSessionMessages() : [])
      .slice(-20)
      .map(m => ({ role: m.sender === 'ai' ? 'assistant' : 'user', content: m.content }));
    const callType = currentCallType === 'post-op' ? 'post-op' : 'patient';
    const profile = selectedProfile;
    const agentId = agoraConvoAIAgentID;

    onCallStopped();

    console.log('[stopCall] starting cleanup...');
    const t0 = Date.now();

    try {
      if (rtcJoined) {
        await rtcLeaveChannel();
        console.log(`[stopCall] rtcLeaveChannel done (${Date.now() - t0}ms)`);
        await rtmLeaveChannel();
        console.log(`[stopCall] rtmLeaveChannel done (${Date.now() - t0}ms)`);
      }
      if (agentId) {
        agoraConvoAIAgentID = null; agentUID = null;
        await API.agora.stopConversation(agentId);
        console.log(`[stopCall] stopConversation done (${Date.now() - t0}ms)`);
      }
    } catch (e) {
      console.error(`[stopCall] cleanup error at ${Date.now() - t0}ms:`, e);
    }

    if (transcript.length > 0 && profile) {
      console.log(`[stopCall] generating summary for ${callType}, ${transcript.length} messages`);
      const care_team = allDoctors.map(d => ({
        id: d.id,
        name: d.name,
        specialty: d.specialty || ''
      }));
      let existing_appointments = [];
      try {
        const appts = await API.healthcare.listAppointments({ patient_id: profile.id });
        existing_appointments = appts
          .filter(a => a.status !== 'declined')
          .map(a => ({
            doctor_id: a.doctor_id,
            date_time: a.date_time,
            status: a.status,
            reason: a.reason || ''
          }));
      } catch (e) {
        console.warn('[stopCall] could not load appointments for summarize context:', e.message);
      }
      API.healthcare.summarize({
        transcript,
        call_type: callType,
        care_team,
        default_doctor_id: 'doctor-3',
        existing_appointments
      })
        .then(async (summary) => {
          await API.healthcare.createSummary({ patient_id: profile.id, ...summary, transcript });
          console.log('[stopCall] summary saved');

          // If the AI identified appointment requests, create them
          let createdForDoctorId = null;
          const apptRequests = summary.appointment_requests || (summary.appointment_request ? [summary.appointment_request] : []);
          for (const appt of apptRequests) {
            if (!appt || !appt.doctor_name) continue;
            if (!appt.date_time || typeof appt.date_time !== 'string') {
              console.warn('[stopCall] skip appointment_requests entry without date_time (avoid bogus bookings)');
              continue;
            }
            const doctor = allDoctors.find(d =>
              d.name.toLowerCase().includes(appt.doctor_name.toLowerCase()) ||
              appt.doctor_name.toLowerCase().includes(d.name.replace('Dr. ', '').toLowerCase())
            );
            if (doctor) {
              try {
                const wantTs = Date.parse(appt.date_time);
                const dup = existing_appointments.some(ex => {
                  if (ex.doctor_id !== doctor.id || ex.status === 'declined') return false;
                  const exTs = Date.parse(ex.date_time);
                  return !Number.isNaN(wantTs) && !Number.isNaN(exTs) && Math.abs(wantTs - exTs) < 2 * 60 * 60 * 1000;
                });
                if (dup) {
                  console.warn('[stopCall] skip duplicate appointment vs existing calendar:', appt);
                  continue;
                }
                await API.healthcare.createAppointment({
                  patient_id: profile.id,
                  doctor_id: doctor.id,
                  date_time: appt.date_time,
                  reason: appt.reason || summary.chief_complaint || ''
                });
                if (!createdForDoctorId) createdForDoctorId = doctor.id;
                console.log('[stopCall] appointment created for', doctor.name);
              } catch (e) {
                console.error('[stopCall] failed to create appointment:', e);
              }
            } else {
              console.warn('[stopCall] appointment requested but doctor not found:', appt.doctor_name);
            }
          }

          // Refresh UI — navigate to the doctor's Appointments tab if one was created
          loadDoctorCards();
          if (createdForDoctorId) {
            await selectDoctor(createdForDoctorId);
            // Switch to Appointments tab
            const panel = document.getElementById('detail-panel');
            panel.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.remove('active'));
            panel.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            const apptTab = panel.querySelector('.tab-bar .tab[data-tab="appointments"]');
            if (apptTab) apptTab.classList.add('active');
            const apptContent = document.getElementById('tab-appointments');
            if (apptContent) apptContent.classList.add('active');
          } else if (selectedDoctorId) {
            renderDetailPanel(selectedDoctorId);
          }
        })
        .catch(e => console.error('[stopCall] failed to generate or save summary:', e));
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
            if (!agoraConvoAIAgentID || !rtcJoined || !window.audioVisualizer) return;
            const layer = document.getElementById('avatar-audio-visual');
            if (!layer || layer.classList.contains('hidden')) return;
            window.audioVisualizer.startFrequencyAnalysis(user.audioTrack);
          }, 400);
        }
      }).catch(err => console.error('[RTC] subscribe error:', err));
    } else if (mediaType === 'video' && avatarUID && user.uid == avatarUID) {
      rtcClient.subscribe(user, mediaType).then(() => {
        const container = document.getElementById('avatar-container');
        if (container) {
          container.classList.remove('hidden');
          user.videoTrack.play(container);
          hideAvatarPosterWhenVideoReady(container);
        }
      });
    }
  }

  function handleRTCUserUnpublished(user, mediaType) {
    if (mediaType === 'video' && avatarUID && user.uid == avatarUID) {
      try {
        if (user.videoTrack) user.videoTrack.stop();
      } catch (_) {}
      resetAvatarMediaSlot();
      if (agoraConvoAIAgentID && rtcJoined) restartCallAudioVisualizerIfNeeded();
      return;
    }
    delete rtcRemoteUsers[user.uid];
    const isCallUser = user.uid == agentUID || (avatarUID && user.uid == avatarUID);
    if (isCallUser && mediaType === 'audio') {
      if (window.audioVisualizer) window.audioVisualizer.stopFrequencyAnalysis();
      updateAgentStateUI('offline');
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
      if (state) { agentState = state; updateAgentStateUI(state); }
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
    setCallButtonLoading(currentCallType, false);
    document.querySelectorAll('.call-ai-main-btn').forEach(b => {
      b.removeAttribute('disabled');
      b.classList.add('hidden');
    });
    document.querySelectorAll('.call-ai-end-btn').forEach(b => b.classList.remove('hidden'));
    updateAgentStateUI('speaking');
    ensureDesktopCallChrome();
    const cover = document.querySelector('#detail-panel .call-idle-cover');
    if (cover) cover.classList.add('hidden');
    const region = document.getElementById('call-active-region');
    if (region) {
      region.classList.remove('hidden');
      if (!isDesktopLayout()) mountCallActiveToMobileSlot();
    }
    const ac = document.getElementById('avatar-container');
    if (ac) {
      ac.classList.remove('hidden');
      const poster = ac.querySelector('.avatar-poster');
      const vid = ac.querySelector('video');
      if (poster) {
        if (vid && vid.readyState >= 2) {
          poster.classList.add('hidden');
          hideAvatarAudioVisualLayer();
        } else if (vid) {
          hideAvatarPosterWhenVideoReady(ac);
        } else {
          poster.classList.remove('hidden');
          showAvatarAudioVisualLayer();
        }
      }
    }
    if (chatManager) { chatManager.enableChat(); chatManager.startNewSession(); }
  }

  function onCallStopped() {
    setEndCallLoading(false);
    document.querySelectorAll('.call-ai-main-btn').forEach(b => {
      b.classList.remove('hidden');
      b.removeAttribute('disabled');
    });
    document.querySelectorAll('.call-ai-end-btn').forEach(b => b.classList.add('hidden'));
    updateAgentStateUI('offline');
    resetCallChromeToIdle();

    avatarUID = null;
    if (chatManager) { chatManager.disableChat(); chatManager.endSession(); }
    currentCallType = null;
  }

  function setCallButtonLoading(callType, loading) {
    document.querySelectorAll('.call-ai-main-btn').forEach(btn => {
      loading ? btn.classList.add('loading') : btn.classList.remove('loading');
    });
  }

  function setEndCallLoading(loading) {
    document.querySelectorAll('.call-ai-end-btn').forEach(btn => {
      loading ? btn.classList.add('loading') : btn.classList.remove('loading');
    });
  }

  function updateAgentStateUI(state) {
    document.querySelectorAll('.call-agent-state').forEach(el => {
      const text = el.querySelector('.state-text');
      if (text) text.textContent = state;
      el.className = 'agent-state call-agent-state state-' + state.toLowerCase();
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  init();
})();
