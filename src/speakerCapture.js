import prism from 'prism-media';
import { EndBehaviorType } from '@discordjs/voice';
import { config } from './config.js';
import { log } from './logger.js';

// Discord voice PCM format: 48kHz, stereo, 16-bit signed LE
export const PCM_SAMPLE_RATE = 48000;
export const PCM_CHANNELS = 2;
export const PCM_BYTES_PER_SAMPLE = 2;

/**
 * Manages per-user audio subscriptions for a single voice connection.
 * Emits complete "utterances" (buffered PCM for one continuous speaking turn)
 * via the onUtterance callback as soon as a user goes quiet for silenceFlushMs.
 */
export class SpeakerCaptureManager {
  /**
   * @param {import('@discordjs/voice').VoiceReceiver} receiver
   * @param {(utterance: {userId: string, username: string, startedAt: number, endedAt: number, pcm: Buffer}) => void} onUtterance
   * @param {(userId: string) => Promise<string>} resolveUsername
   */
  constructor(receiver, onUtterance, resolveUsername) {
    this.receiver = receiver;
    this.onUtterance = onUtterance;
    this.resolveUsername = resolveUsername;
    this.activeSubscriptions = new Map(); // userId -> true (to avoid double subscribe)
    this.buffers = new Map(); // userId -> { chunks: Buffer[], startedAt: number, lastPacketAt: number }
  }

  /** Call when a user starts speaking (from VoiceReceiver's speaking event) */
  subscribeToUser(userId) {
    if (this.activeSubscriptions.has(userId)) return;
    this.activeSubscriptions.set(userId, true);

    const opusStream = this.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: config.silenceFlushMs,
      },
    });

    const decoder = new prism.opus.Decoder({
      rate: PCM_SAMPLE_RATE,
      channels: PCM_CHANNELS,
      frameSize: 960,
    });

    const startedAt = Date.now();
    let chunks = [];
    let lastPacketAt = startedAt;

    const pcmStream = opusStream.pipe(decoder);

    pcmStream.on('data', (chunk) => {
      chunks.push(chunk);
      lastPacketAt = Date.now();
    });

    const finish = async () => {
      this.activeSubscriptions.delete(userId);
      const endedAt = lastPacketAt;
      const durationMs = endedAt - startedAt;

      if (durationMs < config.minUtteranceMs || chunks.length === 0) {
        log.debug(`Discarding short utterance from ${userId} (${durationMs}ms)`);
        return;
      }

      const pcm = Buffer.concat(chunks);
      chunks = [];

      let username = userId;
      try {
        username = await this.resolveUsername(userId);
      } catch (err) {
        log.warn(`Could not resolve username for ${userId}:`, err.message);
      }

      this.onUtterance({ userId, username, startedAt, endedAt, pcm });
    };

    opusStream.once('end', finish);
    opusStream.once('error', (err) => {
      log.warn(`Opus stream error for ${userId}:`, err.message);
      finish();
    });
    decoder.once('error', (err) => {
      log.warn(`Decoder error for ${userId}:`, err.message);
    });
  }

  destroy() {
    this.activeSubscriptions.clear();
    this.buffers.clear();
  }
}
