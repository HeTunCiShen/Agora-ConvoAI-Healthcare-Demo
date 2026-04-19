const express = require('express');
const router = express.Router();
const { getChannelInfo, startConversation, startSIPCall, stopConversation, getAgentStatus } = require('../controllers/agoraController');

router.get('/channel-info', getChannelInfo);
router.post('/start', startConversation);
router.post('/call', startSIPCall);
router.delete('/stop/:agentId', stopConversation);
router.post('/stop/:agentId', stopConversation); // POST alias for sendBeacon (beforeunload)
router.get('/status/:agentId', getAgentStatus);

module.exports = router;