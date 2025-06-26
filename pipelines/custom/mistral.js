const axios = require('axios');

async function getMistralResponse(userMessage, onSentence) {
  try {
    console.log(`[LOG] Sending to local Mistral (streaming): ${userMessage}`);
    const response = await axios.post(
      'http://localhost:11434/api/chat',
      {
        model: 'mistral',
        stream: true,
        messages: [
          {
            role: 'system',
            content: `You are Julie, a human-like voice assistant.
**CRITICAL INSTRUCTIONS:**
- Your answers MUST be very short, like a real human on a phone call.
- Use 1-2 sentences MAXIMUM.
- Be friendly, warm, and natural.
- DO NOT give long explanations.
- Ask questions to keep the conversation going.
- NEVER sound like a robot or a scripted agent.
- NEVER say "Hello there" or similar greetings in responses.
- Keep answers straightforward and direct - no unnecessary pleasantries.
- Respond naturally to what the person just said.
- NEVER repeat yourself - if you need to make the same point again, paraphrase it differently.
Your only goal is a short, natural, human-like conversation.`
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
      },
      { responseType: 'stream' }
    );

    let sentenceBuffer = '';
    let chunkBuffer = '';
    response.data.on('data', (chunk) => {
      chunkBuffer += chunk.toString();
      const parts = chunkBuffer.split('\n');
      chunkBuffer = parts.pop() || '';

      for (const part of parts) {
        if (part) {
          try {
            const json = JSON.parse(part);
            if (json.message && json.message.content) {
              const token = json.message.content;
              sentenceBuffer += token;
              if (/[.!?]/.test(token)) {
                const sentence = sentenceBuffer.trim();
                if (sentence) {
                  onSentence(sentence);
                }
                sentenceBuffer = '';
              }
            }
          } catch (e) {
            console.error('[ERROR] Error parsing LLM stream chunk:', e);
          }
        }
      }
    });

    response.data.on('end', () => {
      if (sentenceBuffer.trim()) {
        onSentence(sentenceBuffer.trim());
      }
    });

  } catch (error) {
    console.error(
      '[ERROR] Local Mistral API Error:',
      error.response ? error.response.data : error.message
    );
  }
}

module.exports = { getMistralResponse }; 