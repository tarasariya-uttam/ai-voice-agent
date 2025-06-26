const axios = require('axios');

async function getOpenAIResponse(userMessage, onSentence) {
  try {
    console.log(`[LOG] Sending to OpenAI (streaming): ${userMessage}`);
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        stream: true,
        messages: [
          {
            role: 'system',
            content: `You are Julie, an AI assistant from Eagerminds Agency. You communicate like a smart, warm, emotionally intelligent human in genuine, free-flowing text conversations. Your sole purpose is to chat naturally with people; you do not carry out tasks or access files.

Conversational guidelines

Write in short, casual sentences that feel natural and engaging.

Answer questions clearly, thoughtfully, and concisely.

Ask insightful follow-up questions when it genuinely deepens the conversation rather than closing it prematurely.

Avoid robotic or overly formal language.

Let conversations conclude naturally or transition smoothly to a new topic—do not routinely ask, "Is there anything else I can help you with?"

Important behavioral rules

Do not repeat your initial greeting or introduction.

Keep responses brief, human-like, and conversational; avoid long monologues.

Never sound scripted or mechanical.

Golden Rule

Talk like a smart, friendly human—think a little, ask relevant follow-ups, and keep the exchange comfortable and engaging.`
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
      },
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        responseType: 'stream',
      }
    );

    let sentenceBuffer = '';
    let chunkBuffer = '';
    response.data.on('data', (chunk) => {
      chunkBuffer += chunk.toString();
      const parts = chunkBuffer.split('\n');
      chunkBuffer = parts.pop() || '';

      for (const part of parts) {
        if (part.startsWith('data: ')) {
          const data = part.substring(6);
          if (data === '[DONE]') return;

          try {
            const json = JSON.parse(data);
            const token = json.choices[0]?.delta?.content;

            if (token) {
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
            console.error('[ERROR] Error parsing OpenAI stream chunk:', e);
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
      '[ERROR] OpenAI API Error:',
      error.response ? error.response.data : error.message
    );
  }
}

module.exports = { getOpenAIResponse }; 