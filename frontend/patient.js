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
    } catch (e) {
      console.error('Failed to start call', e);
      setCallButtonLoading(callType, false);
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
    setEndCallLoading(true);
    try {
      // Extract summary before stopping
      const summary = extractSummary();

      if (rtcJoined) {
        await rtcLeaveChannel();
        await rtmLeaveChannel();
      }
      if (agoraConvoAIAgentID) {
        await API.agora.stopConversation(agoraConvoAIAgentID);
        agoraConvoAIAgentID = null;
        agentUID = null;
      }

      // Save summary to backend (patient calls only)
      if (summary && currentCallType === 'patient' && selectedProfile) {
        try {
          await API.healthcare.createSummary({ patient_id: selectedProfile.id, ...summary });
        } catch (e) {
          console.error('Failed to save summary', e);
        }
      }

      onCallStopped();
    } catch (e) {
      console.error('Failed to stop call', e);
      setEndCallLoading(false);
    }
  }

  function extractSummary() {
    if (!chatManager) return null;
    const messages = chatManager.getCurrentSessionMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.sender === 'ai' && msg.content) {
        const match = msg.content.match(/<summary>([\s\S]*?)<\/summary>/);
        if (match) {
          try { return JSON.parse(match[1].trim()); } catch (_) {}
        }
      }
    }
    return null;
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
  }

  function handleRTMMessage(event) {
    if (event.channelType !== 'MESSAGE' || event.channelName !== agoraChannel) return;
    try {
      const parsed = typeof event.message === 'string' ? JSON.parse(event.message) : null;
      if (!parsed) return;

      // Hide summary XML from chat display but let ChatManager store the message for extraction
      if (parsed.object === 'assistant.transcription' && parsed.text && parsed.text.includes('<summary>')) {
        // Store in chatManager messages but display a cleaner version
        const cleanText = parsed.text.replace(/<summary>[\s\S]*?<\/summary>/, '').trim();
        if (cleanText) chatManager && chatManager.receiveRtmMessage({ ...parsed, text: cleanText });
        // Still pass the full message to chatManager's internal storage so extractSummary() finds it
        if (chatManager) {
          chatManager.currentSessionMessages.push({ id: Date.now(), content: parsed.text, sender: 'ai', timestamp: new Date() });
        }
        return;
      }

      chatManager && chatManager.receiveRtmMessage(parsed);
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
    document.getElementById('end-call-btn').classList.add('hidden');
    updateAgentStateUI('offline');
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
