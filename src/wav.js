// Discord voice PCM format: 48kHz, stereo, 16-bit signed LE.
// Duplicated here (rather than imported from speakerCapture.js) so this module
// has no dependency on native audio packages and can be unit-tested in isolation.
const PCM_SAMPLE_RATE = 48000;
const PCM_CHANNELS = 2;
const PCM_BYTES_PER_SAMPLE = 2;

/**
 * Wraps raw 16-bit PCM in a minimal WAV header.
 * Discord voice PCM is 48kHz stereo by default - Whisper handles that fine,
 * but we downmix to mono here since it's smaller and transcription doesn't need stereo.
 */
export function pcmToWav(pcmBuffer, { sampleRate = PCM_SAMPLE_RATE, channels = PCM_CHANNELS } = {}) {
  const mono = channels === 2 ? downmixToMono(pcmBuffer) : pcmBuffer;
  const outChannels = 1;

  const dataSize = mono.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(outChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * outChannels * PCM_BYTES_PER_SAMPLE, 28); // byte rate
  header.writeUInt16LE(outChannels * PCM_BYTES_PER_SAMPLE, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, mono]);
}

function downmixToMono(stereoBuffer) {
  const samples = stereoBuffer.length / 4; // 2 bytes/sample * 2 channels
  const mono = Buffer.alloc(samples * 2);

  for (let i = 0; i < samples; i++) {
    const left = stereoBuffer.readInt16LE(i * 4);
    const right = stereoBuffer.readInt16LE(i * 4 + 2);
    const avg = Math.round((left + right) / 2);
    mono.writeInt16LE(avg, i * 2);
  }

  return mono;
}
