import fetch from 'node-fetch';
import FormData from 'form-data';
import { config } from './config.js';
import { log } from './logger.js';
import { pcmToWav } from './wav.js';

/**
 * Sends a PCM utterance buffer to the Whisper backend and returns transcribed text.
 * Works with whisper-asr-webservice, faster-whisper-server, or any OpenAI-compatible
 * /v1/audio/transcriptions endpoint (self-hosted).
 */
export async function transcribePcm(pcmBuffer) {
  const wav = pcmToWav(pcmBuffer);

  const form = new FormData();
  form.append('audio_file', wav, { filename: 'utterance.wav', contentType: 'audio/wav' });
  if (config.whisperLanguage) {
    form.append('language', config.whisperLanguage);
  }

  const url = `${config.whisperUrl.replace(/\/$/, '')}/asr?output=json${
    config.whisperLanguage ? `&language=${config.whisperLanguage}` : ''
  }`;

  const res = await fetch(url, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Whisper request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  // whisper-asr-webservice returns { text: "..." } for output=json
  const text = (data.text ?? '').trim();
  return text;
}
