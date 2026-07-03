import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { config } from './config.js';
import { log } from './logger.js';
import { SpeakerCaptureManager } from './speakerCapture.js';
import { transcribePcm } from './transcribe.js';
import { ConversationManager } from './conversationManager.js';

// One CallSession per active voice channel the bot is in.
export class CallSession {
  constructor(voiceChannel, client) {
    this.voiceChannel = voiceChannel;
    this.client = client;
    this.conversation = null;
    this.emptyCheckTimer = null;
    this.usernameCache = new Map();
  }

  async start() {
    this.connection = joinVoiceChannel({
      channelId: this.voiceChannel.id,
      guildId: this.voiceChannel.guildId,
      adapterCreator: this.voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false, // must hear audio to receive it
      selfMute: true, // bot never needs to speak
    });

    await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000);
    log.info(`Joined voice channel ${this.voiceChannel.name} (${this.voiceChannel.id})`);

    this.conversation = ConversationManager.startConversation({
      guildId: this.voiceChannel.guildId,
      voiceChannelId: this.voiceChannel.id,
    });

    const receiver = this.connection.receiver;

    this.captureManager = new SpeakerCaptureManager(
      receiver,
      (utterance) => this.handleUtterance(utterance),
      (userId) => this.resolveUsername(userId)
    );

    receiver.speaking.on('start', (userId) => {
      this.captureManager.subscribeToUser(userId);
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.stop('disconnected');
      }
    });

    this.scheduleEmptyCheck();
  }

  async resolveUsername(userId) {
    if (this.usernameCache.has(userId)) return this.usernameCache.get(userId);
    const member = await this.voiceChannel.guild.members.fetch(userId);
    const name = member.displayName ?? member.user.username;
    this.usernameCache.set(userId, name);
    return name;
  }

  async handleUtterance({ userId, username, startedAt, endedAt, pcm }) {
    try {
      const text = await transcribePcm(pcm);
      if (!text) {
        log.debug(`Empty transcription for ${username}, skipping`);
        return;
      }
      log.info(`[${username}] ${text}`);

      if (this.conversation) {
        ConversationManager.addSegmentToConversation(this.conversation.id, {
          userId,
          username,
          startTime: new Date(startedAt).toISOString(),
          endTime: new Date(endedAt).toISOString(),
          text,
        });
      }
    } catch (err) {
      log.error(`Transcription failed for ${username}:`, err.message);
    }
  }

  scheduleEmptyCheck() {
    if (this.emptyCheckTimer) clearInterval(this.emptyCheckTimer);
    this.emptyCheckTimer = setInterval(() => {
      const humanMembers = this.voiceChannel.members.filter((m) => !m.user.bot);
      if (humanMembers.size === 0) {
        log.info(`Voice channel ${this.voiceChannel.name} is empty, leaving`);
        this.stop('empty_channel');
      }
    }, config.autoLeaveEmptyMs);
  }

  async stop(reason = 'manual') {
    log.info(`Ending call session (reason: ${reason})`);
    if (this.emptyCheckTimer) clearInterval(this.emptyCheckTimer);
    if (this.captureManager) this.captureManager.destroy();
    if (this.connection) {
      try {
        this.connection.destroy();
      } catch {
        // already destroyed
      }
    }

    if (this.conversation) {
      await ConversationManager.endConversationAndProcess(this.conversation.id);
    }

    this.onEnded?.(this);
  }
}
