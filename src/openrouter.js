import fetch from 'node-fetch';
import { config } from './config.js';
import { log } from './logger.js';

export async function generateConversationMetadata(segments) {
  if (!config.openrouterApiKey) {
    log.warn('OPENROUTER_API_KEY not set, skipping AI metadata generation');
    return { title: null, description: null, importance: 0 };
  }

  const transcript = segments
    .map(s => `${s.username}: ${s.text}`)
    .join('\n');

  const prompt = `Analyze this conversation transcript and provide:
1. A concise title (max 10 words)
2. A brief description (2-3 sentences summarizing key points)
3. An importance rating from 1-10 (10 = contains critical information like meeting decisions, deadlines, key insights; 1 = casual chat with no actionable info)

Respond in JSON format:
{
  "title": "string",
  "description": "string",
  "importance": number
}

Conversation transcript:
${transcript}`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/stuffzez/dote-bot',
        'X-Title': 'Dote Bot'
      },
      body: JSON.stringify({
        model: config.openrouterModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 200
      })
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenRouter API error: ${res.status} - ${body}`);
    }

    const data = await res.json();
    const content = data.choices[0].message.content;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const metadata = JSON.parse(jsonMatch[0]);
    log.info(`Generated metadata: title="${metadata.title}", importance=${metadata.importance}`);
    return metadata;
  } catch (err) {
    log.error('Failed to generate conversation metadata:', err.message);
    return { title: null, description: null, importance: 0 };
  }
}

export async function chatWithMemory(messages, context) {
  if (!config.openrouterApiKey) {
    throw new Error('OPENROUTER_API_KEY not set');
  }

  const systemMessage = {
    role: 'system',
    content: `You are Dote, a helpful AI assistant in a Discord server. You help users recall and analyze past voice conversations.

STORED CONVERSATIONS:
${context}

INSTRUCTIONS:
- Answer questions based on the stored conversations above
- Reference specific conversations by title when relevant
- Quote relevant segments when helpful
- If you don't have enough information from the conversations, say so
- Be concise and helpful
- You can see the chat history below - continue the conversation naturally`
  };

  const apiMessages = [systemMessage, ...messages];

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/stuffzez/dote-bot',
        'X-Title': 'Dote Bot'
      },
      body: JSON.stringify({
        model: config.openrouterModel,
        messages: apiMessages,
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenRouter API error: ${res.status} - ${body}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  } catch (err) {
    log.error('OpenRouter chat failed:', err.message);
    throw err;
  }
}
