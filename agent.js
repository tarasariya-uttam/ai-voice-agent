// Conversational AI Voice Agent Backend
// Supports: Deepgram, Wavenet, Mistral, Twilio, Vonage, ElevenLabs

require('dotenv').config();
const express = require('express');
const Twilio = require('twilio');
const { Vonage } = require('@vonage/server-sdk');
const { Auth } = require('@vonage/auth');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const customPipeline = require('./pipelines/custom/index.js');
const elevenLabsPipeline = require('./pipelines/elevenlabs/reference_pipeline.js');
const vonageCustomPipeline = require('./pipelines/vonage-custom.js');

const app = express();
app.use(express.json());

// --- ENV VARS ---
const PORT = process.env.PORT || 8080;
const SERVER_URL = process.env.SERVER_URL;
const FROM_NUMBER = process.env.FROM_NUMBER;
const TWILIO_ACC = process.env.TWILIO_ACC;
const TWILIO_KEY = process.env.TWILIO_KEY;
const VONAGE_APP_ID = process.env.VONAGE_APPLICATION_ID;
const VONAGE_PRIVATE_KEY_PATH = process.env.VONAGE_PRIVATE_KEY_PATH;
const VONAGE_NUMBER = process.env.VONAGE_NUMBER;

// Initialize Vonage client
const privateKey = fs.readFileSync(VONAGE_PRIVATE_KEY_PATH);
const auth = new Auth({
  applicationId: VONAGE_APP_ID,
  privateKey: privateKey,
});
const vonage = new Vonage(auth);

// --- MAIN API: /call (Unified API for all combinations) ---
app.get('/call', async (req, res) => {
  const { callerservice, pipeline, llm } = req.query;
  const toNumber = req.query.toNumber ? req.query.toNumber.trim() : null;
  
  // Validate required parameters
  if (!callerservice || !pipeline || !toNumber) {
    return res.status(400).send({
      success: false,
      message: 'Missing required parameters: callerservice, pipeline, toNumber'
    });
  }
  
  // Validate caller service
  if (!['twilio', 'vonage'].includes(callerservice)) {
    return res.status(400).send({
      success: false,
      message: 'callerservice must be either "twilio" or "vonage"'
    });
  }
  
  // Validate pipeline
  if (!['new_custom', 'elevenlabs'].includes(pipeline)) {
    return res.status(400).send({
      success: false,
      message: 'pipeline must be either "new_custom" or "elevenlabs"'
    });
  }
  
  // Validate llm parameter (only for new_custom pipeline)
  if (pipeline === 'new_custom' && llm && !['mistral', 'openai'].includes(llm)) {
    return res.status(400).send({
      success: false,
      message: 'llm must be either "mistral" or "openai" (only for new_custom pipeline)'
    });
  }
  
  try {
    if (callerservice === 'twilio') {
      await initiateTwilioCall(toNumber, pipeline, llm, res);
    } else if (callerservice === 'vonage') {
      await initiateVonageCall(toNumber, pipeline, llm, res);
    }
  } catch (error) {
    console.error('❌ Error initiating call:', error.message);
    res.status(500).send({
      success: false,
      message: 'Failed to initiate call',
      error: error.message
    });
  }
});

// --- Twilio Call Initiation ---
async function initiateTwilioCall(toNumber, pipeline, llm, res) {
  const twilioClient = new Twilio(TWILIO_ACC, TWILIO_KEY);
  
  let twimlResponse;
  if (pipeline === 'new_custom') {
    const defaultLlm = llm || 'mistral';
    twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${SERVER_URL}/custom-stream">
      <Parameter name="llm" value="${defaultLlm}" />
    </Stream>
  </Connect>
</Response>`;
  } else if (pipeline === 'elevenlabs') {
    twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${SERVER_URL}/elevenlabs-stream" />
  </Connect>
</Response>`;
  }
  
  const call = await twilioClient.calls.create({
    from: FROM_NUMBER,
    to: toNumber,
    twiml: twimlResponse,
  });
  
  console.log('📞 Twilio call initiated, SID:', call.sid);
  res.send({
    success: true,
    message: 'Twilio call initiated',
    callSid: call.sid,
    callerservice: 'twilio',
    pipeline: pipeline,
    llm: llm || 'default'
  });
}

// --- Vonage Call Initiation ---
async function initiateVonageCall(toNumber, pipeline, llm, res) {
  // For Vonage, we'll use the Voice API with NCCO
  const ncco = [];
  
  if (pipeline === 'new_custom') {
    const defaultLlm = llm || 'mistral';
    ncco.push({
      action: 'connect',
      endpoint: [{
        type: 'websocket',
        uri: `wss://${SERVER_URL}/vonage-custom-stream?llm=${defaultLlm}`,
        'content-type': 'audio/l16;rate=8000'
      }]
    });
  } else if (pipeline === 'elevenlabs') {
    ncco.push({
      action: 'connect',
      endpoint: [{
        type: 'websocket',
        uri: `wss://${SERVER_URL}/vonage-elevenlabs-stream`,
        'content-type': 'audio/l16;rate=8000'
      }]
    });
  }
  
  try {
    const call = await vonage.voice.createOutboundCall({
      to: [{
        type: 'phone',
        number: toNumber
      }],
      from: {
        type: 'phone',
        number: VONAGE_NUMBER
      },
      ncco: ncco
    });
    
    console.log('📞 Vonage call initiated, UUID:', call.uuid);
    res.send({
      success: true,
      message: 'Vonage call initiated',
      callUuid: call.uuid,
      callerservice: 'vonage',
      pipeline: pipeline,
      llm: llm || 'default'
    });
  } catch (error) {
    console.error('❌ Error initiating call:', error.message);
    // Log the entire error object for detailed debugging
    console.error('Full Vonage Error Object:', JSON.stringify(error, null, 2));
    res.status(500).send({
      success: false,
      message: 'Failed to initiate call',
      error: error.message
    });
  }
}

// --- WebSocket Server for Streaming ---
const server = require('http').createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = req.url || '';
  
  if (url.includes('/custom-stream')) {
    console.log('🔗 WebSocket connection established with Twilio (Custom pipeline)');
    customPipeline(ws, req);
  } else if (url.includes('/elevenlabs-stream')) {
    console.log('🔗 WebSocket connection established with Twilio (ElevenLabs pipeline)');
    elevenLabsPipeline(ws, 'twilio');
  } else if (url.includes('/vonage-custom-stream')) {
    console.log('🔗 WebSocket connection established with Vonage (Custom pipeline)');
    vonageCustomPipeline(ws, req);
  } else if (url.includes('/vonage-elevenlabs-stream')) {
    console.log('🔗 WebSocket connection established with Vonage (ElevenLabs pipeline)');
    elevenLabsPipeline(ws, 'vonage');
  } else {
    console.log(`🔌 Closing connection to unknown path: ${url}`);
    ws.close();
  }
});

// Vonage Answer URL endpoint
app.get('/vonage/answer', (req, res) => {
  res.json([
    {
      action: "talk",
      text: "This is a test call from Vonage. Your server is correctly returning an NCCO."
    }
  ]);
});

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
  console.log(`📞 Supported combinations:`);
  console.log(`   - /call?callerservice=twilio&pipeline=new_custom&llm=mistral&toNumber=+1234567890`);
  console.log(`   - /call?callerservice=twilio&pipeline=new_custom&llm=openai&toNumber=+1234567890`);
  console.log(`   - /call?callerservice=twilio&pipeline=elevenlabs&toNumber=+1234567890`);
  console.log(`   - /call?callerservice=vonage&pipeline=new_custom&llm=mistral&toNumber=+1234567890`);
  console.log(`   - /call?callerservice=vonage&pipeline=new_custom&llm=openai&toNumber=+1234567890`);
  console.log(`   - /call?callerservice=vonage&pipeline=elevenlabs&toNumber=+1234567890`);
  console.log("Try any of this API with NGROK exposed api");
}); 