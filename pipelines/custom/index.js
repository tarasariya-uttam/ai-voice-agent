const WebSocket = require('ws');
const { setupDeepgramSocket } = require('./deepgram');
const { getMistralResponse } = require('./mistral');
const { synthesizeSpeech } = require('./google-tts');
const { getOpenAIResponse } = require('./openai');
const { URL } = require('url');

function customPipeline(ws, req) {
  console.log('[LOG] Custom pipeline WebSocket connection opened.');
  let deepgramSocket = null;
  let streamSid = null;
  let llm = 'mistral'; // default

  // --- Debounce Logic ---
  let transcriptBuffer = '';
  let debounceTimer = null;

  const sendAudioToTwilio = (audioChunk) => {
    if (ws.readyState === 1 && streamSid) {
      const message = {
        event: 'media',
        streamSid: streamSid,
        media: {
          payload: audioChunk,
        },
      };
      ws.send(JSON.stringify(message));
    }
  };

  // This function processes the final, complete transcript after a pause
  const processFullTranscript = (transcript) => {
    if (!transcript) return;
    
    const onSentence = async (sentence) => {
      const audio = await synthesizeSpeech(sentence);
      if (audio) {
        sendAudioToTwilio(audio);
      }
    };
    
    if (llm === 'openai') {
      getOpenAIResponse(transcript, onSentence);
    } else {
      getMistralResponse(transcript, onSentence);
    }
  };
  
  // This function is called for every transcript chunk from Deepgram
  const handleDeepgramTranscript = (transcript) => {
    transcriptBuffer += transcript + ' ';
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      console.log(`[LOG] Debounce timer fired. Processing: "${transcriptBuffer.trim()}"`);
      processFullTranscript(transcriptBuffer.trim());
      transcriptBuffer = ''; // Clear buffer
    }, 1200); // Wait for a 1.2-second pause
  };

  const handleGreeting = async () => {
    const greeting = "Hi, this is Julie calling from Eagermind Agency. How's everything going today?";
    const audio = await synthesizeSpeech(greeting);
    if (audio) {
      sendAudioToTwilio(audio);
    }
  };

  ws.on('message', (message) => {
    const messageString = message.toString();
    const msg = JSON.parse(messageString);

    switch (msg.event) {
      case 'connected':
        console.log('[LOG] Twilio connected event');
        break;
      case 'start':
        streamSid = msg.start.streamSid;
        llm = msg.start.customParameters?.llm || 'mistral'; // Get llm from custom parameters
        console.log(`[LOG] Twilio start event. streamSid: ${streamSid}, llm: ${llm}`);
        deepgramSocket = setupDeepgramSocket(handleDeepgramTranscript);
        handleGreeting(); // Send greeting on call start
        break;
      case 'media':
        if (deepgramSocket && deepgramSocket.readyState === 1) { // 1 is WebSocket.OPEN
          deepgramSocket.send(Buffer.from(msg.media.payload, 'base64'));
        }
        break;
      case 'stop':
        console.log('[LOG] Twilio stream ended.');
        if (deepgramSocket) {
          deepgramSocket.close();
        }
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    console.log('[LOG] Twilio WebSocket connection closed.');
    if (deepgramSocket) {
      deepgramSocket.close();
    }
  });

  ws.on('error', (error) => {
    console.error('[LOG] Twilio WebSocket Error:', error);
    if (deepgramSocket) {
      deepgramSocket.close();
    }
  });
}

module.exports = customPipeline; 