// Secure app wrapper to prevent console access
(function() {
  
  // ===========================
  // AGORA SDK VARIABLES
  // ===========================
  let rtcClient = null;
  let rtcLocalAudioTrack;
  let rtcJoined = false;
  let rtcRemoteUsers = {};
  let rtmClient = null;
  let agoraConvoAIAgentID = null;
  let agoraChannel = null;
  let agoraUserUID = 123;
  let agoraChannelInfo = null;
  let agentUID = null;
  let agentState = 'idle';
  let chatManager = null;

  // UI Elements
  const joinBtn = document.getElementById('join');
  const leaveBtn = document.getElementById('leave');

  // ===========================
  // AGORA SDK INITIALIZATION
  // ===========================
  
  init() // Initialize the app

  async function init() { 
    try { 
      // Step 1 - Fetch the necessary info AppID, Channel, Tokens, etc from backend 
      agoraChannel = UTILS.generateChannelName();
      
      // Fetch public channel/app info from backend. Keep in-memory only.
      agoraChannelInfo = await API.agora.getChannelInfo(agoraChannel, agoraUserUID);
            
      // Step 2a - Initialize RTC client
      if (rtcClient == null) { 
        rtcClient = AgoraRTC.createClient({ mode: "live", codec: "vp8", role: 'host' });
        rtcClient.on("user-published", handleRTCUserPublished);
        rtcClient.on("user-unpublished", handleRTCUserUnpublished);
      }
      
      // Step 2b - Initialize RTM client
      if (rtmClient == null) { 
        rtmClient = new AgoraRTM.RTM(agoraChannelInfo.appId, agoraUserUID.toString());
        rtmClient.addEventListener('message', handleRTMMessage);
        rtmClient.addEventListener('presence', handleRTMPresenceEvent);
      }
      
      // Step 3 - Init UI Event listeners
      joinBtn.addEventListener('click', handleStartClick);
      leaveBtn.addEventListener('click', handleStopClick);
      
      // Step 4 - Initialize chat manager
      chatManager = new ChatManager();
      if (chatManager.initialize()) {
        console.log('Chat manager initialized successfully');
      }
      
    }catch (e) {  
      console.error('Init failed', e);
    }
  }

  // ===========================
  // AGORA CONVO AI FUNCTIONS
  // ===========================

  async function startAgoraConvoAIAgent() {
    try { 
      if (!agoraChannelInfo) return alert('Channel info not initialized');
      
      // Join Agora RTC and RTM channels
      await joinRTCChannel(agoraChannelInfo.appId, agoraChannelInfo.channel, agoraChannelInfo.uid, agoraChannelInfo.token);
      await joinRTMChannel(agoraChannelInfo.channel, agoraChannelInfo.uid, agoraChannelInfo.token);

      // Start ConvoAI agent via API
      const response = await API.agora.startConversation({
        channel: agoraChannelInfo.channel,
        agentName: "AgoraConvoAI_"+agoraChannelInfo.channel,
        remoteUid: agoraUserUID,
      });

      agoraConvoAIAgentID = response.agentId;
      agentUID = response.agentUid;

      
    }catch (e) {
      console.error('Failed to start ConvoAI agent', e);
      onConversationError();
    }
  }

  async function stopAgoraConvoAIAgent() {
    try { 
      if (!agoraConvoAIAgentID) return;

      // Leave Agora RTC and RTM channels
      if (rtcJoined) {
        await rtcLeaveChannel();
        await rtmLeaveChannel();
      }
      
      // Update the UI immediately for better UX
      onConversationStopped();
      
      // Stop ConvoAI agent via API
      await API.agora.stopConversation(agoraConvoAIAgentID);
      agoraConvoAIAgentID = null;
      agentUID = null;
      agentState = 'idle';
      
    }catch (e) {
      console.error('Failed to stop ConvoAI agent', e);
      onConversationError();
    }
  }

  // ===========================
  // AGORA RTC FUNCTIONS
  // ===========================

  async function joinRTCChannel(appId, channel, uid, token) {
    rtcLocalAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();

    try {
      await rtcClient.join(appId, channel, token || null, uid);
      await rtcClient.publish([rtcLocalAudioTrack]);
      rtcJoined = true;
    } catch (err) {
      console.error(err);
      alert('Failed to join/publish: ' + err.message);
    }
  }

  async function rtcSubscribe(user, mediaType) {
    // subscribe to a remote user
    if (mediaType === 'audio') {
      await rtcClient.subscribe(user, mediaType);
      user.audioTrack.play();
    }
  }

  async function rtcLeaveChannel() { 
    if (rtcLocalAudioTrack) {
      rtcLocalAudioTrack.close();
      rtcLocalAudioTrack = null;
    }
    await rtcClient.leave();
    rtcJoined = false;
  }

  function handleRTCUserPublished(user, mediaType) {
    const id = user.uid;
    rtcRemoteUsers[id] = user;
    rtcSubscribe(user, mediaType);
    
    // Start audio visualization when agent audio is available (demo feature)
    if (mediaType === 'audio' && id == agentUID) {
      // Update button states immediately after successful connection
      onConversationStarted();

      setTimeout(() => {
        if (window.audioVisualizer) {
          window.audioVisualizer.startFrequencyAnalysis(user.audioTrack);
        }
      }, 1000);
    }
  }

  function handleRTCUserUnpublished(user) {
    const id = user.uid;
    delete rtcRemoteUsers[id];
    
    // Stop audio visualization when agent disconnects
    if (id == agentUID) {
    // Update UI after successful disconnection
      if (window.audioVisualizer) {
        window.audioVisualizer.stopFrequencyAnalysis();
      }
      updateAgentStateUI('offline');
    }
  }

  // ===========================
  // AGORA RTM FUNCTIONS
  // ===========================

  async function joinRTMChannel(channel, uid, token) {
    try {
      await rtmClient.login({ token: token || null, uid: uid.toString() });
      await rtmClient.subscribe(channel);
    } catch (err) {
      console.error('RTM join failed', err);
    }
  }

   async function rtmLeaveChannel() { 
    try {
        const unsubResult = await rtmClient.unsubscribe(agoraChannel);
      
        console.log('RTM unsubscribe result:' + unsubResult);
    } catch (status) {
        console.log(status);
    }
  }

  function handleRTMMessage(event) {
    try {
      console.log('RTM message received:', event);
      
      // Handle custom RTM messages and pass to chat manager
      if (event.channelType === 'MESSAGE' && event.channelName === agoraChannel) {
        const message = event.message;
        
        // Try to parse JSON message for transcriptions
        if (typeof message === 'string') {
          try {
            const parsedMessage = JSON.parse(message);
            console.log('Parsed RTM message:', parsedMessage);
            
            // Pass to chat manager if available
            if (chatManager && parsedMessage) {
              chatManager.receiveRtmMessage(parsedMessage);
            }
          } catch (e) {
            console.log('Message is not JSON:', message);
          }
        }
      }
    } catch (error) {
      console.error('Error handling RTM message:', error);
    }
  }

  function handleRTMPresenceEvent(event) {
    try {
      console.log('RTM presence event received:', event);
      
      // Check for remote state change from agent
      if (event.eventType === 'REMOTE_STATE_CHANGED') {
        // Check if this is from a different user (not ourselves)
        if (event.publisher !== agoraUserUID?.toString()) {
          // Get the state from stateChanged object
          const stateChanged = event.stateChanged || {};
          
          if (stateChanged.state) {
            agentState = stateChanged.state;
            console.log('Agent state changed to:', agentState);
            
            // Update UI based on agent state
            updateAgentStateUI(agentState);
          }
        }
      }
    } catch (error) {
      console.error('Error handling RTM presence event:', error);
    }
  }

  // ===========================
  // TEXT MESSAGING FUNCTIONS
  // ===========================

  async function sendTextMessage(text) {
    try {
      if (!rtmClient || !agoraChannel || !rtcJoined) {
        throw new Error('RTM client not initialized or not connected to channel');
      }

      // Publish message with custom type for user transcription
      await rtmClient.publish(
        agoraChannel,
        text,
        {
          customType: "user.transcription"
        }
      );

      console.log('Text message sent via RTM:', text);
      return true;

    } catch (error) {
      console.error('Failed to send text message via RTM:', error);
      throw error;
    }
  }

  // Make sendTextMessage function available to chat manager
  window.sendTextMessage = sendTextMessage;

  // ===========================
  // UI MANAGEMENT (Demo Features)
  // ===========================

  // Button Event Handlers
  async function handleStartClick() {
    setButtonLoading(joinBtn, true);
    await startAgoraConvoAIAgent();
  }
  
  async function handleStopClick() {
    setButtonLoading(leaveBtn, true);
    await stopAgoraConvoAIAgent();
  }

    function onConversationStarted() {
    // Update button states
    setButtonLoading(joinBtn, false);
    joinBtn.disabled = true;
    leaveBtn.disabled = false;
    
    // Set agent state to idle but keep UI visible
    updateAgentStateUI('speaking'); 

    // Enable chat when connected
    if (chatManager) {
      chatManager.enableChat();
      chatManager.startNewSession();
    }
  }

  function onConversationStopped() {
    // Update button states
    setButtonLoading(leaveBtn, false);
    joinBtn.disabled = false;
    leaveBtn.disabled = true;
    
    // Set agent state to offline but keep UI visible
    updateAgentStateUI('offline');

    // Disable chat when disconnected
    if (chatManager) {
      chatManager.disableChat();
      chatManager.endSession();
    }
  }
  
  function onConversationError() {
    // Reset button loading states on error
    setButtonLoading(joinBtn, false);
    setButtonLoading(leaveBtn, false);
  }
  
  function setButtonLoading(button, loading) {
    if (loading) {
      button.classList.add('loading');
    } else {
      button.classList.remove('loading');
    }
  }

  function updateAgentStateUI(state) {
    const agentStateEl = document.getElementById('agent-state');
    const stateTextEl = document.querySelector('.state-text');
    
    if (agentStateEl && stateTextEl) {
      const stateLabels = {
        'thinking': 'thinking',
        'idle': 'idle',
        'speaking': 'speaking',
        'listening': 'listening',
        'silent': 'silent',
        'offline': 'offline',
        'online': 'online'
      };
      
      const displayText = stateLabels[state.toLowerCase()] || state;
      stateTextEl.textContent = displayText;
      
      // Update state class for styling
      agentStateEl.className = 'agent-state';
      agentStateEl.classList.add(`state-${state.toLowerCase()}`);
    }
  }


})(); // Close the IIFE to protect variables from console access