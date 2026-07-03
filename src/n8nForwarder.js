import fetch from 'node-fetch';
import { config } from './config.js';
import { log } from './logger.js';

export class N8nForwarder {
  constructor(callId, { guildId, channelId }) {
    this.callId = callId;
    this.guildId = guildId;
    this.channelId = channelId;
    this.pending = [];
    this.timer = null;

    if (config.batchIntervalMs > 0) {
      this.timer = setInterval(() => this.flush(), config.batchIntervalMs);
    }
  }

  addSegment(segment) {
    this.pending.push(segment);
    // Send immediately if batching is disabled
    if (config.batchIntervalMs === 0) {
      this.flush();
    }
  }

  async flush() {
    if (this.pending.length === 0) return;
    if (!config.n8nWebhookUrl) {
      log.warn('N8N_WEBHOOK_URL not set - dropping segments instead of sending. Segments so far:', this.pending.length);
      this.pending = [];
      return;
    }

    const segments = this.pending;
    this.pending = [];

    const payload = {
      callId: this.callId,
      guildId: this.guildId,
      channelId: this.channelId,
      sentAt: new Date().toISOString(),
      segments,
    };

    try {
      const res = await fetch(config.n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`n8n webhook returned ${res.status}`);
      }
      log.info(`Sent ${segments.length} segment(s) to n8n for call ${this.callId}`);
    } catch (err) {
      log.error('Failed to send segments to n8n, re-queueing:', err.message);
      // Put them back at the front so they go out on next flush
      this.pending = [...segments, ...this.pending];
    }
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}
