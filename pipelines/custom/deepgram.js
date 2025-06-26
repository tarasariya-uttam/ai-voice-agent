const WebSocket = require('ws');

function setupDeepgramSocket(onTranscript) {
  const deepgramSocket = new WebSocket(
    `wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000&model=nova-2-phonecall`,
    { headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` } }
  );

  deepgramSocket.on('open', () => {
    console.log('[LOG] Deepgram WebSocket connected.');
  });

  deepgramSocket.on('message', (data) => {
    const message = JSON.parse(data);
    if (message.channel && message.channel.alternatives[0].transcript) {
      const transcript = message.channel.alternatives[0].transcript;
      if (transcript.length > 0) {
        console.log(`[LOG] Received transcript from Deepgram: ${transcript}`);
        onTranscript(transcript);
      }
    }
  });

  deepgramSocket.on('error', (error) => {
    console.error('[LOG] Deepgram WebSocket Error:', error);
  });

  deepgramSocket.on('close', () => {
    console.log('[LOG] Deepgram WebSocket disconnected.');
  });

  return deepgramSocket;
}

function setupDeepgramSocketForVonage(onTranscript) {
  const deepgramSocket = new WebSocket(
    `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=8000&model=nova-2-phonecall`,
    { headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` } }
  );

  deepgramSocket.on('open', () => {
    console.log('[LOG] Deepgram WebSocket (Vonage) connected.');
  });

  deepgramSocket.on('message', (data) => {
    const message = JSON.parse(data);
    if (message.channel && message.channel.alternatives[0].transcript) {
      const transcript = message.channel.alternatives[0].transcript;
      if (transcript.length > 0) {
        console.log(`[LOG] Received transcript from Deepgram (Vonage): ${transcript}`);
        onTranscript(transcript);
      }
    }
  });

  deepgramSocket.on('error', (error) => {
    console.error('[LOG] Deepgram WebSocket (Vonage) Error:', error);
  });

  deepgramSocket.on('close', () => {
    console.log('[LOG] Deepgram WebSocket (Vonage) disconnected.');
  });

  return deepgramSocket;
}

module.exports = { setupDeepgramSocket, setupDeepgramSocketForVonage }; 