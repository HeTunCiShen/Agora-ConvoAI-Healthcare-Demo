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
    renderProfileCard(selectedProfile);
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
          <div class="profile-meta">${p.condition || ''} · ${p.next_appointment || ''}</div>
        </div>
      </div>
    `;
    document.getElementById('open-profile-modal').addEventListener('click', () => profileModal.open(p));
  }

  // ===========================
  // EVENT LISTENERS
  // ===========================
  function setupEventListeners() {
    document.getElementById('call-btn').addEventListener('click', () => startCall('patient'));
    document.getElementById('postop-btn').addEventListener('click', () => startCall('post-op'));
    document.getElementById('end-call-btn').addEventListener('click', stopCall);
    document.getElementById('switch-user-btn').addEventListener('click', () => {
      sessionStorage.removeItem('selectedPatient');
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
    rtmClient = null; // initialised lazily on first call
  }

  // ===========================
  // CALL FLOW
  // ===========================
  async function startCall(callType) {
    currentCallType = callType;
    document.getElementById('call-btn').setAttribute('disabled', 'true');
    document.getElementById('postop-btn').setAttribute('disabled', 'true');
    setCallButtonLoading(callType, true);

    try {
      agoraChannelInfo = await API.agora.getChannelInfo(agoraChannel, agoraUserUID);

      // Build profile context string
      const profileContext = buildProfileContext(selectedProfile, callType);
      let greetingMessage = `Hello ${selectedProfile.name}! I'm your AI medical assistant. How can I help you today?`;

      // For post-op, fetch care plan
      let carePlanText = '';
      if (callType === 'post-op') {
        try {
          const plan = await API.healthcare.getCarePlan(selectedProfile.id);
          carePlanText = plan.plan_text.map(d => `${d.days}: ${d.instructions}`).join(' ');
          greetingMessage = `Hello ${selectedProfile.name}! I'm calling to check on your recovery. How are you feeling today?`;
        } catch (_) { /* no care plan — proceed anyway */ }
      }

      // Init RTM client
      rtmClient = new AgoraRTM.RTM(agoraChannelInfo.appId, agoraUserUID.toString());
      rtmClient.addEventListener('message', handleRTMMessage);
      rtmClient.addEventListener('presence', handleRTMPresenceEvent);

      await joinRTCChannel(agoraChannelInfo.appId, agoraChannelInfo.channel, agoraChannelInfo.uid, agoraChannelInfo.token);
      await joinRTMChannel(agoraChannelInfo.channel, agoraChannelInfo.uid, agoraChannelInfo.token);

      const fullContext = carePlanText
        ? `${profileContext}\nCare plan: ${carePlanText}`
        : profileContext;

      const response = await API.agora.startConversation({
        channel: agoraChannelInfo.channel,
        agentName: 'HealthAI_' + agoraChannelInfo.channel,
        remoteUid: agoraUserUID,
        promptType: callType,
        profileContext: fullContext,
        greetingMessage
      });

      agoraConvoAIAgentID = response.agentId;
      agentUID = response.agentUid;
      avatarUID = response.avatarUid || null;
      console.log('[startCall] agent started — agentId=%s agentUid=%s avatarUid=%s waiting for user-published…',
        agoraConvoAIAgentID, agentUID, avatarUID);
    } catch (e) {
      console.error('Failed to start call', e);
      setCallButtonLoading(callType, false);
      document.getElementById('call-btn').removeAttribute('disabled');
      document.getElementById('postop-btn').removeAttribute('disabled');
    }
  }

  function buildProfileContext(p, callType) {
    const meds = Array.isArray(p.medications) ? p.medications.join(', ') : p.medications || '';
    return [
      `Patient name: ${p.name}`,
      `Age: ${p.age}`,
      `Current conditions: ${p.condition || 'None recorded'}`,
      `Current medications: ${meds || 'None'}`,
      `Next appointment: ${p.next_appointment || 'Not scheduled'}`
    ].join('\n');
  }

  async function stopCall() {
    // Capture session state BEFORE resetting UI (onCallStopped clears currentCallType/session)
    const transcript = (chatManager ? chatManager.getCurrentSessionMessages() : [])
      .slice(-20)
      .map(m => ({ role: m.sender === 'ai' ? 'assistant' : 'user', content: m.content }));
    const callType = currentCallType === 'post-op' ? 'post-op' : 'patient';
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
      console.log(`[stopCall] generating summary for ${callType}, ${transcript.length} messages`);
      API.healthcare.summarize({ transcript, call_type: callType })
        .then(summary => API.healthcare.createSummary({ patient_id: profile.id, ...summary }))
        .then(() => console.log('[stopCall] summary saved'))
        .catch(e => console.error('[stopCall] failed to generate or save summary:', e));
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
    console.log('[RTC] user-published uid=%s mediaType=%s (agentUID=%s avatarUID=%s)',
      user.uid, mediaType, agentUID, avatarUID);
    if (mediaType === 'audio') {
      rtcClient.subscribe(user, mediaType).then(() => {
        user.audioTrack.play();
        // When avatar is enabled, the avatar UID publishes the audio (not the agent UID)
        const isCallAudio = user.uid == agentUID || (avatarUID && user.uid == avatarUID);
        if (isCallAudio) {
          onCallStarted();
          setTimeout(() => {
            if (window.audioVisualizer) window.audioVisualizer.startFrequencyAnalysis(user.audioTrack);
          }, 1000);
        }
      });
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
    document.getElementById('call-btn').classList.add('hidden');
    document.getElementById('postop-btn').classList.add('hidden');
    document.getElementById('end-call-btn').classList.remove('hidden');
    updateAgentStateUI('speaking');
    if (chatManager) { chatManager.enableChat(); chatManager.startNewSession(); }
  }

  function onCallStopped() {
    setEndCallLoading(false);
    document.getElementById('call-btn').classList.remove('hidden');
    document.getElementById('postop-btn').classList.remove('hidden');
    document.getElementById('call-btn').removeAttribute('disabled');
    document.getElementById('postop-btn').removeAttribute('disabled');
    document.getElementById('end-call-btn').classList.add('hidden');
    updateAgentStateUI('offline');
    const avatarContainer = document.getElementById('avatar-container');
    if (avatarContainer) avatarContainer.classList.add('hidden');
    const vc = document.querySelector('.visualizer-container');
    if (vc) vc.classList.remove('hidden');
    avatarUID = null;
    if (chatManager) { chatManager.disableChat(); chatManager.endSession(); }
    currentCallType = null;
  }

  function setCallButtonLoading(callType, loading) {
    const btn = callType === 'post-op'
      ? document.getElementById('postop-btn')
      : document.getElementById('call-btn');
    loading ? btn.classList.add('loading') : btn.classList.remove('loading');
  }

  function setEndCallLoading(loading) {
    const btn = document.getElementById('end-call-btn');
    loading ? btn.classList.add('loading') : btn.classList.remove('loading');
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
