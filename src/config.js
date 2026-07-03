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

  // Whisper transcription backend (embedded in same container)
  whisperUrl: optional('WHISPER_URL', 'http://localhost:9000'),
  whisperModel: optional('WHISPER_MODEL', 'base'),
  whisperLanguage: optional('WHISPER_LANGUAGE', ''), // '' = auto-detect

  // OpenRouter AI for conversation metadata generation
  openrouterApiKey: optional('OPENROUTER_API_KEY', ''),
  openrouterModel: optional('OPENROUTER_MODEL', 'meta-llama/llama-3.1-8b-instruct:free'),

  // Audio segmentation tuning
  // How long a user must be silent before we consider their utterance "done"
  // and flush it for transcription (ms).
  silenceFlushMs: parseInt(optional('SILENCE_FLUSH_MS', '1200'), 10),
  // Minimum utterance length worth transcribing (ms) - filters out mic pops / coughs.
  minUtteranceMs: parseInt(optional('MIN_UTTERANCE_MS', '400'), 10),

  // Auto-leave when the bot is the only one left in the voice channel (ms of grace period)
  autoLeaveEmptyMs: parseInt(optional('AUTO_LEAVE_EMPTY_MS', '10000'), 10),

  logLevel: optional('LOG_LEVEL', 'info'),
};
