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
  let chatManager = null;
  const profileModal = new ProfileModal();

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
    renderProfileCard(selectedProfile);
    await loadSummaryFeed();
    connectSSE();
    initAgoraClients();
    setupEventListeners();
    chatManager = new ChatManager();
    chatManager.initialize();
  }

  // ===========================
  // PROFILE CARD
  // ===========================
  function renderProfileCard(p) {
    const container = document.getElementById('profile-card-container');
    container.innerHTML = `
      <div class="profile-card">
        <div class="avatar">${p.avatar}</div>
        <div class="profile-info">
          <span class="profile-name" id="open-profile-modal">${p.name}</span>
          <div class="profile-meta">${p.specialty || ''} · ${p.hospital || ''}</div>
        </div>
      </div>
    `;
    document.getElementById('open-profile-modal').addEventListener('click', () => profileModal.open(p));
  }

  // ===========================
  // SUMMARY FEED
  // ===========================
  async function loadSummaryFeed() {
    try {
      const summaries = await API.healthcare.listSummaries();
      const feed = document.getElementById('summary-feed');
      feed.innerHTML = '';
      if (summaries.length === 0) {
        feed.innerHTML = '<p style="color:#9ca3af;font-size:13px">No patient summaries yet. Summaries appear here when patients finish calls.</p>';
      } else {
        summaries.forEach(s => feed.appendChild(buildSummaryCard(s)));
      }
    } catch (e) {
      console.error('Failed to load summaries', e);
    }
  }

  function buildSummaryCard(s) {
    const symptoms = Array.isArray(s.symptoms) ? s.symptoms.join(', ') : '';
    const meds = Array.isArray(s.medications_discussed) ? s.medications_discussed.join(', ') : '';
    const vitals = s.vitals_mentioned && typeof s.vitals_mentioned === 'object'
      ? Object.entries(s.vitals_mentioned).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
    const timeAgo = s.created_at ? new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const hasCarePlan = s.call_type === 'post-op';

    const card = document.createElement('div');
    card.className = 'summary-card';
    card.dataset.summaryId = s.id;
    card.innerHTML = `
      <div class="summary-card-header">
        <span class="summary-card-patient">${s.patient_name || s.patient_id}</span>
        <div class="summary-card-badges">
          <span class="badge badge-${s.call_type}">${s.call_type}</span>
          <span class="badge badge-${s.urgency}">${s.urgency}</span>
          <span style="font-size:11px;color:#9ca3af">${timeAgo}</span>
        </div>
      </div>
      ${s.chief_complaint ? `<div class="summary-field"><span class="label">Chief complaint: </span><span class="value">${escapeHtml(s.chief_complaint)}</span></div>` : ''}
      ${symptoms ? `<div class="summary-field"><span class="label">Symptoms: </span><span class="value">${escapeHtml(symptoms)}</span></div>` : ''}
      ${vitals ? `<div class="summary-field"><span class="label">Vitals mentioned: </span><span class="value">${escapeHtml(vitals)}</span></div>` : ''}
      ${meds ? `<div class="summary-field"><span class="label">Medications discussed: </span><span class="value">${escapeHtml(meds)}</span></div>` : ''}
      ${s.ai_recommendation ? `<div class="summary-recommendation">AI: ${escapeHtml(s.ai_recommendation)}</div>` : ''}
      ${s.suggested_action ? `<div class="summary-action">Suggested action: ${escapeHtml(s.suggested_action)}</div>` : ''}
      ${s.transcript_excerpt ? `<div class="summary-transcript">"${escapeHtml(s.transcript_excerpt)}"</div>` : ''}
      ${hasCarePlan ? `<div id="plan-actions-${s.id}"><button class="btn-approve" data-patient-id="${encodeURIComponent(s.patient_id)}" onclick="approvePlan('${encodeURIComponent(s.patient_id)}')">Approve Care Plan</button></div>` : ''}
    `;
    return card;
  }

  // Exposed globally so inline onclick works
  window.approvePlan = async function (encodedPatientId) {
    const patientId = decodeURIComponent(encodedPatientId);
    try {
      const plan = await API.healthcare.getCarePlan(patientId);
      await API.healthcare.updateCarePlan(plan.id, { status: 'approved' });
      document.querySelectorAll(`.btn-approve[data-patient-id="${encodeURIComponent(patientId)}"]`).forEach(btn => {
        const container = btn.closest('[id^="plan-actions-"]');
        if (container) container.innerHTML = '<span class="approved-tag">✓ Care plan approved</span>';
      });
    } catch (e) {
      console.error('Failed to approve care plan', e);
    }
  };

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===========================
  // SSE — live summary feed
  // ===========================
  function connectSSE() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource('/events');
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'new_summary' && data.summary) {
          const feed = document.getElementById('summary-feed');
          const placeholder = feed.querySelector('p');
          if (placeholder) placeholder.remove();
          feed.prepend(buildSummaryCard(data.summary));
        }
      } catch (_) {}
    };
    eventSource.onerror = () => {
      // SSE auto-reconnects — no action needed
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
  }

  // ===========================
  // AGORA INIT
  // ===========================
  function initAgoraClients() {
    agoraChannel = UTILS.generateChannelName();
    rtcClient = AgoraRTC.createClient({ mode: 'live', codec: 'vp8', role: 'host' });
    rtcClient.on('user-published', handleRTCUserPublished);
    rtcClient.on('user-unpublished', handleRTCUserUnpublished);
  }

  // ===========================
  // CALL FLOW
  // ===========================
  async function startCall() {
    const btn = document.getElementById('call-btn');
    btn.classList.add('loading');
    try {
      agoraChannelInfo = await API.agora.getChannelInfo(agoraChannel, agoraUserUID);

      const profileContext = [
        `Doctor name: ${selectedProfile.name}`,
        `Specialty: ${selectedProfile.specialty}`,
        `Hospital: ${selectedProfile.hospital}`
      ].join('\n');

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
    } catch (e) {
      console.error('Failed to start call', e);
      btn.classList.remove('loading');
    }
  }

  async function stopCall() {
    // Capture session state BEFORE resetting UI (onCallStopped clears session)
    const transcript = (chatManager ? chatManager.getCurrentSessionMessages() : [])
      .slice(-20)
      .map(m => ({ role: m.sender === 'ai' ? 'assistant' : 'user', content: m.content }));
    const profile = selectedProfile;
    const agentId = agoraConvoAIAgentID;

    // Reset UI instantly — don't make user wait for network teardown
    onCallStopped();

    // RTC/RTM/agent cleanup in background with timing logs
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

    // Summarize and save in background
    if (transcript.length > 0 && profile) {
      console.log(`[stopCall] generating doctor summary, ${transcript.length} messages`);
      API.healthcare.summarize({ transcript, call_type: 'doctor-query' })
        .then(summary => API.healthcare.createSummary({ patient_id: profile.id, ...summary }))
        .then(() => console.log('[stopCall] doctor summary saved'))
        .catch(e => console.error('[stopCall] failed to generate or save doctor summary:', e));
    } else {
      console.log('[stopCall] skipping summary — transcript empty or no profile');
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
  }

  async function rtcLeaveChannel() {
    if (rtcLocalAudioTrack) { rtcLocalAudioTrack.close(); rtcLocalAudioTrack = null; }
    await rtcClient.leave();
    rtcJoined = false;
  }

  function handleRTCUserPublished(user, mediaType) {
    rtcRemoteUsers[user.uid] = user;
    if (mediaType === 'audio') {
      rtcClient.subscribe(user, mediaType).then(() => {
        user.audioTrack.play();
        if (user.uid == agentUID) {
          onCallStarted();
          setTimeout(() => {
            if (window.audioVisualizer) window.audioVisualizer.startFrequencyAnalysis(user.audioTrack);
          }, 1000);
        }
      });
    }
  }

  function handleRTCUserUnpublished(user) {
    delete rtcRemoteUsers[user.uid];
    if (user.uid == agentUID) {
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
    updateAgentStateUI('speaking');
    if (chatManager) { chatManager.enableChat(); chatManager.startNewSession(); chatManager.openChat(); }
  }

  function onCallStopped() {
    document.getElementById('end-call-btn').classList.remove('loading');
    document.getElementById('call-btn').classList.remove('hidden');
    document.getElementById('end-call-btn').classList.add('hidden');
    updateAgentStateUI('offline');
    if (chatManager) { chatManager.disableChat(); chatManager.endSession(); }
  }

  function updateAgentStateUI(state) {
    const el = document.getElementById('agent-state');
    const text = el?.querySelector('.state-text');
    if (!el || !text) return;
    text.textContent = state;
    el.className = 'agent-state state-' + state.toLowerCase();
  }

  init();
})();
