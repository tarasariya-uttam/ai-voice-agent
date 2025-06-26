const WebSocket = require('ws');
const axios = require('axios');
const pcmConvert = require('pcm-convert');

function referencePipeline(ws, caller) {
  let streamSid = null;
  let elevenLabsSocket = null;

  // The user is testing if they can force ulaw input from their dashboard.
  // Temporarily commenting out the conversion code.
  /*
  function mulawToPcmSample(muLawByte) {
    muLawByte = ~muLawByte;
    let sign = (muLawByte & 0x80) ? -1 : 1;
    let exponent = (muLawByte >> 4) & 0x07;
    let mantissa = muLawByte & 0x0F;
    let sample = ((mantissa << 4) + 0x08) << exponent;
    return sign * (sample - 0x84);
  }

  function mulawBufferToPcm16(mulawBuffer) {
    const pcmBuffer = Buffer.alloc(mulawBuffer.length * 2);
    for (let i = 0; i < mulawBuffer.length; i++) {
      const pcmSample = mulawToPcmSample(mulawBuffer[i]);
      pcmBuffer.writeInt16LE(pcmSample, i * 2);
    }
    return pcmBuffer;
  }
  */

  async function setupElevenLabs() {
    try {
      const { data } = await axios.get(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${process.env.AGENT_ID}`,
        { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } }
      );
      
      return new Promise((resolve, reject) => {
        elevenLabsSocket = new WebSocket(data.signed_url);
        
        elevenLabsSocket.on('open', () => {
          console.log('[LOG] Connected to ElevenLabs. Sending initiation message...');
          // Based on user testing, we can now request ulaw for both input and output.
          // This removes the need for conversion for Twilio calls.
          const initiationMessage = {
            type: "conversation_initiation_client_data",
            conversation_config_override: {
              agent: {
                agent_output_audio_format: "ulaw_8000",
                user_input_audio_format: "ulaw_8000"
              }
            }
          };
          elevenLabsSocket.send(JSON.stringify(initiationMessage));
          resolve();
        });

        elevenLabsSocket.on('message', (data) => handleElevenLabsMessages(JSON.parse(data)));
        elevenLabsSocket.on('error', (error) => {
          console.error('[ERROR] ElevenLabs WebSocket:', error)
          reject(error);
        });
        elevenLabsSocket.on('close', () => console.log('[LOG] Disconnected from ElevenLabs'));
      });
    } catch (error) {
      console.error('[ERROR] Error setting up ElevenLabs WebSocket:', error.message);
    }
  }

  function handleElevenLabsMessages(message) {
    // Log all messages from ElevenLabs to see what's happening
    // console.log(`[ELEVENLABS_MESSAGE] Received:`, JSON.stringify(message, null, 2));
    
    // Check for audio_event and its payload
    if (message.audio_event?.audio_base_64) {
      if (streamSid) {
        const audioData = {
          event: 'media',
          streamSid,
          media: { payload: message.audio_event.audio_base_64 }
        };
        ws.send(JSON.stringify(audioData));
      }
    } else {
      // Handle other message types
      switch (message.type) {
        case 'interruption':
          if (streamSid) {
            ws.send(JSON.stringify({ event: 'clear', streamSid }));
          }
          break;
        case 'ping':
          if (message.ping_event?.event_id) {
            elevenLabsSocket.send(JSON.stringify({ type: 'pong', event_id: message.ping_event.event_id }));
          }
          break;
        default:
          break;
      }
    }
  }

  ws.on('message', async (message) => {
    // For Vonage, messages are binary buffers. For Twilio, they're JSON strings.
    const isVonage = caller === 'vonage';
    let msg;

    if (isVonage) {
      // If it's a binary message from Vonage, it's audio.
      // We need to convert it from pcm_16000 to ulaw_8000
      const pcmBuffer = Buffer.from(message);
      const ulawBuffer = pcmConvert(pcmBuffer, { F: 's16le', T: 'mulaw', C: 1, R: 8000 });
      const ulawBase64 = ulawBuffer.toString('base64');
      if (elevenLabsSocket && elevenLabsSocket.readyState === WebSocket.OPEN) {
        elevenLabsSocket.send(JSON.stringify({ user_audio_chunk: ulawBase64 }));
      }
      return; // Early return for Vonage audio messages
    }

    // For Twilio, parse the JSON message
    try { msg = JSON.parse(message.toString()); } catch { return; }
    
    // console.log(`[TWILIO_EVENT] Received event: ${msg.event}`);

    switch (msg.event) {
      case 'connected':
        console.log('[LOG] Twilio connected.');
        break;
      case 'start':
        streamSid = msg.start.streamSid;
        console.log(`[LOG] Call stream started. SID: ${streamSid}. Setting up ElevenLabs...`);
        await setupElevenLabs();
        console.log('[LOG] ElevenLabs setup complete. Ready for media.');
        break;
      case 'media':
        // This is for Twilio ulaw audio
        if (elevenLabsSocket && elevenLabsSocket.readyState === WebSocket.OPEN) {
          elevenLabsSocket.send(JSON.stringify({ user_audio_chunk: msg.media.payload }));
        }
        break;
      case 'stop':
        console.log('[LOG] Call stream ended.');
        if (elevenLabsSocket) elevenLabsSocket.close();
        if (ws) ws.close();
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    console.log(`[LOG] ${caller} WebSocket connection closed.`);
    if (elevenLabsSocket) elevenLabsSocket.close();
  });

  ws.on('error', (err) => {
    console.error(`[ERROR] ${caller} WebSocket error:`, err);
    if (elevenLabsSocket) elevenLabsSocket.close();
  });
}

module.exports = referencePipeline; 