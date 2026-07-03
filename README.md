# Dote Bot

Lightweight Discord bot that joins a voice channel on `/join`, captures **per-user**
audio (not a mixed stream), transcribes each utterance locally via a self-hosted
Whisper server, and forwards timestamped, speaker-labeled segments to an n8n webhook.

## How it works

1. Someone runs `/join` while in a voice channel -> bot joins that channel.
2. Discord gives the bot a **separate audio stream per speaking user** (this is only
   possible for bots in guild voice channels, not group DMs).
3. Each user's stream is decoded and buffered until they go quiet for
   `SILENCE_FLUSH_MS`, at which point that utterance is sent to Whisper.
4. Transcribed segments (`{userId, username, startTime, endTime, text}`) are batched
   and POSTed to `N8N_WEBHOOK_URL` every `BATCH_INTERVAL_MS`.
5. `/leave`, or the channel becoming empty, ends the session and flushes any
   remaining segments immediately.

No group-DM support — this only works in guild (server) voice channels, since that's
the only context where Discord's voice gateway exposes per-user audio to a bot.

## Discord bot setup

1. Create an application at https://discord.com/developers/applications
2. Under **Bot**, create a bot user and copy the token -> `DISCORD_TOKEN`
3. Copy the **Application ID** -> `DISCORD_CLIENT_ID`
4. Under **Bot > Privileged Gateway Intents**, enable **Server Members Intent**
   (needed to resolve display names)
5. Invite the bot with the `bot` and `applications.commands` scopes, and these
   permissions: `View Channel`, `Connect`, `Speak` (speak isn't used but Discord
   sometimes requires it alongside Connect for full voice functionality)
6. Invite URL pattern:
   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=3145728
   ```

## Running

```bash
cp .env.example .env
# fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, N8N_WEBHOOK_URL
docker compose up -d --build
```

This starts the bot plus a `whisper-asr-webservice` sidecar for local transcription.
If you already run Whisper elsewhere (e.g. alongside Ollama in your existing stack),
just point `WHISPER_URL` at that instead and drop the `whisper` service from
`docker-compose.yml`.

First run will download the Whisper model (~150MB for `base`) into a Docker volume,
so give it a minute before testing.

## n8n webhook payload

Set up a **Webhook** trigger node in n8n at the path matching `N8N_WEBHOOK_URL`,
method `POST`. Example payload the bot sends every batch interval:

```json
{
  "callId": "123456789012345678-987654321098765432-1719999999999",
  "guildId": "123456789012345678",
  "channelId": "987654321098765432",
  "sentAt": "2026-07-03T14:32:10.512Z",
  "segments": [
    {
      "userId": "111111111111111111",
      "username": "Alex",
      "startTime": "2026-07-03T14:31:50.100Z",
      "endTime": "2026-07-03T14:31:53.400Z",
      "text": "yeah I think we should ship the auth flow first"
    },
    {
      "userId": "222222222222222222",
      "username": "Sam",
      "startTime": "2026-07-03T14:31:54.000Z",
      "endTime": "2026-07-03T14:31:58.900Z",
      "text": "agreed, and I'll pick up the payment provider after that"
    }
  ]
}
```

From here your n8n workflow can insert into Postgres, generate embeddings via
Ollama, or whatever else you're building downstream.

## Tuning notes

- **Overlap:** since audio is per-user (not mixed), simultaneous talkers each get
  their own clean transcript — this design has no overlap/cross-talk problem at all,
  unlike a system-audio-capture approach.
- **`SILENCE_FLUSH_MS`** controls how "choppy" vs "run-on" utterances are. Lower =
  more, shorter segments (choppier transcript but lower latency to n8n). Higher =
  fewer, longer segments.
- **`WHISPER_MODEL`**: `base` is a good lightweight default; bump to `small` or
  `medium` if accuracy matters more than speed and you have the RAM/CPU (or a GPU).
- **Resource footprint:** the bot itself is lightweight (Node + audio piping, no ML).
  All the heavy lifting is in the Whisper container, which you can scale/swap
  independently (e.g. point at a GPU-backed Whisper instance elsewhere on your network).

## Known limitations

- Guild voice channels only — cannot join group DM calls (Discord platform
  restriction on bot accounts, not something this bot can work around).
- Username resolution requires the bot to share a guild with the speaker and have
  the Server Members intent enabled.
- If Whisper is slow relative to conversation pace, transcription lag will build up
  under `BATCH_INTERVAL_MS` pressure — bump the interval or use a smaller/faster
  model if you see this.

> This project uses AI generated content