const axios = require('axios');
const { AccessToken2, ServiceRtc, ServiceRtm } = require('agora-token/src/AccessToken2');

// Note: User returning status is now determined by presence of chat history

const getChannelInfo = (req, res) => {
  const { channel, uid } = req.query;

  if (!channel || !uid) {
    return res.status(400).json({ error: 'Channel and uid are required' });
  }

  try {
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    // If the server has the app certificate, generate an ephemeral token and return it.
    if (appCertificate) {
      try {
        const result = buildUnifiedToken(appId, appCertificate, channel, uid);
        return res.json({
          appId,
          channel,
          uid: parseInt(uid),
          token: result.token,
          expiresIn: result.expiresIn
        });
      } catch (err) {
        console.error('Failed to build token inside getChannelInfo:', err);
        // fallthrough to return public info without token
      }
    }

    // Return public channel/app information when token cannot be generated
    res.json({
      appId,
      channel,
      uid: parseInt(uid),
      token: null,
      expiresIn: 0
    });
  } catch (error) {
    console.error('Channel info error:', error);
    res.status(500).json({ error: 'Failed to get channel info' });
  }
};

const startConversation = async (req, res) => {
  try {
    const { channel, agentName, remoteUid: userUid, voiceId, promptType, profileContext, greetingMessage } = req.body;
    
    if (!channel || !agentName || !userUid) {
      return res.status(400).json({ 
        error: 'Channel, agentName, and remoteUid are required' 
      });
    }

    const agentUid = Math.floor(Math.random() * 100000) + 1000;
    // Avatar gets its own UID in a separate range to avoid collisions
    const avatarUid = Math.floor(Math.random() * 100000) + 800000;

    // Check if credentials are configured
    if (!process.env.AGORA_API_KEY || !process.env.AGORA_API_SECRET || !process.env.AGORA_APP_ID) {
      console.log('Agora credentials not configured, returning demo response');
      return res.json({
        success: true,
        agentId: `DEMO_AGENT_${Date.now()}`,
        agentUid: agentUid,
        avatarUid: 0,
        channel: channel,
        demo: true,
        message: 'Demo mode - configure API credentials for full functionality'
      });
    }

    // Use provided system prompt or fall back to env variable or default
    const defaultSystemPrompt = buildSystemPrompt(promptType || 'patient', profileContext || '');
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;
    const agentToken = appCertificate ? buildUnifiedToken(appId, appCertificate, channel, agentUid).token : "";
    const avatarToken = appCertificate ? buildUnifiedToken(appId, appCertificate, channel, avatarUid).token : "";

    const requestBody = {
      name: agentName,
      properties: {
        channel: channel,
        token: agentToken,
        agent_rtc_uid: agentUid.toString(),
        remote_rtc_uids: [userUid.toString()],
        enable_string_uid: false,
        idle_timeout: 30,
        asr: {
          vendor: "ares",
          language: "en-US"
        },
        llm: {
          url: process.env.LLM_URL,
          api_key: process.env.LLM_API_KEY,
          system_messages: [
            {
              role: "system",
              content: defaultSystemPrompt
            }
          ],
          greeting_message: greetingMessage || "Hello! I'm your AI health assistant. How can I help you today?",
          failure_message: "Sorry, I'm having some trouble right now. Let me try again!",
          params: {
            model: process.env.LLM_MODEL || "gpt-4o-mini"
          },
          input_modalities: ["text"],
          output_modalities: ["text"]
        },
        tts: {
          vendor: "elevenlabs",
          params: {
            key: process.env.TTS_ELEVENLABS_API_KEY,
            model_id: process.env.TTS_ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5",
            voice_id: voiceId || process.env.TTS_ELEVENLABS_VOICE_ID
          }
        },
        ...(process.env.AKOOL_API_KEY && process.env.AKOOL_AVATAR_ID ? {
          avatar: {
            vendor: "akool",
            enable: true,
            params: {
              api_key: process.env.AKOOL_API_KEY,
              agora_uid: avatarUid.toString(),
              agora_token: avatarToken,
              avatar_id: process.env.AKOOL_AVATAR_ID
            }
          }
        } : {}),
        turn_detection: {
          mode: "default",
          config: {
            speech_threshold: 0.5,
            start_of_speech: {
              mode: "vad",
              vad_config: {
                interrupt_duration_ms: 160,
                speaking_interrupt_duration_ms: 320,
                prefix_padding_ms: 800
              }
            },
            end_of_speech: {
              mode: "semantic",
              semantic_config: {
                silence_duration_ms: 320,
                max_wait_ms: 1200
              }
            }
          }
        },
        advanced_features: {
          enable_bhvs: true,
          enable_rtm: true
        },
        parameters: {
          data_channel: "rtm",
          audio_scenario: "chorus",
          transcript: {
            redundant: false
          },
          silence_config: { 
            timeout_ms: 30000, // 30 seconds of silence detection
            action: "think", // Agent will think/respond after silence
            content: "User hasn't spoken for a while. Engage the user with a question or prompt."
          }
        }
      }
    };

    const auth = Buffer.from(`${process.env.AGORA_API_KEY}:${process.env.AGORA_API_SECRET}`).toString('base64');

    console.log('[startConversation] sending join request — agentUid=%d avatarUid=%d avatar=%s',
      agentUid, avatarUid, process.env.AKOOL_API_KEY ? 'akool' : 'none');

    const response = await axios.post(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${process.env.AGORA_APP_ID}/join`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        },
        timeout: 15000
      }
    );

    console.log('[startConversation] join response status=%d body=%j', response.status, response.data);

    res.json({
      success: true,
      agentId: response.data.agent_id,
      agentUid: agentUid,
      avatarUid: avatarUid,
      channel: channel
    });

  } catch (error) {
    const detail = error.response?.data || error.message;
    console.error('[startConversation] Agora API error status=%s body=%j', error.response?.status, detail);
    res.status(500).json({
      error: 'Failed to start conversation',
      details: detail
    });
  }
};

const startSIPCall = async (req, res) => {
  try {
    const { channel, agentName, toNumber, promptType, profileContext, greetingMessage } = req.body;

    if (!channel || !agentName || !toNumber) {
      return res.status(400).json({ error: 'channel, agentName, and toNumber are required' });
    }

    if (!process.env.AGORA_API_KEY || !process.env.AGORA_API_SECRET || !process.env.AGORA_APP_ID) {
      return res.json({
        success: true,
        agentId: `DEMO_SIP_${Date.now()}`,
        channel,
        demo: true,
        message: 'Demo mode - configure API credentials for full functionality'
      });
    }

    const agentUid = Math.floor(Math.random() * 100000) + 1000;
    const sipUid = Math.floor(Math.random() * 100000) + 600000;

    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;
    const agentToken = appCertificate ? buildUnifiedToken(appId, appCertificate, channel, agentUid).token : "";
    const sipToken = appCertificate ? buildUnifiedToken(appId, appCertificate, channel, sipUid).token : "";

    const defaultSystemPrompt = buildSystemPrompt(promptType || 'post-op', profileContext || '');

    // SIP_DEMO_TO_NUMBER overrides patient number for demo; fall back to patient's actual number
    const rawToNumber = process.env.SIP_DEMO_TO_NUMBER || toNumber;
    // Strip spaces from phone numbers (API rejects them)
    const cleanToNumber = rawToNumber.replace(/\s/g, '');
    const cleanFromNumber = (process.env.SIP_FROM_NUMBER || "+12013040786").replace(/\s/g, '');

    const requestBody = {
      name: agentName,
      properties: {
        channel: channel,
        token: agentToken,
        agent_rtc_uid: agentUid.toString(),
        remote_rtc_uids: [sipUid.toString()],
        enable_string_uid: false,
        idle_timeout: 30,
        asr: {
          vendor: "ares",
          language: "en-US"
        },
        llm: {
          url: process.env.LLM_URL,
          api_key: process.env.LLM_API_KEY,
          system_messages: [
            { role: "system", content: defaultSystemPrompt }
          ],
          greeting_message: greetingMessage || "Hello! I'm your AI health assistant calling for a post-op check-in. How are you feeling today?",
          failure_message: "Sorry, I'm having some trouble right now. Let me try again!",
          params: {
            model: process.env.LLM_MODEL || "gpt-4o-mini"
          },
          input_modalities: ["text"],
          output_modalities: ["text"]
        },
        tts: {
          vendor: "elevenlabs",
          params: {
            key: process.env.TTS_ELEVENLABS_API_KEY,
            model_id: process.env.TTS_ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5",
            voice_id: process.env.TTS_ELEVENLABS_VOICE_ID
          }
        },
        turn_detection: {
          mode: "default",
          config: {
            speech_threshold: 0.5,
            start_of_speech: {
              mode: "vad",
              vad_config: {
                interrupt_duration_ms: 160,
                speaking_interrupt_duration_ms: 320,
                prefix_padding_ms: 800
              }
            },
            end_of_speech: {
              mode: "semantic",
              semantic_config: {
                silence_duration_ms: 320,
                max_wait_ms: 1200
              }
            }
          }
        },
        advanced_features: {
          enable_bhvs: true,
          enable_rtm: true
        },
        parameters: {
          data_channel: "rtm",
          audio_scenario: "chorus",
          transcript: {
            redundant: false
          },
          silence_config: {
            timeout_ms: 30000,
            action: "think",
            content: "Patient hasn't spoken for a while. Ask if they're still there or if they have any questions."
          }
        }
      },
      // sip must be top-level (same level as name/properties)
      sip: {
        to_number: cleanToNumber,
        from_number: cleanFromNumber,
        rtc_uid: sipUid.toString(),
        rtc_token: sipToken,
        max_ring_duration_ms: 30000,
        max_duration_seconds: 300,
        max_silence_duration_ms: 60000
      }
    };

    const auth = Buffer.from(`${process.env.AGORA_API_KEY}:${process.env.AGORA_API_SECRET}`).toString('base64');

    console.log('[startSIPCall] calling %s via SIP — agentUid=%d sipUid=%d', cleanToNumber, agentUid, sipUid);

    const response = await axios.post(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appId}/call`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        },
        timeout: 15000
      }
    );

    console.log('[startSIPCall] call response status=%d body=%j', response.status, response.data);

    res.json({
      success: true,
      agentId: response.data.agent_id,
      agentUid: agentUid,
      sipUid: sipUid,
      channel: channel
    });

  } catch (error) {
    const detail = error.response?.data || error.message;
    console.error('[startSIPCall] Agora API error status=%s body=%j', error.response?.status, detail);
    res.status(500).json({
      error: 'Failed to start SIP call',
      details: detail
    });
  }
};

const getAgentStatus = async (req, res) => {
  try {
    const { agentId } = req.params;
    const auth = Buffer.from(`${process.env.AGORA_API_KEY}:${process.env.AGORA_API_SECRET}`).toString('base64');
    const response = await axios.get(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${process.env.AGORA_APP_ID}/agents/${agentId}`,
      { headers: { Authorization: `Basic ${auth}` }, timeout: 8000 }
    );
    console.log('[agentStatus] agentId=%s status=%j', agentId, response.data);
    res.json(response.data);
  } catch (error) {
    // 404 from Agora means agent no longer exists (already stopped)
    if (error.response?.status === 404) {
      return res.json({ status: 'STOPPED', message: 'Agent no longer exists' });
    }
    res.status(500).json({ error: error.response?.data || error.message });
  }
};

const stopConversation = async (req, res) => {
  try {
    const { agentId } = req.params;
    
    if (!agentId) {
      return res.status(400).json({ error: 'Agent ID is required' });
    }

    // Check if credentials are configured
    if (!process.env.AGORA_API_KEY || !process.env.AGORA_API_SECRET || !process.env.AGORA_APP_ID) {
      console.log('Agora credentials not configured, simulating stop conversation');
      return res.json({ 
        success: true, 
        message: 'Conversation stopped (demo mode - no API credentials)',
        demo: true
      });
    }

    const auth = Buffer.from(`${process.env.AGORA_API_KEY}:${process.env.AGORA_API_SECRET}`).toString('base64');
    
    const response = await axios.post(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${process.env.AGORA_APP_ID}/agents/${agentId}/leave`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        }
      }
    );

    res.json({ success: true, message: 'Conversation stopped ' + response.data.message });

  } catch (error) {
    console.error('Stop conversation error:', error.response?.data || error.message);
    
    // Return success in demo mode to avoid blocking UI
    res.json({ 
      success: true, 
      message: 'Conversation stopped (demo mode - API error handled)',
      error: error.response?.data || error.message,
      demo: true
    });
  }
};

function buildSystemPrompt(promptType, profileContext) {
  const templates = {
    patient: process.env.PROMPT_PATIENT || process.env.LLM_SYSTEM_PROMPT || 'You are a helpful AI health assistant. Before any health suggestion, note that you are an AI and recommend confirming with a healthcare provider.',
    'post-op': process.env.PROMPT_POST_OP_CARE || 'You are an AI following up with a patient after their procedure.',
    doctor: process.env.PROMPT_DOCTOR_ASSISTANT || 'You are an AI clinical assistant. Answer medical questions concisely and accurately — drug interactions, treatment protocols, dosage guidelines, differential diagnoses. Be direct and professional. Cite your reasoning.'
  };
  const template = templates[promptType] || templates.patient;
  return profileContext ? `${profileContext}\n\n${template}` : template;
}

// Helper: build unified RTC + RTM token
function buildUnifiedToken(appId, appCertificate, channel, uid, expirationTimeInSeconds = 3600) {
  const numericUid = parseInt(uid);
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  const token = new AccessToken2(appId, appCertificate, currentTimestamp, expirationTimeInSeconds);

  const serviceRtc = new ServiceRtc(channel, numericUid);
  serviceRtc.add_privilege(ServiceRtc.kPrivilegeJoinChannel, privilegeExpiredTs);
  serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishAudioStream, privilegeExpiredTs);
  serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishVideoStream, privilegeExpiredTs);
  serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishDataStream, privilegeExpiredTs);
  token.add_service(serviceRtc);

  const serviceRtm = new ServiceRtm(uid.toString());
  serviceRtm.add_privilege(ServiceRtm.kPrivilegeLogin, privilegeExpiredTs);
  token.add_service(serviceRtm);

  return {
    token: token.build(),
    expiresIn: expirationTimeInSeconds
  };
}

module.exports = {
  getChannelInfo,
  startConversation,
  startSIPCall,
  stopConversation,
  getAgentStatus,
  buildSystemPrompt
};