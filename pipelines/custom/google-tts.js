const textToSpeech = require('@google-cloud/text-to-speech');

const client = new textToSpeech.TextToSpeechClient();

async function synthesizeSpeech(text) {
  try {
    console.log(`[LOG] Synthesizing speech for: "${text}"`);
    const request = {
      input: { text: text },
      voice: { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
      audioConfig: {
        audioEncoding: 'MULAW',
        sampleRateHertz: 8000,
      },
    };

    const [response] = await client.synthesizeSpeech(request);
    const audioContent = response.audioContent.toString('base64');
    console.log('[LOG] Speech synthesized successfully.');
    return audioContent;
  } catch (error) {
    console.error('[ERROR] Google TTS Error:', error);
    return null;
  }
}

async function synthesizeSpeechForVonage(text) {
  try {
    console.log(`[LOG] Synthesizing speech for Vonage: "${text}"`);
    const request = {
      input: { text: text },
      voice: { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
      audioConfig: {
        audioEncoding: 'LINEAR16',
        sampleRateHertz: 8000,
      },
    };

    console.log('[TTS_REQUEST] Google TTS request config:', JSON.stringify(request, null, 2));

    const [response] = await client.synthesizeSpeech(request);
    
    // Analyze the returned audio content
    console.log('[TTS_RESPONSE] Google TTS response analysis:');
    console.log(`  - Audio content type: ${typeof response.audioContent}`);
    console.log(`  - Audio content length: ${response.audioContent.length} bytes`);
    console.log(`  - First 16 bytes (hex): ${response.audioContent.slice(0, 16).toString('hex')}`);
    console.log(`  - First 16 bytes (ascii): ${response.audioContent.slice(0, 16).toString('ascii')}`);
    
    // Check if it's already in the right format
    const first4Bytes = response.audioContent.slice(0, 4).toString();
    if (first4Bytes === 'RIFF') {
      console.log('[TTS_RESPONSE] WARNING: Google TTS returned WAV format despite requesting LINEAR16');
      console.log('[TTS_RESPONSE] This might be causing the audio format issues');
    } else {
      console.log('[TTS_RESPONSE] Audio appears to be raw PCM (no WAV header)');
    }
    
    // Return the raw buffer for Vonage
    console.log('[LOG] Speech synthesized for Vonage successfully.');
    return response.audioContent;
  } catch (error) {
    console.error('[ERROR] Google TTS (Vonage) Error:', error);
    return null;
  }
}

module.exports = { synthesizeSpeech, synthesizeSpeechForVonage }; 