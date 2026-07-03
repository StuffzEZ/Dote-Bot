// All configuration comes from environment variables so this drops
// straight into a Docker container with an env file / docker-compose env block.

function required(name) {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return val;
}

function optional(name, fallback) {
  return process.env[name] ?? fallback;
}

export const config = {
  // Discord
  discordToken: required('DISCORD_TOKEN'),
  discordClientId: required('DISCORD_CLIENT_ID'),
  // Comma-separated guild IDs for fast (non-global) slash command registration during dev.
  // Leave unset to register globally (takes up to 1hr to propagate).
  discordGuildIds: optional('DISCORD_GUILD_IDS', '').split(',').filter(Boolean),

  // Whisper transcription backend
  // Expects an OpenAI-compatible /v1/audio/transcriptions endpoint, e.g.
  // https://github.com/ahmetoner/whisper-asr-webservice or a faster-whisper server.
  whisperUrl: optional('WHISPER_URL', 'http://whisper:9000'),
  whisperModel: optional('WHISPER_MODEL', 'base'),
  whisperLanguage: optional('WHISPER_LANGUAGE', ''), // '' = auto-detect

  // n8n webhook to POST finished transcript segments to
  n8nWebhookUrl: optional('N8N_WEBHOOK_URL', ''),

  // Audio segmentation tuning
  // How long a user must be silent before we consider their utterance "done"
  // and flush it for transcription (ms).
  silenceFlushMs: parseInt(optional('SILENCE_FLUSH_MS', '1200'), 10),
  // Minimum utterance length worth transcribing (ms) - filters out mic pops / coughs.
  minUtteranceMs: parseInt(optional('MIN_UTTERANCE_MS', '400'), 10),
  // How often (ms) to batch-send accumulated segments to n8n while a call is ongoing.
  // Set to 0 to only send once at the end of the call (on /leave or empty channel).
  batchIntervalMs: parseInt(optional('BATCH_INTERVAL_MS', '30000'), 10),

  // Auto-leave when the bot is the only one left in the voice channel (ms of grace period)
  autoLeaveEmptyMs: parseInt(optional('AUTO_LEAVE_EMPTY_MS', '10000'), 10),

  logLevel: optional('LOG_LEVEL', 'info'),
};
