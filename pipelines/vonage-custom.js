const WebSocket = require('ws');
const { setupDeepgramSocketForVonage } = require('./custom/deepgram');
const { getMistralResponse } = require('./custom/mistral');
const { synthesizeSpeechForVonage } = require('./custom/google-tts');
const { getOpenAIResponse } = require('./custom/openai');
const { URL } = require('url');
const ffmpeg = require('fluent-ffmpeg');
const stream = require('stream');

function vonageCustomPipeline(ws, req) {
  console.log('[LOG] Vonage custom pipeline WebSocket connection opened.');
  let deepgramSocket = null;
  let llm = 'mistral'; // default

  // --- Debounce Logic ---
  let transcriptBuffer = '';
  let debounceTimer = null;

  // --- LLM Audio Queue Logic ---
  const llmAudioQueue = [];
  let isStreamingAudio = false;

  async function processLlmAudioQueue() {
    if (isStreamingAudio || llmAudioQueue.length === 0) return;
    isStreamingAudio = true;
    const { text, resolve } = llmAudioQueue.shift();
    try {
      const audio = await synthesizeSpeechForVonage(text);
      if (audio) {
        await sendAudioToVonage(audio, true); // Await streaming completion
      }
    } catch (err) {
      console.error('[AUDIO_QUEUE] Error processing LLM audio:', err);
    }
    isStreamingAudio = false;
    resolve();
    processLlmAudioQueue();
  }

  function enqueueLlmAudio(text) {
    return new Promise((resolve) => {
      llmAudioQueue.push({ text, resolve });
      processLlmAudioQueue();
    });
  }

  // Utility: Convert buffer to 16-bit PCM, 8kHz, mono using ffmpeg
  function convertToPcm8kMono(buffer) {
    return new Promise((resolve, reject) => {
      const inputStream = new stream.PassThrough();
      inputStream.end(buffer);
      const outputStream = new stream.PassThrough();
      let outputBuffer = Buffer.alloc(0);
      outputStream.on('data', (chunk) => {
        outputBuffer = Buffer.concat([outputBuffer, chunk]);
      });
      outputStream.on('end', () => {
        resolve(outputBuffer);
      });
      let inputFmt = 's16le';
      if (buffer.slice(0, 4).toString() === 'RIFF') {
        inputFmt = 'wav';
      }
      ffmpeg(inputStream)
        .inputFormat(inputFmt)
        .audioChannels(1)
        .audioFrequency(8000)
        .audioCodec('pcm_s16le')
        .format('s16le')
        .on('error', (err) => {
          reject(err);
        })
        .pipe(outputStream, { end: true });
    });
  }

  // Utility: Send buffer to Vonage in 320-byte (20ms) chunks
  function sendAudioBufferInChunks(ws, buffer) {
    const chunkSize = 320;
    let offset = 0;
    function sendNextChunk() {
      if (offset >= buffer.length || ws.readyState !== 1) {
        return;
      }
      const chunk = buffer.slice(offset, offset + chunkSize);
      ws.send(chunk);
      offset += chunkSize;
      setTimeout(sendNextChunk, 20);
    }
    sendNextChunk();
  }

  // sendAudioToVonage returns a Promise that resolves when streaming is done
  const sendAudioToVonage = async (audioChunk, awaitStreaming = false) => {
    if (ws.readyState !== 1) {
      return;
    }
    let outBuffer = audioChunk;
    if (Buffer.isBuffer(audioChunk) && audioChunk.slice(0, 4).toString() === 'RIFF') {
      // Detected WAV header, pass full buffer to ffmpeg
    }
    outBuffer = await convertToPcm8kMono(outBuffer);
    if (awaitStreaming) {
      return new Promise((resolve) => {
        let offset = 0;
        const chunkSize = 320;
        function sendNextChunk() {
          if (offset >= outBuffer.length || ws.readyState !== 1) {
            resolve();
            return;
          }
          const chunk = outBuffer.slice(offset, offset + chunkSize);
          ws.send(chunk);
          offset += chunkSize;
          setTimeout(sendNextChunk, 20);
        }
        sendNextChunk();
      });
    } else {
      sendAudioBufferInChunks(ws, outBuffer);
    }
  };

  // This function processes the final, complete transcript after a pause
  const processFullTranscript = (transcript) => {
    if (!transcript) return;
    const onSentence = async (sentence) => {
      // Enqueue each LLM response for sequential TTS and streaming
      await enqueueLlmAudio(sentence);
    };
    console.log(`[DEBUG] Routing decision: llm is '${llm}'.`);
    if (llm === 'openai') {
      console.log('[DEBUG] Calling getOpenAIResponse.');
      getOpenAIResponse(transcript, onSentence);
    } else {
      console.log('[DEBUG] Calling getMistralResponse.');
      getMistralResponse(transcript, onSentence);
    }
  };
  
  // This function is called for every transcript chunk from Deepgram
  const handleDeepgramTranscript = (transcript) => {
    console.log(`[DEBUG] Deepgram transcript: ${transcript}`);
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
    const audio = await synthesizeSpeechForVonage(greeting);
    if (audio) {
      // Await streaming of greeting before allowing LLM queue to start
      await sendAudioToVonage(audio, true);
    }
  };

  // Parse URL to get llm parameter
  const requestUrl = new URL(req.url, `ws://${req.headers.host}`);
  llm = requestUrl.searchParams.get('llm') || 'mistral';
  console.log(`[LOG] Using LLM: ${llm}`);

  // Set up Deepgram connection
  deepgramSocket = setupDeepgramSocketForVonage(handleDeepgramTranscript);
  
  // Send greeting
  handleGreeting();

  // Handle incoming audio from Vonage
  ws.on('message', (message) => {
    // console.log(`[DEBUG] Received audio from Vonage (length: ${message.length})`);
    if (deepgramSocket && deepgramSocket.readyState === 1) {
      deepgramSocket.send(message);
    }
  });

  ws.on('close', () => {
    console.log('[LOG] Vonage WebSocket connection closed.');
    if (deepgramSocket) {
      deepgramSocket.close();
    }
  });

  ws.on('error', (error) => {
    console.error('[LOG] Vonage WebSocket Error:', error);
    if (deepgramSocket) {
      deepgramSocket.close();
    }
  });
}

module.exports = vonageCustomPipeline; 